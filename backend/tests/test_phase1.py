"""Phase 1 quality, stability, and PDF round-trip checks."""

import hashlib
from pathlib import Path

import cv2
import numpy as np
import pymupdf
import pytest
from PIL import Image

from backend.app.cv.hashing import hamming_distance, phash_hex, phash_root, sha256_bytes
from backend.app.cv.io_pdf import images_to_pdf, pdf_to_images
from backend.app.cv.visible import add_visible_watermark


SAMPLES = Path(__file__).resolve().parents[2] / "samples"


def load_sample(index: int = 1) -> np.ndarray:
    return np.asarray(Image.open(SAMPLES / f"document_{index:02d}.png").convert("RGB"))


def metrics(reference: np.ndarray, candidate: np.ndarray) -> tuple[float, float]:
    """Report PSNR and grayscale SSIM using OpenCV primitives."""
    psnr = cv2.PSNR(reference, candidate)
    a = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY).astype(np.float64)
    b = cv2.cvtColor(candidate, cv2.COLOR_RGB2GRAY).astype(np.float64)
    aa = cv2.GaussianBlur(a, (11, 11), 1.5)
    bb = cv2.GaussianBlur(b, (11, 11), 1.5)
    variance_a = cv2.GaussianBlur(a * a, (11, 11), 1.5) - aa * aa
    variance_b = cv2.GaussianBlur(b * b, (11, 11), 1.5) - bb * bb
    covariance = cv2.GaussianBlur(a * b, (11, 11), 1.5) - aa * bb
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ssim = ((2 * aa * bb + c1) * (2 * covariance + c2) /
            ((aa * aa + bb * bb + c1) * (variance_a + variance_b + c2)))
    return float(psnr), float(np.mean(ssim))


def test_visible_watermark_quality() -> None:
    original = load_sample()
    marked = add_visible_watermark(original, "ACME STUDIO")
    psnr, ssim = metrics(original, marked)
    print(f"visible: PSNR={psnr:.2f} dB SSIM={ssim:.5f} pHash distance={hamming_distance(phash_hex(original), phash_hex(marked))}")
    assert marked.shape == original.shape
    assert np.any(marked != original)
    assert ssim > 0.90
    assert np.array_equal(original, load_sample())


def test_phash_survives_jpeg70() -> None:
    original = load_sample(2)
    ok, encoded = cv2.imencode(".jpg", cv2.cvtColor(original, cv2.COLOR_RGB2BGR),
                               [cv2.IMWRITE_JPEG_QUALITY, 70])
    assert ok
    jpeg = cv2.cvtColor(cv2.imdecode(encoded, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    distance = hamming_distance(phash_hex(original), phash_hex(jpeg))
    psnr, ssim = metrics(original, jpeg)
    print(f"JPEG 70: PSNR={psnr:.2f} dB SSIM={ssim:.5f} pHash distance={distance}")
    assert distance <= 12
    assert sha256_bytes(original.tobytes()) != sha256_bytes(jpeg.tobytes())
    expected_root = hashlib.sha256((phash_hex(original) + phash_hex(jpeg)).encode("ascii")).hexdigest()
    assert phash_root([phash_hex(original), phash_hex(jpeg)]) == expected_root


def test_pdf_roundtrip_and_page_limit() -> None:
    pages = [load_sample(1), load_sample(3)]
    output = images_to_pdf(pages, dpi=100)
    assert output.startswith(b"%PDF-")
    with pymupdf.open(stream=output, filetype="pdf") as document:
        assert document.page_count == 2
        assert document[0].rect.width == pytest.approx(504)
    rendered = pdf_to_images(output, dpi=100)
    assert len(rendered) == 2
    for source, result in zip(pages, rendered):
        psnr, ssim = metrics(source, result)
        print(f"PDF roundtrip: PSNR={psnr:.2f} dB SSIM={ssim:.5f} pHash distance={hamming_distance(phash_hex(source), phash_hex(result))}")
        assert result.shape == source.shape
        assert ssim > 0.99
    with pytest.raises(ValueError, match="max_pages"):
        pdf_to_images(output, dpi=100, max_pages=1)
