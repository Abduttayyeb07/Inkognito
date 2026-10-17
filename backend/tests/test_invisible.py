"""Hidden 64-bit watermark: invisibility, robustness, false positives and the web flow."""

import io
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.cv import invisible
from backend.app.main import app


ROOT = Path(__file__).resolve().parents[2]
CLIENT = TestClient(app)
WID = 0x1234_5678_9ABC_DEF1


def page(name: str = "document_01.png") -> np.ndarray:
    return np.asarray(Image.open(ROOT / "samples" / name).convert("RGB"))


def jpeg(image: np.ndarray, quality: int) -> np.ndarray:
    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, "JPEG", quality=quality)
    return np.asarray(Image.open(io.BytesIO(buffer.getvalue())).convert("RGB"))


def photo(image: np.ndarray) -> np.ndarray:
    """A page photographed in perspective on a dark table, blurred, noisy and JPEG-compressed."""
    height, width = image.shape[:2]
    canvas = (int(width * 1.35), int(height * 1.35))
    ox, oy = width * 0.17, height * 0.17
    source = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    target = np.float32([[ox + 0.04 * width, oy], [ox + 0.97 * width, oy + 0.03 * height],
                         [ox + width, oy + 0.98 * height], [ox - 0.01 * width, oy + 1.01 * height]])
    shot = cv2.warpPerspective(image, cv2.getPerspectiveTransform(source, target), canvas,
                               borderValue=(45, 45, 45)).astype(np.float32)
    shot = cv2.GaussianBlur(shot, (0, 0), 1.2) + np.random.default_rng(1).normal(0, 3, shot.shape)
    return jpeg(np.clip(shot, 0, 255).astype(np.uint8), 85)


def test_mark_is_faint_and_survives_common_copies() -> None:
    original = page()
    marked = invisible.embed(original, WID)
    assert np.abs(original.astype(int) - marked).max() <= 10
    for copy in (marked, jpeg(marked, 50), cv2.resize(marked, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA),
                 np.ascontiguousarray(np.rot90(marked))):
        result = invisible.extract(copy)
        assert result["found"] and result["watermark_id"] == WID
    print(f"hidden mark: max change {np.abs(original.astype(int) - marked).max()} levels, "
          f"JPEG 50 confidence {invisible.extract(jpeg(marked, 50))['confidence']}")


def test_unmarked_pages_report_nothing() -> None:
    rng = np.random.default_rng(0)
    for image in (page("document_02.png"), page("document_04.png"), np.full((800, 600, 3), 255, np.uint8),
                  rng.integers(0, 255, (600, 500, 3), dtype=np.uint8)):
        assert not invisible.extract(image)["found"]


def test_rejects_invalid_ids() -> None:
    for bad in (0, 1 << 64):
        try:
            invisible.embed(page(), bad)
        except ValueError:
            continue
        raise AssertionError("expected ValueError")


def test_hidden_watermark_web_flow_png_photo_and_pdf() -> None:
    png = (ROOT / "samples" / "document_03.png").read_bytes()
    result = CLIENT.post("/api/watermark", data={"hidden": "true", "visible": "false"},
                         files={"file": ("page.png", png, "image/png")})
    assert result.status_code == 200
    watermark_id = result.headers["x-watermark-id"]
    assert len(watermark_id) == 18 and watermark_id.startswith("0x")
    marked = np.asarray(Image.open(io.BytesIO(result.content)).convert("RGB"))

    found = CLIENT.post("/api/extract", files={"file": ("marked.png", result.content, "image/png")}).json()
    assert found["found"] and found["watermark_id"] == watermark_id and found["method"] == "direct"

    buffer = io.BytesIO()
    Image.fromarray(photo(marked)).save(buffer, "JPEG", quality=85)
    shot = CLIENT.post("/api/extract", files={"file": ("photo.jpg", buffer.getvalue(), "image/jpeg")}).json()
    assert shot["found"] and shot["watermark_id"] == watermark_id and shot["method"] == "scanner"

    plain = CLIENT.post("/api/extract", files={"file": ("plain.png", png, "image/png")}).json()
    assert not plain["found"] and plain["watermark_id"] is None

    pdf = CLIENT.post("/api/watermark", data={"hidden": "true", "visible": "true", "text": "ACME"},
                      files={"file": ("doc.pdf", (ROOT / "samples" / "document_01.pdf").read_bytes(), "application/pdf")})
    assert pdf.status_code == 200
    with pymupdf.open(stream=pdf.content, filetype="pdf") as doc:
        assert doc.page_count == 1
    inspected = CLIENT.post("/api/inspect", files={"file": ("doc.pdf", pdf.content, "application/pdf")}).json()
    assert inspected["watermark_id"] == pdf.headers["x-watermark-id"]
    assert pdf.headers["x-watermark-id"] != watermark_id


def test_watermark_needs_hidden_or_visible() -> None:
    png = (ROOT / "samples" / "document_01.png").read_bytes()
    result = CLIENT.post("/api/watermark", data={"hidden": "false", "visible": "false"},
                         files={"file": ("page.png", png, "image/png")})
    assert result.status_code == 400
    hidden_only = CLIENT.post("/api/watermark", data={"hidden": "true", "visible": "false"},
                              files={"file": ("page.png", png, "image/png")})
    assert hidden_only.status_code == 200
    assert "x-watermark-id" not in CLIENT.post("/api/watermark", data={"text": "ACME"},
                                               files={"file": ("page.png", png, "image/png")}).headers


def test_random_ids_survive_phone_photo_after_scanner() -> None:
    from backend.app.cv.scanner import analyze_page

    rng = np.random.default_rng(11)
    pages = [page(f"document_0{index}.png") for index in (1, 3, 5)]
    for trial in range(20):
        watermark_id = int(rng.integers(1, 2**63))
        straightened, _ = analyze_page(photo(invisible.embed(pages[trial % 3], watermark_id)), photo=True)
        result = invisible.extract(straightened)
        assert result["found"] and result["watermark_id"] == watermark_id, (hex(watermark_id), result)
