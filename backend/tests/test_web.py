"""Exercise the no-account web flows with actual sample files."""

import io
import json
from pathlib import Path

import numpy as np
import pymupdf
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import app


ROOT = Path(__file__).resolve().parents[2]
CLIENT = TestClient(app)


def sample(name: str) -> bytes:
    return (ROOT / "samples" / name).read_bytes()


def test_home_and_inspect() -> None:
    home = CLIENT.get("/")
    assert home.status_code == 200
    assert "No signup" in home.text
    assert "Split PDF" not in home.text
    assert "Merge PDF" not in home.text
    assert "Add watermark" in home.text
    result = CLIENT.post("/api/inspect", files={"file": ("sample.pdf", sample("document_01.pdf"), "application/pdf")})
    assert result.status_code == 200
    assert result.json()["pages"] == 1
    assert len(result.json()["sha256"]) == 64
    assert len(result.json()["phashes"][0]) == 16


def test_watermark_pdf_and_image() -> None:
    pdf = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO", "opacity": "0.18", "color": "slate"}, files={"file": ("sample.pdf", sample("document_01.pdf"), "application/pdf")})
    assert pdf.status_code == 200
    with pymupdf.open(stream=pdf.content, filetype="pdf") as doc:
        assert doc.page_count == 1
    image = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO"}, files={"file": ("sample.png", sample("document_01.png"), "image/png")})
    assert image.status_code == 200
    assert image.content.startswith(b"\x89PNG")
    assert image.content != sample("document_01.png")


def test_pdf_seal_preserves_selectable_text() -> None:
    with pymupdf.open() as source:
        page = source.new_page()
        page.insert_text((72, 72), "Invoice number 12345")
        original = source.tobytes()
    result = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO", "color": "blue"},
                         files={"file": ("invoice.pdf", original, "application/pdf")})
    assert result.status_code == 200
    with pymupdf.open(stream=result.content, filetype="pdf") as marked:
        assert "Invoice number 12345" in marked[0].get_text()
        assert len(marked[0].get_images(full=True)) >= 1


def test_name_is_required_for_seal() -> None:
    result = CLIENT.post("/api/watermark", data={"text": "  "},
                         files={"file": ("sample.png", sample("document_01.png"), "image/png")})
    assert result.status_code == 400


def test_preview_uses_transparent_seal() -> None:
    result = CLIENT.get("/api/seal-preview", params={"text": "ACME STUDIO", "opacity": 0.18})
    assert result.status_code == 200
    with Image.open(io.BytesIO(result.content)) as preview:
        assert preview.mode == "RGBA"
        assert preview.getchannel("A").getextrema()[0] == 0
        assert preview.getchannel("A").getextrema()[1] > 0


def test_rejects_disguised_upload() -> None:
    result = CLIENT.post("/api/watermark", data={"text": "TEST"}, files={"file": ("fake.pdf", b"not a pdf", "application/pdf")})
    assert result.status_code == 400


def test_scan_finds_generated_seal_and_exports_page() -> None:
    original = sample("document_01.png")
    clean = CLIENT.post("/api/scan", files={"file": ("page.png", original, "image/png")})
    assert clean.status_code == 200
    assert clean.json()["seal_detected"] is False
    stamped = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO"},
                          files={"file": ("page.png", original, "image/png")})
    marked = CLIENT.post("/api/scan", files={"file": ("page.png", stamped.content, "image/png")})
    assert marked.status_code == 200
    assert marked.json()["seal_detected"] is True
    assert marked.json()["results"][0]["document_found"] is True
    export = CLIENT.post("/api/scan-export", files={"file": ("page.png", original, "image/png")})
    assert export.status_code == 200
    with Image.open(io.BytesIO(export.content)) as page:
        assert page.width < 700
        assert page.height < 990


def test_scan_detects_seal_on_pdf_without_flattening_text() -> None:
    source = sample("document_01.pdf")
    stamped = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO"},
                          files={"file": ("page.pdf", source, "application/pdf")})
    scan = CLIENT.post("/api/scan", files={"file": ("page.pdf", stamped.content, "application/pdf")})
    assert scan.status_code == 200
    assert scan.json()["seal_detected"] is True
    assert scan.json()["results"][0]["straightened"] is False


def test_scan_manual_crop_filter_rotation_and_validation() -> None:
    source = sample("document_01.png")
    settings = {"corners": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
                "mode": "bw", "rotation": 90}
    result = CLIENT.post("/api/scan-render", data={"settings": json.dumps(settings), "output": "jpg"},
                         files={"file": ("page.png", source, "image/png")})
    assert result.status_code == 200
    assert result.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(result.content)) as image:
        assert image.width > image.height  # Rotated from portrait to landscape.
        assert image.width < 990 and image.height < 700  # Manual crop reduced both edges.
        pixel = image.getpixel((image.width // 2, image.height // 2))
        assert max(pixel) - min(pixel) <= 3  # Monochrome look survived JPEG encoding.
    invalid = CLIENT.post("/api/scan-render", data={"settings": json.dumps({"corners": [[0, 0]] * 4})},
                          files={"file": ("page.png", source, "image/png")})
    assert invalid.status_code == 400


def test_scan_batch_exports_ordered_pdf() -> None:
    first, second = sample("document_01.png"), sample("document_02.png")
    settings = [{"mode": "original"}, {"mode": "grayscale", "rotation": 90}]
    result = CLIENT.post("/api/scan-batch", data={"settings": json.dumps(settings)},
                         files=[("files", ("first.png", first, "image/png")),
                                ("files", ("second.png", second, "image/png"))])
    assert result.status_code == 200
    with pymupdf.open(stream=result.content, filetype="pdf") as doc:
        assert doc.page_count == 2
        assert doc[0].rect == doc[1].rect  # A4 pages in selected order.
        first_image = doc[0].get_pixmap(matrix=pymupdf.Matrix(0.25, 0.25)).samples
        second_image = doc[1].get_pixmap(matrix=pymupdf.Matrix(0.25, 0.25)).samples
        assert first_image != second_image
    stamped = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO"},
                          files={"file": ("scanned-pages.pdf", result.content, "application/pdf")})
    assert stamped.status_code == 200
    checked = CLIENT.post("/api/scan", files={"file": ("marked.pdf", stamped.content, "application/pdf")})
    assert checked.status_code == 200
    assert checked.json()["pages"] == 2
    assert checked.json()["seal_detected"] is True


def test_seal_size_changes_output_and_scan_finds_both() -> None:
    source = sample("document_01.png")
    outputs = {}
    for size in ("0.15", "0.70"):
        response = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO", "size": size},
                               files={"file": ("page.png", source, "image/png")})
        assert response.status_code == 200
        outputs[size] = response.content
        scanned = CLIENT.post("/api/scan", files={"file": ("marked.png", response.content, "image/png")})
        assert scanned.json()["seal_detected"] is True
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(outputs["0.15"])) as small, Image.open(io.BytesIO(outputs["0.70"])) as large:
        clean = np.asarray(original.convert("RGB"), dtype=np.int16)
        changed_small = np.any(np.abs(np.asarray(small, dtype=np.int16) - clean) > 3, axis=2).sum()
        changed_large = np.any(np.abs(np.asarray(large, dtype=np.int16) - clean) > 3, axis=2).sum()
        assert changed_large > changed_small * 8
    invalid = CLIENT.post("/api/watermark", data={"text": "ACME STUDIO", "size": "0.8"},
                          files={"file": ("page.png", source, "image/png")})
    assert invalid.status_code == 400
