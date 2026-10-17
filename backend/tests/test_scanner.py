"""Check geometric correction and circular seal detection on a phone-like photo."""

import cv2
import numpy as np
from PIL import Image

from backend.app.cv.scanner import analyze_page
from backend.app.cv.visible import add_visible_watermark


def test_photo_alignment_recovers_seal_without_false_positive() -> None:
    original = np.asarray(Image.open("samples/document_01.png").convert("RGB"))
    height, width = original.shape[:2]
    source = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    corners = np.float32([[130, 95], [792, 148], [735, 1110], [100, 1020]])
    transform = cv2.getPerspectiveTransform(source, corners)

    def photo(page: np.ndarray) -> np.ndarray:
        return cv2.warpPerspective(page, transform, (900, 1200), borderValue=(45, 45, 50))

    _, clean = analyze_page(photo(original), photo=True)
    _, marked = analyze_page(photo(add_visible_watermark(original, "ACME STUDIO")), photo=True)
    print(f"photo seal scores: clean={clean['seal_score']}, marked={marked['seal_score']}")
    assert clean["straightened"] and marked["straightened"]
    assert not clean["seal_detected"]
    assert marked["seal_detected"]
    assert marked["seal_score"] > clean["seal_score"] + 5
