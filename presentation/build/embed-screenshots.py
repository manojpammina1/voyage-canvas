#!/usr/bin/env python3
"""Re-embed presentation/screenshots/*.png into the demo decks.

The deck builder (create-voyage-canvas-deck.mjs) needs @oai/artifact-tool, which is
not on public npm, so the deck cannot be regenerated after re-capturing screenshots.
This swaps the image bytes inside the existing PPTX instead, which keeps every slide's
layout untouched.

Run after presentation/build/capture-screenshots.mjs:

    PYTHONPATH=presentation/build/.pydeps python3 presentation/build/embed-screenshots.py
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image
from pptx import Presentation

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "presentation" / "screenshots"
DECK_PATHS = [
    ROOT / "presentation" / "Voyage_Canvas_RCG_Demo.pptx",
    ROOT / "Voyage_Canvas_RCG_Demo.pptx",
]

# Media part name inside the PPTX -> source screenshot. The intent screen is used on
# both the title slide and the intent slide, so it maps to two parts.
MEDIA_TO_SHOT = {
    "image.png": "01-intent-screen.png",
    "image2.png": "01-intent-screen.png",
    "image3.png": "02-materializing.png",
    "image4.png": "03-orbit-results.png",
    "image5.png": "04-direct-manipulation.png",
    "image6.png": "04-price-answer.png",
    "image7.png": "05-availability-answer.png",
    "image8.png": "06-policy-rag-answer.png",
    "image9.png": "07-prompt-injection-defense.png",
    "image10.png": "08-auth-boundary.png",
    "image11.png": "09-signed-in.png",
    "image12.png": "10-hold-created.png",
    "image13.png": "11-checkout-handoff.png",
    "image14.png": "12-ai-outage-fallback.png",
}


def load_shots() -> dict[str, bytes]:
    shots: dict[str, bytes] = {}
    for name in sorted(set(MEDIA_TO_SHOT.values())):
        path = SHOTS / name
        if not path.exists():
            raise SystemExit(f"Missing screenshot: {path}")
        shots[name] = path.read_bytes()
    return shots


def embed(path: Path, shots: dict[str, bytes]) -> None:
    presentation = Presentation(str(path))
    replaced = []
    skipped = []

    for part in presentation.part.package.iter_parts():
        name = Path(str(part.partname)).name
        shot_name = MEDIA_TO_SHOT.get(name)
        if shot_name is None:
            continue

        # A different pixel size would restretch the picture inside its frame.
        old_size = Image.open(io.BytesIO(part.blob)).size
        new_size = Image.open(io.BytesIO(shots[shot_name])).size
        if old_size != new_size:
            skipped.append(f"{name} ({old_size} -> {new_size})")
            continue

        part._blob = shots[shot_name]
        replaced.append(f"{name} <- {shot_name}")

    presentation.save(str(path))
    print(f"{path.name}: replaced {len(replaced)} images")
    for line in replaced:
        print(f"  {line}")
    for line in skipped:
        print(f"  SKIPPED size mismatch: {line}")


def main() -> int:
    shots = load_shots()
    targets = [Path(arg) for arg in sys.argv[1:]] or DECK_PATHS
    for path in targets:
        if not path.exists():
            print(f"Skip missing deck: {path}", file=sys.stderr)
            continue
        embed(path, shots)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
