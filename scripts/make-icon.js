'use strict';
// Generates icon.png (128x128) — a simple photo/mountain glyph. Reproducible so
// the marketplace icon can be regenerated. Run: node scripts/make-icon.js
const Jimp = require('jimp');
const path = require('path');

const S = 128;
const R = 26; // corner radius for the rounded background

const BLUE = [59, 130, 246];
const WHITE = [255, 255, 255];
const SKY = [191, 219, 254];
const SUN = [251, 191, 36];
const HILL = [34, 197, 94];
const HILL2 = [22, 163, 74];

function inRoundedRect(x, y, size, r) {
  const min = r;
  const max = size - 1 - r;
  const cx = x < min ? min : x > max ? max : x;
  const cy = y < min ? min : y > max ? max : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

new Jimp(S, S, 0x00000000, (err, image) => {
  if (err) throw err;
  image.scan(0, 0, S, S, function (x, y, idx) {
    let color = null;
    let alpha = 255;

    if (!inRoundedRect(x, y, S, R)) {
      this.bitmap.data.writeUInt32BE(0x00000000, idx);
      return;
    }
    color = BLUE;

    // white photo frame
    if (x >= 16 && x < 112 && y >= 16 && y < 112) color = WHITE;

    // inner scene
    if (x >= 22 && x < 106 && y >= 22 && y < 106) {
      color = SKY;
      // sun
      const sdx = x - 46;
      const sdy = y - 44;
      if (sdx * sdx + sdy * sdy <= 11 * 11) color = SUN;
      // two mountain ridges
      const ridgeA = 54 + Math.abs(x - 74) * 1.05;
      const ridgeB = 66 + Math.abs(x - 44) * 1.25;
      if (y >= ridgeA) color = HILL2;
      else if (y >= ridgeB) color = HILL;
    }

    const [r, g, b] = color;
    this.bitmap.data.writeUInt32BE(
      ((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0,
      idx
    );
  });

  const out = path.join(__dirname, '..', 'icon.png');
  image.write(out, (e) => {
    if (e) throw e;
    console.log('wrote', out);
  });
});
