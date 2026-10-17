"""Local, no-account document tools and the DocuMark frontend."""

from __future__ import annotations

import io
import json
import secrets
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from backend.app.cv.hashing import phash_hex, phash_root, sha256_bytes
from backend.app.cv import invisible
from backend.app.cv.io_pdf import images_to_pdf, pdf_to_images
from backend.app.cv.scanner import SCAN_MODES, analyze_page, process_scan
from backend.app.cv.visible import (DEFAULT_SEAL_FRACTION, INKS, MAX_SEAL_FRACTION,
                                    MIN_SEAL_FRACTION, add_visible_watermark, render_seal_rgba)


MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 20
MAX_PIXELS = 25_000_000
HIDDEN_DPI = 150
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

app = FastAPI(title="DocuMark", version="0.2.0")


async def read_upload(upload: UploadFile, allowed: tuple[str, ...]) -> bytes:
    data = await upload.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Each file must be 20 MB or smaller")
    kind = "pdf" if data.startswith(b"%PDF-") else "png" if data.startswith(b"\x89PNG\r\n\x1a\n") else "jpeg" if data.startswith(b"\xff\xd8\xff") else "unknown"
    if kind not in allowed:
        raise HTTPException(400, f"Expected {', '.join(allowed)} file")
    return data


def open_pdf(data: bytes) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        if doc.needs_pass:
            doc.close()
            raise HTTPException(400, "Password-protected PDFs are not supported")
        if not 1 <= doc.page_count <= MAX_PAGES:
            doc.close()
            raise HTTPException(400, "PDF must contain 1 to 20 pages")
        return doc
    except HTTPException:
        raise
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, "Could not read this PDF") from exc


def file_response(data: bytes, filename: str, media_type: str) -> Response:
    return Response(data, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"',
                             "Cache-Control": "no-store"})


def check_pdf_render_size(doc: pymupdf.Document, dpi: int) -> None:
    pixel_counts = [page.rect.width * page.rect.height * (dpi / 72) ** 2 for page in doc]
    if max(pixel_counts) > 6_000_000 or sum(pixel_counts) > 40_000_000:
        raise HTTPException(413, "PDF is too large to process safely")


def new_watermark_id() -> int:
    while not (value := secrets.randbits(64)):
        pass
    return value


def detect_hidden(images: list[np.ndarray]) -> dict:
    """Best hidden-watermark result over the pages, or found=False."""
    best = {"found": False, "watermark_id": None, "confidence": 0.0, "page": None}
    for index, image in enumerate(images, start=1):
        result = invisible.extract(image)
        if result["found"] and (not best["found"] or result["confidence"] > best["confidence"]):
            best = {**result, "page": index}
        elif not best["found"] and result["confidence"] > best["confidence"]:
            best.update(confidence=result["confidence"])
    if best["found"]:
        best["watermark_id"] = invisible.format_id(best["watermark_id"])
    best.pop("rotation", None)
    return best


def validate_seal(text: str, opacity: float, color: str, size: float = DEFAULT_SEAL_FRACTION) -> None:
    if (not 1 <= len(text.strip()) <= 40 or not 0.05 <= opacity <= 0.6 or color not in INKS
            or not MIN_SEAL_FRACTION <= size <= MAX_SEAL_FRACTION):
        raise HTTPException(400, "Check the name, opacity, ink color, and seal size")


def seal_png(text: str, opacity: float, color: str, size: int = 700) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(render_seal_rgba(size, text.strip(), opacity, color), "RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def decode_scan_image(data: bytes) -> np.ndarray:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_PIXELS:
                raise HTTPException(413, "Image is too large")
            return np.asarray(image.convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Could not read this image") from exc


def parse_scan_settings(raw: str, image: np.ndarray) -> dict:
    try:
        settings = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Invalid scan settings") from exc
    if not isinstance(settings, dict):
        raise HTTPException(400, "Invalid scan settings")
    mode = settings.get("mode", "enhance")
    rotation = settings.get("rotation", 0)
    if mode not in SCAN_MODES or type(rotation) is not int or rotation not in (0, 90, 180, 270):
        raise HTTPException(400, "Invalid scan mode or rotation")
    corners = settings.get("corners")
    if corners is not None:
        try:
            points = np.asarray(corners, dtype=np.float32)
            if points.shape != (4, 2) or not np.isfinite(points).all() or (points < 0).any() or (points > 1).any():
                raise ValueError()
            points *= np.float32([image.shape[1], image.shape[0]])
            if (not cv2.isContourConvex(points) or
                    cv2.contourArea(points) < image.shape[0] * image.shape[1] * 0.005 or
                    min(np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)) < 32):
                raise ValueError()
        except (TypeError, ValueError, OverflowError) as exc:
            raise HTTPException(400, "Invalid crop corners") from exc
    else:
        points = None
    return {"corners": points, "mode": mode, "rotation": rotation}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/seal-preview")
def seal_preview(text: str = "YOUR NAME", opacity: float = 0.18,
                 color: str = "slate") -> Response:
    validate_seal(text, opacity, color)
    return Response(seal_png(text, opacity, color, size=480), media_type="image/png",
                    headers={"Cache-Control": "no-store"})


@app.post("/api/inspect")
async def inspect(file: UploadFile = File(...)) -> JSONResponse:
    data = await read_upload(file, ("pdf", "png", "jpeg"))
    digest = sha256_bytes(data)
    if data.startswith(b"%PDF-"):
        with open_pdf(data) as doc:
            pages = doc.page_count
            pixel_counts = [page.rect.width * page.rect.height * (96 / 72) ** 2 for page in doc]
            if max(pixel_counts) > 6_000_000 or sum(pixel_counts) > 40_000_000:
                raise HTTPException(413, "PDF is too large to inspect safely")
        images = pdf_to_images(data, dpi=96)
        kind = "PDF"
    else:
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise HTTPException(413, "Image is too large")
                images = [np.asarray(image.convert("RGB"))]
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise HTTPException(400, "Could not read this image") from exc
        pages = 1
        kind = "Image"
    hashes = [phash_hex(image) for image in images]
    hidden = detect_hidden(images)
    return JSONResponse({"type": kind, "pages": pages, "size_bytes": len(data),
                         "sha256": digest, "phashes": hashes, "phash_root": phash_root(hashes),
                         "watermark_id": hidden["watermark_id"]},
                        headers={"Cache-Control": "no-store"})


@app.post("/api/scan")
async def scan(file: UploadFile = File(...)) -> JSONResponse:
    """Analyze an uploaded document or photo without claiming authenticity."""
    data = await read_upload(file, ("pdf", "png", "jpeg"))
    is_pdf = data.startswith(b"%PDF-")
    if is_pdf:
        with open_pdf(data) as doc:
            pixel_counts = [page.rect.width * page.rect.height * (96 / 72) ** 2 for page in doc]
            if max(pixel_counts) > 6_000_000 or sum(pixel_counts) > 40_000_000:
                raise HTTPException(413, "PDF is too large to scan safely")
        images = pdf_to_images(data, dpi=96)
    else:
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise HTTPException(413, "Image is too large")
                images = [np.asarray(image.convert("RGB"))]
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise HTTPException(400, "Could not read this image") from exc
    results = []
    for index, image in enumerate(images, start=1):
        _, result = analyze_page(image, photo=not is_pdf)
        results.append({"page": index, **result})
    return JSONResponse({"type": "PDF" if is_pdf else "Image", "pages": len(results),
                         "sha256": sha256_bytes(data), "seal_detected": any(r["seal_detected"] for r in results),
                         "results": results, "detection_scope": "Centered DocuMark-style circular seal pattern"},
                        headers={"Cache-Control": "no-store"})


@app.post("/api/scan-export")
async def scan_export(file: UploadFile = File(...)) -> Response:
    """Download a straightened PNG from an uploaded page photo or image."""
    data = await read_upload(file, ("png", "jpeg"))
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_PIXELS:
                raise HTTPException(413, "Image is too large")
            pixels = np.asarray(image.convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Could not read this image") from exc
    page, _ = analyze_page(pixels, photo=True)
    buffer = io.BytesIO()
    Image.fromarray(page).save(buffer, format="PNG")
    return file_response(buffer.getvalue(), "scanned-page.png", "image/png")


@app.post("/api/scan-render")
async def scan_render(file: UploadFile = File(...), settings: str = Form("{}"),
                      output: str = Form("png")) -> Response:
    """Render one photo with the same crop and filter used by PDF export."""
    if output not in ("png", "jpg"):
        raise HTTPException(400, "Choose PNG or JPG output")
    image = decode_scan_image(await read_upload(file, ("png", "jpeg")))
    processed = process_scan(image, **parse_scan_settings(settings, image))
    buffer = io.BytesIO()
    Image.fromarray(processed).save(buffer, format="PNG" if output == "png" else "JPEG", quality=90)
    return file_response(buffer.getvalue(), f"scanned-page.{output}",
                         "image/png" if output == "png" else "image/jpeg")


@app.post("/api/scan-batch")
async def scan_batch(files: list[UploadFile] = File(...), settings: str = Form("[]")) -> Response:
    """Render selected photos in order into one A4 PDF."""
    if not 1 <= len(files) <= MAX_PAGES:
        raise HTTPException(400, "Choose 1 to 20 image pages")
    try:
        page_settings = json.loads(settings)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Invalid scan settings") from exc
    if not isinstance(page_settings, list) or len(page_settings) != len(files):
        raise HTTPException(400, "Scan settings must match the page count")
    total_bytes = 0
    with pymupdf.open() as doc:
        for upload, settings_for_page in zip(files, page_settings):
            data = await read_upload(upload, ("png", "jpeg"))
            total_bytes += len(data)
            if total_bytes > 60 * 1024 * 1024:
                raise HTTPException(413, "Batch must be 60 MB or smaller")
            image = decode_scan_image(data)
            page_image = process_scan(image, **parse_scan_settings(json.dumps(settings_for_page), image))
            buffer = io.BytesIO()
            Image.fromarray(page_image).save(buffer, format="PNG")
            page = doc.new_page(width=595, height=842)
            margin = 18
            max_width, max_height = 595 - 2 * margin, 842 - 2 * margin
            ratio = min(max_width / page_image.shape[1], max_height / page_image.shape[0])
            width, height = page_image.shape[1] * ratio, page_image.shape[0] * ratio
            rect = pymupdf.Rect((595 - width) / 2, (842 - height) / 2,
                                (595 + width) / 2, (842 + height) / 2)
            page.insert_image(rect, stream=buffer.getvalue())
        return file_response(doc.tobytes(garbage=4, deflate=True), "scanned-pages.pdf", "application/pdf")


@app.post("/api/extract")
async def extract(file: UploadFile = File(...)) -> JSONResponse:
    """Find a hidden DocuMark ID in a PDF, image, screenshot or straightened phone photo."""
    data = await read_upload(file, ("pdf", "png", "jpeg"))
    if data.startswith(b"%PDF-"):
        with open_pdf(data) as doc:
            check_pdf_render_size(doc, 96)
        result = {**detect_hidden(pdf_to_images(data, dpi=96)), "method": "direct"}
    else:
        image = decode_scan_image(data)
        result = {**detect_hidden([image]), "method": "direct"}
        if not result["found"]:
            # A phone photo shows the page in perspective on a background; straighten it first.
            page, _ = analyze_page(image, photo=True)
            straightened = {**detect_hidden([page]), "method": "scanner"}
            if straightened["found"] or straightened["confidence"] > result["confidence"]:
                result = straightened
    # Keep the byte hash available for an exact-file lookup when this copy has
    # no hidden ID (for example, a document registered before hidden marking).
    result["sha256"] = sha256_bytes(data)
    result["confidence"] = round(result["confidence"], 3)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@app.post("/api/watermark")
async def watermark(file: UploadFile = File(...), text: str = Form(""),
                    opacity: float = Form(0.18), color: str = Form("slate"),
                    straighten: bool = Form(False), size: float = Form(DEFAULT_SEAL_FRACTION),
                    visible: bool = Form(True), hidden: bool = Form(False)) -> Response:
    if not visible and not hidden:
        raise HTTPException(400, "Choose a hidden ID, a visible seal, or both")
    if visible:
        validate_seal(text, opacity, color, size)
    data = await read_upload(file, ("pdf", "png", "jpeg"))
    watermark_id = new_watermark_id() if hidden else None
    headers = {"X-Watermark-Id": invisible.format_id(watermark_id)} if hidden else {}
    if data.startswith(b"%PDF-"):
        with open_pdf(data) as doc:
            if hidden:
                check_pdf_render_size(doc, HIDDEN_DPI)
            if visible:
                stamp = seal_png(text, opacity, color)
                for page in doc:
                    side = min(page.rect.width, page.rect.height) * size
                    x0 = (page.rect.width - side) / 2
                    y0 = (page.rect.height - side) / 2
                    page.insert_image(pymupdf.Rect(x0, y0, x0 + side, y0 + side),
                                      stream=stamp, overlay=True)
            output = doc.tobytes(garbage=4, deflate=True)
        if hidden:
            # The hidden ID lives in page pixels, so pages are rendered and rebuilt as images.
            pages = [invisible.embed(page, watermark_id) for page in pdf_to_images(output, dpi=HIDDEN_DPI)]
            output = images_to_pdf(pages, dpi=HIDDEN_DPI)
        response = file_response(output, "watermarked.pdf", "application/pdf")
        response.headers.update(headers)
        return response
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_PIXELS:
                raise HTTPException(413, "Image is too large")
            pixels = np.asarray(image.convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Could not read this image") from exc
    if straighten:
        pixels, _ = analyze_page(pixels, photo=True)
    marked = add_visible_watermark(pixels, text.strip(), opacity, color, size) if visible else pixels
    if hidden:
        marked = invisible.embed(marked, watermark_id)
    buffer = io.BytesIO()
    Image.fromarray(marked).save(buffer, format="PNG")
    response = file_response(buffer.getvalue(), "watermarked.png", "image/png")
    response.headers.update(headers)
    return response


FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
BUILT_FRONTEND = FRONTEND / "dist"
app.mount("/", StaticFiles(directory=BUILT_FRONTEND if BUILT_FRONTEND.exists() else FRONTEND, html=True), name="frontend")
