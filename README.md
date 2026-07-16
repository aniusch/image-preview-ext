# Inline Image Preview

A tiny, zero-build VSCode / Cursor extension that previews images embedded in text:

- **Raw base64** blobs (no `data:` prefix) — detected by magic bytes (JPEG, PNG, GIF, WebP, BMP, ICO, SVG). This is the shape used by the sample payloads (`objectBase64` fields).
- **Data URIs** — `data:image/png;base64,...`
- **Image URLs** — `https://.../foo.png` (fetched and inlined so they render reliably).

## Features

1. **Hover preview** — hover the cursor over any of the above and a small
   thumbnail (max 300px, downscaled via `jimp`) renders inline in the tooltip,
   with mime type + size and an **Open full** link.
2. **Open full** — the hover link (and the command below) opens the full-size
   image in a resizable preview tab.
3. **Command** — `Image Preview: Preview Selection / String` (Command Palette)
   opens the full preview tab from the current selection, the token under the
   cursor, or a pasted string.

Images are decoded to temp files (`$TMPDIR/vscode-inline-image-preview/`) and
referenced by URI, which avoids the data-URI length limit that otherwise stops
large images from rendering in hovers.

## Try it

Open the folder in VSCode/Cursor and press <kbd>F5</kbd> ("Run Extension") to
launch an Extension Development Host with `samples/` loaded. Open a sample JSON
and hover over the long `objectBase64` value.

## Install & share (VSCode + Cursor)

The extension is packaged as a single `.vsix` that installs on both editors.

**Build the package** (produces `inline-image-preview-<version>.vsix`):

```
npm install
npm run package
```

**Install the `.vsix`** — hand the file to anyone; it works the same in VSCode and
Cursor:

- **GUI:** Extensions view → `···` menu → **Install from VSIX…** → pick the file.
- **CLI:** `code --install-extension inline-image-preview-0.0.1.vsix`
  (Cursor: `cursor --install-extension inline-image-preview-0.0.1.vsix`)

Reload the window after installing.

> Listing it for one-click install: publish to the **VS Marketplace** (VSCode)
> and **Open VSX** (Cursor). See [`PUBLISHING.md`](./PUBLISHING.md) for the full
> walkthrough. The `.vsix` above needs no accounts and is the quickest way to
> share with a few people.

### Local development install

`install.sh` symlinks this folder into your editor's extensions dir for live
editing. The manifest loads the bundled `dist/extension.js`, so build it first
(`npm run build`, or `npm run watch` to rebuild on save). Pressing <kbd>F5</kbd>
launches a dev host with `samples/` loaded (also uses the bundle — keep `watch`
running).

## Test

```
npm test
```

Runs the pure detection logic against the real sample payloads.

## How it works

- `src/detect.js` — pure, dependency-free detection (token scanning + magic-byte
  classification). Unit-tested.
- `extension.js` — the `vscode` glue: the `HoverProvider`, thumbnailing, and the
  preview/open-full commands.

No build step, no bundler, no TypeScript compile — plain CommonJS the editor runs
directly. `jimp` (pure JS, no native build) is the one runtime dependency, used
to downscale hover thumbnails; run `npm install` before first use.
