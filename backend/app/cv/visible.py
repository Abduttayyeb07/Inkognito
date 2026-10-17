"""Render a subtle circular document seal and composite it onto RGB pages."""

from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont


INKS = {
    "slate": (87, 103, 119),
    "blue": (45, 93, 135),
    "red": (158, 65, 72),
}
MIN_SEAL_FRACTION = 0.15
MAX_SEAL_FRACTION = 0.70
DEFAULT_SEAL_FRACTION = 0.35


@lru_cache(maxsize=32)
def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _arc_text(mask: Image.Image, text: str, radius: float, first: float,
              last: float, font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
              *, bottom: bool = False) -> None:
    """Place individually rotated glyphs on an arc of a grayscale mask."""
    middle = mask.width / 2
    if len(text) == 1:
        angles = [(first + last) / 2]
    else:
        angles = np.linspace(first, last, len(text))
    for glyph, degrees in zip(text, angles):
        if glyph == " ":
            continue
        theta = math.radians(float(degrees))
        x = middle + radius * math.cos(theta)
        y = middle + radius * math.sin(theta)
        box = font.getbbox(glyph)
        canvas = Image.new("L", (max(1, box[2] - box[0]) + 12,
                                  max(1, box[3] - box[1]) + 12), 0)
        ImageDraw.Draw(canvas).text((6 - box[0], 6 - box[1]), glyph,
                                    font=font, fill=255, stroke_width=0)
        turn = -(float(degrees) - 90 if bottom else float(degrees) + 90)
        canvas = canvas.rotate(turn, resample=Image.Resampling.BICUBIC, expand=True)
        mask.paste(canvas, (round(x - canvas.width / 2), round(y - canvas.height / 2)), canvas)


def render_seal_rgba(size: int, text: str, opacity: float = 0.18,
                     color: str = "slate") -> np.ndarray:
    """Return a transparent RGBA seal sized for embedding in images or PDFs."""
    label = text.strip().upper()
    if size < 64 or not 1 <= len(label) <= 40:
        raise ValueError("Seal needs at least 64 pixels and a 1-40 character name")
    if not 0.05 <= opacity <= 0.6 or color not in INKS:
        raise ValueError("Invalid seal opacity or color")

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    outer = round(size * 0.035)
    inner = round(size * 0.125)
    draw.ellipse((outer, outer, size - outer, size - outer),
                 outline=255, width=max(2, round(size * 0.008)))
    draw.ellipse((inner, inner, size - inner, size - inner),
                 outline=235, width=max(1, round(size * 0.004)))

    # The name runs around the upper ring; the lower ring states what it is.
    font_size = max(9, round(size * min(0.058, 0.82 / max(len(label), 12))))
    _arc_text(mask, label, size * 0.418, -144, -36, _font(font_size))
    _arc_text(mask, "DOCUMENT COPY", size * 0.418, 144, 36,
              _font(max(9, round(size * 0.046))), bottom=True)

    words = label.split()
    monogram = "".join(word[0] for word in words[:2]) if len(words) > 1 else label[:2]
    monogram = monogram[:2]
    monogram_font = _font(round(size * 0.20))
    center_box = draw.textbbox((0, 0), monogram, font=monogram_font)
    draw.text(((size - (center_box[2] - center_box[0])) / 2 - center_box[0],
               size * 0.42 - center_box[1]), monogram, font=monogram_font, fill=255)
    line_width = max(2, round(size * 0.005))
    draw.line((size * 0.31, size * 0.68, size * 0.69, size * 0.68),
              fill=210, width=line_width)
    for x in (size * 0.18, size * 0.82):
        r = max(2, round(size * 0.009))
        draw.ellipse((x - r, size / 2 - r, x + r, size / 2 + r), fill=255)

    alpha = np.rint(np.asarray(mask, dtype=np.float32) * opacity).astype(np.uint8)
    rgba = np.empty((size, size, 4), dtype=np.uint8)
    rgba[..., :3] = INKS[color]
    rgba[..., 3] = alpha
    return rgba


def add_visible_watermark(page: np.ndarray, text: str, alpha: float = 0.18,
                          color: str = "slate", size_fraction: float = DEFAULT_SEAL_FRACTION) -> np.ndarray:
    """Composite a centered circular seal onto an RGB uint8 page."""
    if not isinstance(page, np.ndarray) or page.dtype != np.uint8 or page.ndim != 3 or page.shape[2] != 3:
        raise ValueError("page must be an RGB uint8 array")
    height, width = page.shape[:2]
    if min(width, height) < 64:
        raise ValueError("page must be at least 64 pixels on each side")
    if not MIN_SEAL_FRACTION <= size_fraction <= MAX_SEAL_FRACTION:
        raise ValueError("seal size must be between 15% and 70%")
    size = max(12, round(min(width, height) * size_fraction))
    seal = render_seal_rgba(max(64, size), text, alpha, color)
    if size < 64:
        seal = np.asarray(Image.fromarray(seal, "RGBA").resize((size, size), Image.Resampling.LANCZOS))
    x0, y0 = (width - size) // 2, (height - size) // 2
    result = page.copy()
    region = result[y0:y0 + size, x0:x0 + size].astype(np.float32)
    weight = seal[..., 3:4].astype(np.float32) / 255.0
    region = region * (1 - weight) + seal[..., :3].astype(np.float32) * weight
    result[y0:y0 + size, x0:x0 + size] = np.clip(np.rint(region), 0, 255).astype(np.uint8)
    return result
