"""Generate five deterministic synthetic document images and PDFs for learning/tests."""

from pathlib import Path

import cv2
import numpy as np

from backend.app.cv.io_pdf import images_to_pdf


def main() -> None:
    out = Path(__file__).parent
    for index in range(1, 6):
        page = np.full((990, 700, 3), 255, dtype=np.uint8)
        cv2.rectangle(page, (40, 40), (660, 950), (30, 40, 65), 2)
        cv2.putText(page, f"SAMPLE DOCUMENT {index}", (72, 110),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (30, 40, 65), 2, cv2.LINE_AA)
        for row in range(10):
            y = 180 + row * 64
            cv2.putText(page, f"Record {index:02d}-{row:02d}  Reference: {index * 137 + row}",
                        (76, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (40, 50, 70), 1, cv2.LINE_AA)
            cv2.line(page, (75, y + 15), (625 - ((row + index) % 4) * 34, y + 15),
                     (170, 180, 190), 1)
        cv2.rectangle(page, (78, 820), (245, 880), (70, 110, 140), -1)
        cv2.putText(page, "APPROVED", (88, 856), cv2.FONT_HERSHEY_SIMPLEX,
                    0.51, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imwrite(str(out / f"document_{index:02d}.png"), cv2.cvtColor(page, cv2.COLOR_RGB2BGR))
        (out / f"document_{index:02d}.pdf").write_bytes(images_to_pdf([page], dpi=100))


if __name__ == "__main__":
    main()
