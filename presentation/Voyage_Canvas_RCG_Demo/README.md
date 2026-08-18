# Stale export folder

Earlier PNG exports lived here but were **not** kept in sync with `Voyage_Canvas_RCG_Demo.pptx`, so they were removed.

For submission, use the PPTX directly.

Full deck regeneration via `create-voyage-canvas-deck.mjs` requires the `@oai/artifact-tool`
package, which is not available on public npm, so the deck is maintained by patching the
PPTX in place instead.

The patch scripts need `python-pptx` and `Pillow`. They are not committed, so install them
into the local `.pydeps` directory the commands below expect:

```bash
python3 -m pip install --target presentation/build/.pydeps python-pptx Pillow
```

Fix slide text and layout:

```bash
PYTHONPATH=presentation/build/.pydeps python3 presentation/build/update-deck-slides.py
```

Refresh the embedded app screenshots (needs `pnpm dev` running on port 3000):

```bash
node presentation/build/capture-screenshots.mjs
PYTHONPATH=presentation/build/.pydeps python3 presentation/build/embed-screenshots.py
```

Both scripts are idempotent and update `presentation/Voyage_Canvas_RCG_Demo.pptx` plus the
repo-root copy.
