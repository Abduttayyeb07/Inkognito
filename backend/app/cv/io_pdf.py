"""Render PDFs to RGB arrays and assemble RGB arrays as a PDF."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pymupdf


def pdf_to_images(data: bytes, dpi: int = 200, max_pages: int = 20) -> list[np.ndarray]:
    """Render PDF bytes at *dpi*, preserving order, to RGB uint8 arrays."""
    if dpi <= 0 or max_pages <= 0:
        raise ValueError("dpi and max_pages must be positive")
    if not data.startswith(b"%PDF-"):
        raise ValueError("Not a PDF")
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.page_count == 0 or doc.page_count > max_pages:
            raise ValueError("PDF must contain 1 to max_pages pages")
        pages = []
        for page in doc:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72, dpi / 72),
                                  colorspace=pymupdf.csRGB, alpha=False)
            pages.append(np.frombuffer(pix.samples, dtype=np.uint8)
                         .reshape(pix.height, pix.width, 3).copy())
        return pages


def images_to_pdf(images: Sequence[np.ndarray], dpi: int = 200) -> bytes:
    """Place RGB uint8 pages in a PDF at their physical size implied by *dpi*."""
    if dpi <= 0 or not images:
        raise ValueError("dpi must be positive and images must not be empty")
    with pymupdf.open() as doc:
        for image in images:
            if not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
                raise ValueError("Each image must be an RGB uint8 array")
            height, width, _ = image.shape
            if height == 0 or width == 0:
                raise ValueError("Images must have nonzero dimensions")
            rect = pymupdf.Rect(0, 0, width * 72 / dpi, height * 72 / dpi)
            page = doc.new_page(width=rect.width, height=rect.height)
            pix = pymupdf.Pixmap(pymupdf.csRGB, width, height, image.tobytes(), False)
            page.insert_image(rect, pixmap=pix)
        return doc.tobytes(deflate=True)
