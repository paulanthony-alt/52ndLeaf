const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../exif.js');
const { exifBlock, withExif, STUB_JPEG } = require('../helpers/jpeg.js');

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const photo = (opts) => ab(withExif(STUB_JPEG, exifBlock(opts)));

test('reads the date a photo was taken, in both byte orders', () => {
  for (const little of [true, false]) {
    const d = E.readTakenDate(photo({ date: '2026:11:03 14:22:10', little }));
    assert.ok(d, `found date (${little ? 'II' : 'MM'})`);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 10, 3, 14, 22, 10]);
  }
});

test('the date is local time, not shifted by the time zone', () => {
  const d = E.readTakenDate(photo({ date: '2026:01:01 00:30:00' }));
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 0);
});

test('returns null when there is nothing usable', () => {
  assert.equal(E.readTakenDate(ab(STUB_JPEG)), null);                                  // no EXIF
  assert.equal(E.readTakenDate(photo({})), null);                                      // EXIF with no date
  assert.equal(E.readTakenDate(photo({ date: '0000:00:00 00:00:00' })), null);         // camera that never had a clock
  assert.equal(E.readTakenDate(photo({ date: 'not a date at all!!' })), null);
  assert.equal(E.readTakenDate(new ArrayBuffer(0)), null);
  assert.equal(E.readTakenDate(ab(Buffer.from('GIF89a...', 'latin1'))), null);         // not a JPEG
});

test('survives truncated and corrupted data without throwing', () => {
  const full = withExif(STUB_JPEG, exifBlock({ date: '2026:11:03 14:22:10', gps: true }));
  for (let n = 0; n < full.length; n++) {
    assert.doesNotThrow(() => E.readTakenDate(ab(full.subarray(0, n))));
    assert.doesNotThrow(() => E.hasExif(ab(full.subarray(0, n))));
  }
  const bad = Buffer.from(full);
  for (let i = 4; i < bad.length; i += 3) bad[i] ^= 0xff;
  assert.doesNotThrow(() => E.readTakenDate(ab(bad)));
});

test('hasExif spots EXIF blocks, including ones that only carry location', () => {
  assert.equal(E.hasExif(photo({ date: '2026:11:03 14:22:10' })), true);
  assert.equal(E.hasExif(photo({ gps: true })), true);
  assert.equal(E.hasExif(ab(STUB_JPEG)), false);
  assert.equal(E.hasExif(new ArrayBuffer(3)), false);
});
