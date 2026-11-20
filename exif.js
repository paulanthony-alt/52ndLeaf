/* Reads the date a photo was taken from its EXIF data. No DOM, so it runs in tests too.
 * Only the first few hundred KB of a JPEG are needed, since EXIF sits at the start. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeafExif = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Finds the Exif segment of a JPEG: where its TIFF block starts.
  function findExif(view) {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= view.byteLength) {
      if (view.getUint8(off) !== 0xff) return null;
      const marker = view.getUint8(off + 1);
      if (marker === 0xff) { off += 1; continue; }          // fill byte
      if (marker === 0xda || marker === 0xd9) return null;   // image data starts
      const len = view.getUint16(off + 2);
      if (marker === 0xe1 && len >= 8 && off + 10 <= view.byteLength &&
          view.getUint32(off + 4) === 0x45786966 && view.getUint16(off + 8) === 0) {
        return { tiff: off + 10, end: Math.min(view.byteLength, off + 2 + len) };
      }
      off += 2 + len;
    }
    return null;
  }

  function hasExif(buffer) {
    try { return !!findExif(new DataView(buffer)); } catch (e) { return false; }
  }

  // Returns a Date in local time, or null when the photo has no usable date.
  function readTakenDate(buffer) {
    try {
      const view = new DataView(buffer);
      const found = findExif(view);
      if (!found) return null;
      const { tiff, end } = found;
      const order = view.getUint16(tiff);
      if (order !== 0x4949 && order !== 0x4d4d) return null;
      const le = order === 0x4949;
      const u16 = (o) => view.getUint16(o, le);
      const u32 = (o) => view.getUint32(o, le);
      if (u16(tiff + 2) !== 42) return null;

      function ifd(rel) {
        const start = tiff + rel, out = {};
        if (start + 2 > end) return out;
        const count = u16(start);
        for (let i = 0; i < count; i++) {
          const e = start + 2 + i * 12;
          if (e + 12 > end) break;
          out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
        }
        return out;
      }
      function ascii(entry) {
        if (!entry || entry.type !== 2) return null;
        const at = entry.count > 4 ? tiff + u32(entry.at) : entry.at;
        if (at < 0 || at + entry.count > end) return null;
        let s = '';
        for (let i = 0; i < entry.count && view.getUint8(at + i) !== 0; i++) s += String.fromCharCode(view.getUint8(at + i));
        return s;
      }

      const ifd0 = ifd(u32(tiff + 4));
      const exifPtr = ifd0[0x8769];
      const exifIfd = exifPtr ? ifd(u32(exifPtr.at)) : {};
      const raw = ascii(exifIfd[0x9003]) || ascii(exifIfd[0x9004]) || ascii(ifd0[0x0132]);
      const m = raw && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
      if (!m) return null;
      const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
      if (!y || !mo || !d) return null;
      const date = new Date(y, mo - 1, d, h, mi, s);
      return isNaN(date.getTime()) ? null : date;
    } catch (e) {
      return null;
    }
  }

  return { hasExif, readTakenDate };
});
