# Changelog

## 0.3.0

- **Show All Images in File**: a grid of every image in the file, with its
  line and key; click one to jump to it.
- **Gutter thumbnails** next to lines with inline images
  (`imagePreview.gutterThumbnails`, off by default).
- **Images to base64**: paste a screenshot, or drop an image file and pick
  *Insert image as data URI / as base64*; *Insert Image as Base64…* command;
  *Copy as Data URI* in the Explorer. New settings `imagePreview.insertFormat`
  and `imagePreview.pasteAndDrop`.
- Temp files live in a folder per window, deleted when the window closes.
  Folders left by crashed windows are cleaned up by the next window.

## 0.2.0

- The hover shows the image's pixel size, for example `600×400`.
- New hover actions: **Save**, copy as **Data URI**, copy as **Base64**, and
  open in an **External** viewer, next to **Open full**.
- The thumbnail always fits in the hover, so the actions stay visible.
- No runtime dependencies: the package went from 22.6 MB to a few KB, so it
  installs and starts faster.

## 0.1.1

- New icon, README screenshot, and Marketplace description.

## 0.1.0

- Hover previews for raw base64, data URIs, and image URLs, including
  extension-less URLs checked by `Content-Type`.
- *Open full* preview tab and the *Preview Selection / String* command.
