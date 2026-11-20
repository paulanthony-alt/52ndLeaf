/* Builds small EXIF blocks for tests, so no real photos need to be checked in. */
function exifBlock({ date, gps = false, little = true } = {}) {
  const dateBytes = date ? Buffer.from(date + '\0', 'latin1') : null; // "YYYY:MM:DD HH:MM:SS\0" = 20 bytes
  const entries0 = [];
  if (date) entries0.push('exif');
  if (gps) entries0.push('gps');
  const ifd0Size = 2 + entries0.length * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = date ? 2 + 12 + 4 : 0;
  const dateOff = exifOff + exifSize;
  const gpsOff = dateOff + (date ? dateBytes.length : 0);
  const total = gpsOff + (gps ? 2 + 12 + 4 : 0);
  const b = Buffer.alloc(total);
  const w16 = (o, v) => (little ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (o, v) => (little ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  b.write(little ? 'II' : 'MM', 0, 'latin1');
  w16(2, 42); w32(4, 8);
  w16(8, entries0.length);
  let e = 10;
  if (date) { w16(e, 0x8769); w16(e + 2, 4); w32(e + 4, 1); w32(e + 8, exifOff); e += 12; }
  if (gps) { w16(e, 0x8825); w16(e + 2, 4); w32(e + 4, 1); w32(e + 8, gpsOff); e += 12; }
  if (date) {
    w16(exifOff, 1);
    w16(exifOff + 2, 0x9003); w16(exifOff + 4, 2); w32(exifOff + 6, dateBytes.length); w32(exifOff + 10, dateOff);
    dateBytes.copy(b, dateOff);
  }
  if (gps) {
    w16(gpsOff, 1);
    w16(gpsOff + 2, 1); w16(gpsOff + 4, 2); w32(gpsOff + 6, 2); b.write('N\0', gpsOff + 10, 'latin1');
  }
  const header = Buffer.from('Exif\0\0', 'latin1');
  const len = 2 + header.length + b.length;
  const seg = Buffer.alloc(2 + 2);
  seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(len, 2);
  return Buffer.concat([seg, header, b]);
}

// Puts an EXIF block right after the JPEG start marker.
function withExif(jpeg, block) {
  return Buffer.concat([jpeg.subarray(0, 2), block, jpeg.subarray(2)]);
}

// A bare, structurally valid JPEG header + end marker (enough for the parsers; not displayable).
const STUB_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);

module.exports = { exifBlock, withExif, STUB_JPEG };
