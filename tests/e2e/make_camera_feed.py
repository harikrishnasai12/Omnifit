"""
Turn a photo into a fake webcam feed (.y4m) for the browser, so a test can
use the real camera flow: Edge/Chrome play it with
--use-file-for-fake-video-capture=<file>.

Usage (with the backend venv):
    python tests/e2e/make_camera_feed.py <photo.jpg> <out.y4m>
"""

import sys

import numpy as np
from PIL import Image

WIDTH, HEIGHT, FRAMES = 1280, 720, 2


def main(photo: str, out: str) -> None:
    # The photo centred on a soft grey wall, like a webcam view
    canvas = Image.new("RGB", (WIDTH, HEIGHT), (226, 224, 230))
    image = Image.open(photo).convert("RGB")
    image.thumbnail((WIDTH, HEIGHT))
    canvas.paste(image, ((WIDTH - image.width) // 2, (HEIGHT - image.height) // 2))

    ycbcr = np.asarray(canvas.convert("YCbCr"))
    y = ycbcr[:, :, 0]
    # 4:2:0 chroma: average each 2x2 block
    cb = ycbcr[:, :, 1].reshape(HEIGHT // 2, 2, WIDTH // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    cr = ycbcr[:, :, 2].reshape(HEIGHT // 2, 2, WIDTH // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    frame = y.tobytes() + cb.tobytes() + cr.tobytes()

    with open(out, "wb") as feed:
        feed.write(f"YUV4MPEG2 W{WIDTH} H{HEIGHT} F30:1 Ip A1:1 C420jpeg\n".encode())
        for _ in range(FRAMES):
            feed.write(b"FRAME\n" + frame)
    print(f"{out}: {WIDTH}x{HEIGHT}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
