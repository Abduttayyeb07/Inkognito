"""Invisible 64-bit watermark hidden in page brightness with block DCT.

The page is resized to a fixed canonical grid so that the mark survives rescaling, JPEG
compression and a phone photo that the scanner has straightened. Each of the 80 coded bits
(64-bit ID plus CRC-16) is repeated across about 13 large blocks chosen by a keyed shuffle;
the bit is carried by the sign of the difference of two low/mid-frequency DCT coefficients.
On reading, the CRC repairs up to two of the weakest bits and rejects everything else.
Only the brightness change is computed on the canonical grid and is then resized back onto
the original page, so colors and resolution are kept.
"""

from __future__ import annotations

from itertools import combinations

import cv2
import numpy as np

CANON = 256                  # canonical square grid (pixels); 32 x 32 blocks of 8 x 8
BLOCK = 8
ID_BITS = 64
CRC_BITS = 16
CODE_BITS = ID_BITS + CRC_BITS
COEF_A = (1, 3)              # coefficient pair carrying each bit; low enough to survive blur
COEF_B = (3, 1)
STRENGTH = 18.0              # target coefficient gap on the canonical grid (about 3 grey levels)
KEY = 0xD0C0_4A12            # fixed public shuffle key; secrecy is not the goal here
MIN_CONFIDENCE = 0.35        # unmarked pages score below ~0.27; marked copies above ~0.4 (plus the CRC must match)
MAX_PUSH = 1.0               # largest correction per block, as a multiple of strength
REPAIR_CANDIDATES = 8        # weakest bits the CRC may repair (one or two flips)
HEAD_LOW, HEAD_HIGH = 3, 3   # brightness headroom so the mark is not clipped on pure black or white


def _crc16(bits: np.ndarray) -> np.ndarray:
    """CRC-16/CCITT-FALSE over a bit array, returned as 16 bits."""
    value = 0xFFFF
    for bit in bits.astype(np.uint8):
        value ^= int(bit) << 15
        value = ((value << 1) ^ 0x1021) & 0xFFFF if value & 0x8000 else (value << 1) & 0xFFFF
    return np.array([(value >> (15 - i)) & 1 for i in range(16)], dtype=np.uint8)


def _id_bits(watermark_id: int) -> np.ndarray:
    if not 0 < watermark_id < 1 << ID_BITS:
        raise ValueError("Watermark ID must be a nonzero 64-bit integer")
    bits = np.array([(watermark_id >> (ID_BITS - 1 - i)) & 1 for i in range(ID_BITS)], dtype=np.uint8)
    return np.concatenate([bits, _crc16(bits)])


def _layout() -> np.ndarray:
    """Bit index assigned to each block, shuffled so repeats spread over the page."""
    blocks = (CANON // BLOCK) ** 2
    order = np.arange(blocks) % CODE_BITS
    np.random.default_rng(KEY).shuffle(order)
    return order


_ASSIGN = _layout()
_N = CANON // BLOCK


def _dct_basis() -> np.ndarray:
    k = np.arange(BLOCK)
    basis = np.cos(np.pi * (2 * k[None, :] + 1) * k[:, None] / (2 * BLOCK))
    basis[0] *= np.sqrt(1 / BLOCK)
    basis[1:] *= np.sqrt(2 / BLOCK)
    return basis


_D = _dct_basis()


def _blocks(luma: np.ndarray) -> np.ndarray:
    return luma.reshape(_N, BLOCK, _N, BLOCK).transpose(0, 2, 1, 3).reshape(-1, BLOCK, BLOCK)


def _unblocks(blocks: np.ndarray) -> np.ndarray:
    return blocks.reshape(_N, _N, BLOCK, BLOCK).transpose(0, 2, 1, 3).reshape(CANON, CANON)


def _luma(image: np.ndarray) -> np.ndarray:
    if not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be an RGB uint8 array")
    return cv2.cvtColor(image, cv2.COLOR_RGB2YCrCb)[:, :, 0].astype(np.float32)


def embed(image: np.ndarray, watermark_id: int, strength: float | None = None) -> np.ndarray:
    """Return a copy of an RGB page with *watermark_id* hidden in its brightness."""
    strength = STRENGTH if strength is None else strength
    bits = _id_bits(watermark_id)
    _luma(image)  # validates the input
    ycc = cv2.cvtColor(image, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    height, width = ycc.shape[:2]
    canon = cv2.resize(ycc[:, :, 0], (CANON, CANON), interpolation=cv2.INTER_AREA)
    coeffs = _D @ _blocks(canon) @ _D.T
    sign = np.where(bits[_ASSIGN] == 1, 1.0, -1.0).astype(np.float32)
    gap = coeffs[:, COEF_A[0], COEF_A[1]] - coeffs[:, COEF_B[0], COEF_B[1]]
    # Push each block's gap to at least +/-strength in the direction of its bit; leave it if already there.
    # Capping the push keeps text-heavy blocks from getting visible corrections; the vote absorbs them.
    shortfall = np.clip(strength - sign * gap, 0.0, strength * MAX_PUSH)
    delta = np.zeros_like(coeffs)
    delta[:, COEF_A[0], COEF_A[1]] = sign * shortfall / 2
    delta[:, COEF_B[0], COEF_B[1]] = -sign * shortfall / 2
    change = _unblocks(_D.T @ delta @ _D)
    full = cv2.resize(change, (width, height), interpolation=cv2.INTER_CUBIC)
    # Keep headroom so the change is not lost to clipping on pure white or black.
    scale = (255 - HEAD_LOW - HEAD_HIGH) / 255
    ycc[:, :, 0] = np.clip(ycc[:, :, 0] * scale + HEAD_LOW + full, 0, 255)
    return cv2.cvtColor(np.round(ycc).astype(np.uint8), cv2.COLOR_YCrCb2RGB)


def _votes(luma: np.ndarray) -> np.ndarray:
    canon = cv2.resize(luma, (CANON, CANON), interpolation=cv2.INTER_AREA)
    coeffs = _D @ _blocks(canon) @ _D.T
    gap = coeffs[:, COEF_A[0], COEF_A[1]] - coeffs[:, COEF_B[0], COEF_B[1]]
    gap = np.clip(gap / STRENGTH, -2, 2)
    return np.bincount(_ASSIGN, weights=gap, minlength=CODE_BITS) / np.bincount(_ASSIGN, minlength=CODE_BITS)


def _decode(votes: np.ndarray) -> int | None:
    """Read the ID from bit votes, repairing up to two of the weakest bits with the CRC."""
    bits = (votes > 0).astype(np.uint8)
    weakest = np.argsort(np.abs(votes))[:REPAIR_CANDIDATES]
    trials = [()] + [(i,) for i in weakest] + list(combinations(weakest, 2))
    for flips in trials:
        trial = bits.copy()
        trial[list(flips)] ^= 1
        if np.array_equal(_crc16(trial[:ID_BITS]), trial[ID_BITS:]):
            value = int("".join(map(str, trial[:ID_BITS])), 2)
            if value:
                return value
    return None


def extract(image: np.ndarray) -> dict:
    """Look for a watermark in an upright or rotated page; returns found, id and confidence."""
    luma = _luma(image)
    best = {"found": False, "watermark_id": None, "confidence": 0.0, "rotation": 0}
    for turns in range(4):
        votes = _votes(np.ascontiguousarray(np.rot90(luma, -turns)))
        confidence = float(np.mean(np.abs(votes)))
        if confidence > best["confidence"] and not best["found"]:
            best.update(confidence=confidence, rotation=turns * 90)
        if confidence < MIN_CONFIDENCE or (best["found"] and confidence <= best["confidence"]):
            continue
        value = _decode(votes)
        if value is not None:
            best = {"found": True, "watermark_id": value, "confidence": confidence, "rotation": turns * 90}
    best["confidence"] = round(best["confidence"], 3)
    return best


def format_id(watermark_id: int) -> str:
    return f"0x{watermark_id:016x}"
