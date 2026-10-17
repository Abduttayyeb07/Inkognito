"""Exact file hashes and 64-bit per-page perceptual hashes."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

import imagehash
import numpy as np
from PIL import Image


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def phash_hex(image: np.ndarray) -> str:
    """Return a 16-character hex pHash from an RGB uint8 image."""
    if not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be an RGB uint8 array")
    return str(imagehash.phash(Image.fromarray(image, mode="RGB"), hash_size=8))


def hamming_distance(left: str, right: str) -> int:
    if len(left) != 16 or len(right) != 16:
        raise ValueError("pHashes must be 16 hex characters")
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError as exc:
        raise ValueError("pHashes must be hexadecimal") from exc


def phash_root(page_hashes: Sequence[str]) -> str:
    """Hash the concatenation of canonical 16-character page hashes, in page order."""
    if not page_hashes:
        raise ValueError("At least one page hash is required")
    for value in page_hashes:
        if len(value) != 16:
            raise ValueError("pHashes must be 16 hex characters")
        try:
            int(value, 16)
        except ValueError as exc:
            raise ValueError("pHashes must be hexadecimal") from exc
    return sha256_bytes("".join(value.lower() for value in page_hashes).encode("ascii"))
