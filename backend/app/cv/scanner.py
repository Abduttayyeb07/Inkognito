"""Find photo pages, straighten them, and detect DocuMark's circular seal."""

from __future__ import annotations

import cv2
import numpy as np


def _ordered_corners(points: np.ndarray) -> np.ndarray:
    points = points.reshape(4, 2).astype(np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).ravel()
    return np.array([points[np.argmin(sums)], points[np.argmin(differences)],
                     points[np.argmax(sums)], points[np.argmax(differences)]], dtype=np.float32)


def find_document(image: np.ndarray) -> np.ndarray | None:
    """Return four page corners when a large, unambiguous quadrilateral is visible."""
    height, width = image.shape[:2]
    scale = min(1.0, 1200 / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 45, 130)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = small.shape[0] * small.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        if cv2.contourArea(contour) < area * 0.20:
            break
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return _ordered_corners(approx / scale)
    return None


def straighten_document(image: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """Perspective warp a photographed page, with a bounded output size."""
    tl, tr, br, bl = corners
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    if min(width, height) < 64:
        return image.copy()
    scale = min(1.0, 2400 / max(width, height), (25_000_000 / (width * height)) ** 0.5)
    width, height = max(64, round(width * scale)), max(64, round(height * scale))
    target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    transform = cv2.getPerspectiveTransform(corners.astype(np.float32), target)
    return cv2.warpPerspective(image, transform, (width, height), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)


SCAN_MODES = ("original", "enhance", "bright", "grayscale", "bw")


def process_scan(image: np.ndarray, *, corners: np.ndarray | None = None,
                 mode: str = "enhance", rotation: int = 0) -> np.ndarray:
    """Perspective crop, rotate, and apply one of five local scan looks."""
    if mode not in SCAN_MODES or rotation not in (0, 90, 180, 270):
        raise ValueError("Invalid scan mode or rotation")
    if corners is None:
        corners = find_document(image)
    page = straighten_document(image, corners) if corners is not None else image.copy()
    if rotation:
        page = np.rot90(page, k=rotation // 90 * -1).copy()
    if mode == "original":
        return page
    if mode == "grayscale":
        gray = cv2.cvtColor(page, cv2.COLOR_RGB2GRAY)
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
    if mode == "bw":
        gray = cv2.cvtColor(page, cv2.COLOR_RGB2GRAY)
        threshold = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                          cv2.THRESH_BINARY, 35, 15)
        return cv2.cvtColor(threshold, cv2.COLOR_GRAY2RGB)
    lab = cv2.cvtColor(page, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0 if mode == "enhance" else 1.5, tileGridSize=(8, 8))
    l = clahe.apply(l)
    if mode == "bright":
        l = cv2.convertScaleAbs(l, alpha=1.08, beta=10)
    color = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2RGB)
    if mode == "enhance":
        softened = cv2.GaussianBlur(color, (0, 0), 0.8)
        color = cv2.addWeighted(color, 1.18, softened, -0.18, 0)
    return color


def seal_ring_score(image: np.ndarray) -> float:
    """Measure paired circular strokes at the size and center used by DocuMark."""
    height, width = image.shape[:2]
    if min(height, width) < 160:
        return 0.0
    scale = min(1.0, 1000 / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)
    height, width = gray.shape
    center = np.float32([(width - 1) / 2, (height - 1) / 2])
    angles = np.linspace(0, 2 * np.pi, 720, endpoint=False, dtype=np.float32)
    cosine, sine = np.cos(angles), np.sin(angles)

    def sample(radius: float) -> np.ndarray:
        radius = np.float32(radius)
        x = center[0] + radius * cosine
        y = center[1] + radius * sine
        return cv2.remap(gray, x.reshape(1, -1), y.reshape(1, -1), cv2.INTER_LINEAR).ravel()

    # Search the user-selectable seal sizes. A real seal has contrast at both
    # concentric rings; a single circular logo is less likely to match both.
    best = 0.0
    for fraction in np.arange(0.15, 0.701, 0.005):
        side = min(height, width) * fraction
        outer = side * 0.461
        inner = side * 0.373
        offset = max(2.5, side * 0.018)
        outer_contrast = (sample(outer - offset) + sample(outer + offset)) / 2 - sample(outer)
        inner_contrast = (sample(inner - offset) + sample(inner + offset)) / 2 - sample(inner)
        outer_score, inner_score = float(np.mean(outer_contrast)), float(np.mean(inner_contrast))
        best = max(best, min(outer_score, inner_score))
    return round(best, 2)


def analyze_page(image: np.ndarray, *, photo: bool = False) -> tuple[np.ndarray, dict]:
    """Return the page used for analysis and interpretable scan measurements."""
    corners = find_document(image) if photo else None
    page = straighten_document(image, corners) if corners is not None else image
    gray = cv2.cvtColor(page, cv2.COLOR_RGB2GRAY)
    longest = max(gray.shape)
    if longest > 1200:
        factor = 1200 / longest
        gray = cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    sharpness = round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 1)
    # A previously stamped image may include a print margin that is removed by
    # the page crop. Check both coordinate systems before reporting absence.
    score = max(seal_ring_score(image), seal_ring_score(page)) if corners is not None else seal_ring_score(page)
    return page, {
        "document_found": corners is not None if photo else True,
        "straightened": corners is not None,
        "width": int(page.shape[1]),
        "height": int(page.shape[0]),
        "sharpness": sharpness,
        "quality": "low detail / possibly blurry" if sharpness < 60 else "clear",
        "seal_detected": score >= 5.5,
        "seal_score": score,
        "source_width": int(image.shape[1]),
        "source_height": int(image.shape[0]),
        "corners": [[round(float(x / image.shape[1]), 5), round(float(y / image.shape[0]), 5)]
                    for x, y in corners] if corners is not None else None,
    }
