#!/usr/bin/env python3
"""Generate the pre-blurred ambient variants of the hero photos.

`.vc-ambient` is a full-viewport layer that sits behind the glass panels and
behind the orbit animation. Applying `filter: blur()` to a full-viewport image
forces the compositor to re-rasterise a large surface every frame, which janks
the orbit. So the blur is baked into the asset instead: downscale hard, blur the
small copy, and let `background-size: cover` scale it back up.

Run from the repo root:

    python scripts/generate-ambient-blur.py

Inputs  : apps/web/public/assets/hero-{desktop,mobile}.webp
Outputs : apps/web/public/assets/hero-{desktop,mobile}-ambient.webp
"""

from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

ASSETS = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "assets"

# (source stem, width of the downscaled working copy)
VARIANTS = [
    ("hero-desktop", 560),
    ("hero-mobile", 440),
]

# Gaussian radius applied to the downscaled copy. At a 560px working width this
# is ~22px of blur relative to the original 1376px image — enough to stop the
# photo competing with the glass panels, but not so much that the beach scene
# dissolves into an anonymous gradient.
BLUR_RADIUS = 9


def build(stem: str, target_width: int) -> None:
    src = ASSETS / f"{stem}.webp"
    dst = ASSETS / f"{stem}-ambient.webp"

    with Image.open(src) as im:
        im = im.convert("RGB")
        ratio = target_width / im.width
        small = im.resize(
            (target_width, max(1, round(im.height * ratio))),
            Image.LANCZOS,
        )
        blurred = small.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
        blurred.save(dst, "WEBP", quality=80, method=6)

    stat = ImageStat.Stat(blurred.convert("L"))
    print(
        f"{dst.name}: {blurred.size[0]}x{blurred.size[1]} "
        f"{dst.stat().st_size / 1024:.1f} KiB  "
        f"luma min/max {stat.extrema[0]}  mean {stat.mean[0]:.0f}"
    )


if __name__ == "__main__":
    for stem, width in VARIANTS:
        build(stem, width)
