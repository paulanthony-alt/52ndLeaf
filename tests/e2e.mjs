/* End-to-end test: drives the real app in a headless browser.
 * Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 * Run with: npm run test:e2e
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { exifBlock, withExif } = require('./helpers/jpeg.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.E2E_OUT || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'leaf-e2e-'));

/* ---- a tiny static server for the app folder */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR_/.test(m.text())) errors.push(m.text()); });

let step = 0;
const ok = (msg) => console.log(`  ok ${String(++step).padStart(2)}  ${msg}`);

/* ---- helpers */
const jpegs = new Map();
async function jpeg(color, { exif } = {}) {
  const key = color + (exif ? JSON.stringify(exif) : '');
  if (!jpegs.has(key)) {
    const url = await page.evaluate((c) => {
      const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 1500;
      const g = cv.getContext('2d');
      g.fillStyle = '#c8d6e5'; g.fillRect(0, 0, 1200, 1500);
      g.fillStyle = '#586f47'; g.fillRect(0, 1000, 1200, 500);
      g.fillStyle = c; g.beginPath(); g.arc(600, 500, 320, 0, 7); g.fill();
      return cv.toDataURL('image/jpeg', 0.85);
    }, color);
    let buf = Buffer.from(url.split(',')[1], 'base64');
    if (exif) buf = withExif(buf, exifBlock(exif));
    jpegs.set(key, buf);
  }
  return { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpegs.get(key) };
}
const go = async (hash) => { await page.goto(base + hash); await page.waitForTimeout(120); };
async function addLeaf(week, color, fields = {}, opts = {}) {
  await go(`#/add/2026/${week}`);
  await page.waitForSelector('#photo', { state: 'attached' });
  await page.setInputFiles('#photo', await jpeg(color, opts));
  await page.waitForSelector('.frame.is-photo');
  for (const [k, v] of Object.entries(fields)) await page.fill('#' + k, v);
  await page.click('#save');
  await page.waitForSelector('.leaf-photo img');
}
const readLeaves = () => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('52nd-leaf'); r.onsuccess = () => res(r.result); });
  return new Promise((res) => { const g = db.transaction('leaves').objectStore('leaves').getAll(); g.onsuccess = () => res(g.result.map((l) => ({ id: l.id, spot: l.spot, title: l.title, size: l.photo.size }))); });
});

/* The tests assume this "today" so week numbers are stable: Fri 20 Nov 2026 = week 47. */
await context.addInitScript(() => {
  const real = Date, fixed = new real(2026, 10, 20, 12).getTime(), start = real.now();
  class FakeDate extends real {
    constructor(...a) { if (a.length) super(...a); else super(fixed + (real.now() - start)); }
    static now() { return fixed + (real.now() - start); }
  }
  window.Date = FakeDate;
});

console.log('52nd Leaf end-to-end');

/* ---- 1. empty start */
await go('');
assert.match(await page.textContent('h1'), /first leaf starts here/);
assert.ok(await page.isVisible('footer >> text=Backup & restore'));
ok('empty journal shows the start screen and footer links');

/* ---- 2. hints */
await go('#/add');
const hint1 = await page.textContent('#prompt-text');
assert.ok(hint1.length > 20, 'hint text');
await page.click('#prompt-next');
assert.notEqual(await page.textContent('#prompt-text'), hint1);
ok('add screen shows a season hint and "Another idea" changes it');
await page.click('#prompt-hide');
await go('#/add');
assert.ok(await page.isHidden('#prompt'));
await go('#/backup');
assert.equal(await page.isChecked('#st-hints'), false);
await page.check('#st-hints');
await go('#/add');
assert.ok(await page.isVisible('#prompt'));
ok('hiding hints sticks, and the Backup page turns them back on');

/* ---- 3. spots and the guide */
await addLeaf(40, '#8aa86a', { place: 'Trail', spot: 'Maple by the trail' });
await addLeaf(43, '#c08a3e', { spot: 'maple BY the trail ' });
await addLeaf(45, '#b46a3c', { spot: 'Pond' });
let leaves = await readLeaves();
assert.equal(leaves.find((l) => l.id === '2026-43').spot, 'Maple by the trail');
ok('spot names are tidied and reuse the first spelling');
await go('#/add/2026/46');
await page.setInputFiles('#photo', await jpeg('#a07040'));
await page.waitForSelector('.frame.is-photo');
assert.match(await page.textContent('#ghost-tag'), /Faded: week 45$/);
await page.fill('#spot', 'maple by the trail');
assert.match(await page.textContent('#ghost-tag'), /Faded: week 43, same spot/);
await page.fill('#spot', '');
assert.match(await page.textContent('#ghost-tag'), /Faded: week 45$/);
ok('naming a spot switches the guide to your last photo from that spot');
await page.fill('#spot', 'Maple by the trail');
await page.click('#save'); await page.waitForSelector('.leaf-photo img');
assert.ok(await page.isVisible('.spot-line a'));
await go('#/spots');
assert.equal(await page.locator('.spot-card').count(), 2);
await page.screenshot({ path: path.join(out, 'desk-spots.png') });
await page.click('.spot-card:has-text("Maple by the trail")');
await page.waitForSelector('.spot-leaf');
assert.equal(await page.locator('.spot-leaf').count(), 3);
ok('spots page lists both spots; the spot page shows its 3 photos');

/* rename + merge */
await page.click('#rename');
await page.fill('#rename-input', 'Old maple');
await page.click('#rename-form button[type=submit]');
await page.waitForSelector('#spot-title:has-text("Old maple")');
assert.equal((await readLeaves()).filter((l) => l.spot === 'Old maple').length, 3);
await page.click('#rename'); await page.fill('#rename-input', 'pond');
page.once('dialog', (d) => d.accept());
await page.click('#rename-form button[type=submit]');
await page.waitForSelector('#spot-title:has-text("Pond")');
assert.equal((await readLeaves()).filter((l) => l.spot === 'Pond').length, 4);
ok('renaming a spot updates its photos; renaming onto another merges them');

/* ---- 4. photos find their own week */
await go('#/add');                                                  // this is week 47
await page.setInputFiles('#photo', await jpeg('#d08a5a', { exif: { date: '2026:10:07 10:00:00', gps: true } }));
await page.waitForSelector('#suggest:not([hidden])');
assert.match(await page.textContent('#suggest'), /taken on Oct 7, in week 41/);
await page.screenshot({ path: path.join(out, 'desk-suggest.png') });
await page.click('#suggest-go');
await page.waitForFunction(() => location.hash === '#/add/2026/41');
await page.waitForSelector('.eyebrow:has-text("Week 41")');
await page.waitForSelector('.frame.is-photo');
assert.ok(await page.isHidden('#suggest'));
await page.click('#save'); await page.waitForSelector('.leaf-photo img');
leaves = await readLeaves();
assert.ok(leaves.some((l) => l.id === '2026-41') && !leaves.some((l) => l.id === '2026-47'));
ok('a photo taken in another week offers to move there, and keeps the photo');
await go('#/add');
await page.setInputFiles('#photo', await jpeg('#d08a5a', { exif: { date: '2026:11:18 10:00:00' } }));
await page.waitForSelector('.frame.is-photo'); await page.waitForTimeout(250);
assert.ok(await page.isHidden('#suggest'));
await page.setInputFiles('#photo', await jpeg('#d08a5a', { exif: { date: '2027:03:01 10:00:00' } }));
await page.waitForTimeout(250);
assert.ok(await page.isHidden('#suggest'));
await page.setInputFiles('#photo', await jpeg('#d08a5a'));
await page.waitForTimeout(250);
assert.ok(await page.isHidden('#suggest'));
ok('no suggestion for this week, a future date, or a photo with no date');
await go('#/add');
await page.setInputFiles('#photo', await jpeg('#d08a5a', { exif: { date: '2026:10:20 10:00:00' } }));   // week 43, already saved
await page.waitForSelector('#suggest:not([hidden])');
assert.match(await page.textContent('#suggest'), /already has a photo/);
await page.click('#suggest-go');
await page.waitForSelector('.eyebrow:has-text("Week 43")');
await page.waitForSelector('#info:not([hidden])');
assert.match(await page.textContent('#info'), /already has a photo/);
ok('moving to a week that is filled warns before replacing');

/* ---- 5. compare */
await addLeaf(47, '#e0a050', { title: 'This week' });
await go('#/compare');
assert.equal(await page.inputValue('#cmp-a'), '2026-40');
assert.equal(await page.inputValue('#cmp-b'), '2026-47');
await page.fill('.s-range', '35');
await page.screenshot({ path: path.join(out, 'desk-compare.png') });
await page.fill('.s-range', '20');
assert.equal(await page.$eval('#slider', (e) => e.style.getPropertyValue('--pos')), '20%');
await page.selectOption('#cmp-a', '2026-43');
assert.equal(new URL(page.url()).hash, '#/compare/2026-43/2026-47');
await page.click('#cmp-swap');
assert.equal(new URL(page.url()).hash, '#/compare/2026-47/2026-43');
await page.click('[data-view=side]');
assert.equal(await page.locator('.side-by-side figure').count(), 2);
await go('#/compare/2026-41/2026-44');                       // 44 doesn't exist: falls back to the latest
assert.equal(await page.inputValue('#cmp-b'), '2026-47');
assert.ok(await page.isVisible('.side-by-side'), 'remembers side by side');
ok('compare: slider, pickers, swap, side by side, bad ids, remembered view');
await go('#/leaf/2026/43');
await page.click('.leaf-tools >> text=Compare');
await page.waitForSelector('.cmp-caps, .side-by-side');
assert.match(new URL(page.url()).hash, /^#\/compare\/2026-40\/2026-43$/);
ok('the Compare link on a leaf starts from its spot');

/* ---- 6. backup, restore, and no location data */
await page.evaluate(async (b64) => {                         // a leaf stored with GPS, as an older version might have
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const db = await new Promise((res) => { const r = indexedDB.open('52nd-leaf'); r.onsuccess = () => res(r.result); });
  await new Promise((res) => { const tx = db.transaction('leaves', 'readwrite'); tx.objectStore('leaves').put({ id: '2026-30', year: 2026, week: 30, title: 'Has GPS', note: '', place: '', weather: '', photo: new Blob([bin], { type: 'image/jpeg' }) }); tx.oncomplete = res; });
}, (await jpeg('#99aa55', { exif: { date: '2026:07:20 09:00:00', gps: true } })).buffer.toString('base64'));
await go('');
assert.ok(await page.isVisible('text=Back up your journal'));
await go('#/backup');
await page.screenshot({ path: path.join(out, 'desk-backup.png'), fullPage: true });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bk-go')]);
assert.match(dl.suggestedFilename(), /^52nd-leaf-backup-2026-11-20\.json$/);
const file = path.join(out, 'backup.json');
await dl.saveAs(file);
const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(backup.app, '52nd-leaf');
const before = await readLeaves();
assert.equal(backup.leaves.length, before.length);
for (const l of backup.leaves) {
  const bytes = Buffer.from(l.photo.split(',')[1], 'base64');
  assert.ok(!bytes.subarray(0, 4000).includes(Buffer.from('Exif\0\0', 'latin1')), `${l.id} has no EXIF block`);
}
assert.ok(backup.leaves.some((l) => l.spot === 'Pond'), 'spots are in the backup');
ok(`backup downloads ${before.length} leaves; none carry EXIF or location data`);
await page.waitForSelector('#bk-status:has-text("Backup made")');
await go('');
assert.ok(await page.isHidden('text=Back up your journal'));
ok('the backup reminder goes away after a backup');

await page.evaluate(async () => {                            // wipe everything, like cleared site data
  const db = await new Promise((res) => { const r = indexedDB.open('52nd-leaf'); r.onsuccess = () => res(r.result); });
  await new Promise((res) => { const tx = db.transaction('leaves', 'readwrite'); tx.objectStore('leaves').clear(); tx.oncomplete = res; });
});
assert.equal((await readLeaves()).length, 0);
await go('#/backup');
await page.setInputFiles('#rs-file', file);
await page.waitForSelector('#rs-plan:not([hidden])');
await page.screenshot({ path: path.join(out, 'desk-restore.png'), fullPage: true });
assert.match(await page.textContent('#rs-plan'), new RegExp(`${before.length} leaves found`));
await page.click('#rs-go');
await page.waitForFunction(() => location.hash.startsWith('#/journal'));
const after = await readLeaves();
assert.deepEqual(after.map((l) => [l.id, l.spot || '', l.title || '']), before.map((l) => [l.id, l.spot || '', l.title || '']));
assert.ok(after.every((l) => l.size > 1000), 'photos came back');
ok('restore brings every leaf back with its photo, spot and title');
await go('#/backup');
await page.setInputFiles('#rs-file', file);
await page.waitForSelector('#rs-plan:not([hidden])');
assert.match(await page.textContent('#rs-plan'), /0 are new, \d+ are weeks you already have/);
await page.check('#rs-replace');
await page.click('#rs-go');
await page.waitForFunction(() => location.hash.startsWith('#/journal'));
assert.equal((await readLeaves()).length, before.length);
ok('restoring over existing weeks keeps them, or replaces when asked');
fs.writeFileSync(path.join(out, 'bad.json'), JSON.stringify({ hello: 'world' }));
await go('#/backup');
await page.setInputFiles('#rs-file', path.join(out, 'bad.json'));
await page.waitForSelector('#rs-error:not([hidden])');
assert.match(await page.textContent('#rs-error'), /doesn't look like a 52nd Leaf backup/);
fs.writeFileSync(path.join(out, 'junk.json'), '{not json');
await page.setInputFiles('#rs-file', path.join(out, 'junk.json'));
await page.waitForFunction(() => /couldn't be read/.test(document.querySelector('#rs-error').textContent));
ok('wrong or broken files are refused with a clear message');

/* ---- 7. new photos never carry location data */
const stored = await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('52nd-leaf'); r.onsuccess = () => res(r.result); });
  const l = await new Promise((res) => { const g = db.transaction('leaves').objectStore('leaves').get('2026-41'); g.onsuccess = () => res(g.result); });
  const b = new Uint8Array(await l.photo.slice(0, 4000).arrayBuffer());
  return Array.from(b.slice(0, 4000));
});
assert.ok(!Buffer.from(stored).includes(Buffer.from('Exif\0\0', 'latin1')), 'saved photo has no EXIF');
ok('a photo added with GPS data is saved without it');

/* ---- 8. offline */
await go('#/journal');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await context.setOffline(true);
await page.goto(base + '#/journal');
await page.waitForSelector('.weeks');
assert.ok((await page.locator('.week .tile').count()) >= 5, 'journal loads offline with its photos');
await page.goto(base + '#/leaf/2026/47');
await page.waitForSelector('.leaf-photo img');
await page.goto(base + '#/compare');
await page.waitForSelector('#cmp-stage .slider, #cmp-stage .side-by-side');
ok('offline: the app and your photos open with no connection');
await context.setOffline(false);

/* ---- 8b. preferences: appearance, seasons, reminder, share image */
await go('#/backup');
await page.selectOption('#st-theme', 'dark');
assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
assert.notEqual(await page.$eval('body', (b) => getComputedStyle(b).backgroundColor), 'rgb(244, 241, 234)');
await page.selectOption('#st-theme', 'light');
assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
assert.equal(await page.$eval('body', (b) => getComputedStyle(b).backgroundColor), 'rgb(244, 241, 234)');
await page.selectOption('#st-theme', 'system');
assert.equal(await page.getAttribute('html', 'data-theme'), null);
await page.selectOption('#st-theme', 'dark');
await page.goto(base + '#/leaf/2026/46'); await page.waitForSelector('.leaf-photo img');
await page.screenshot({ path: path.join(out, 'desk-dark-leaf.png') });
await page.goto(base + '#/backup'); await page.waitForSelector('#st-theme');
await page.selectOption('#st-theme', 'system');
ok('appearance: dark and light override the device, "match my device" hands control back');

await go('#/leaf/2026/47');
assert.equal(await page.locator('.meta dd').nth(2).textContent(), 'Autumn');
await go('#/backup');
await page.selectOption('#st-hemi', 'south');
await go('#/leaf/2026/47');
assert.equal(await page.locator('.meta dd').nth(2).textContent(), 'Spring');
await go('#/backup');
await page.selectOption('#st-hemi', 'north');
await go('#/leaf/2026/47');
assert.equal(await page.locator('.meta dd').nth(2).textContent(), 'Autumn');
ok('Southern Hemisphere flips the season shown on a leaf, and back again');

await go('#/backup');
await page.selectOption('#rm-day', 'SA');
await page.fill('#rm-time', '18:15');
const [icsDl] = await Promise.all([page.waitForEvent('download'), page.click('#rm-go')]);
assert.equal(icsDl.suggestedFilename(), '52nd-leaf-reminder.ics');
const icsFile = path.join(out, 'reminder.ics');
await icsDl.saveAs(icsFile);
const ics = fs.readFileSync(icsFile, 'utf8');
assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SA/);
assert.match(ics, /DTSTART:\d{8}T181500/);
assert.match(ics, /BEGIN:VALARM/);
ok('weekly reminder downloads as a calendar event for the chosen day and time');
await go('#/backup');
assert.equal(await page.inputValue('#rm-day'), 'SA', 'remembers the day');

await go('#/leaf/2026/46');
const [imgDl] = await Promise.all([page.waitForEvent('download'), page.click('#share-leaf')]);
assert.equal(imgDl.suggestedFilename(), '52nd-leaf-week-46-2026.jpg');
await imgDl.saveAs(path.join(out, 'share-leaf.jpg'));
const jpg = fs.readFileSync(path.join(out, 'share-leaf.jpg'));
assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8, 'a real JPEG');
ok('a leaf can be saved as a shareable image');

/* ---- 9. phone width */
const phone = await context.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
for (const h of ['#/', '#/journal', '#/add/2026/46', '#/leaf/2026/43', '#/compare', '#/spots', '#/spot/Pond', '#/backup', '#/review']) {
  await phone.goto(base + h); await phone.waitForTimeout(350);
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(wide, false, `${h} scrolls sideways on a phone`);
  await phone.screenshot({ path: path.join(out, `phone-${h.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
}
ok('no sideways scrolling on any screen at phone width');

await page.screenshot({ path: path.join(out, 'final.png') });
assert.deepEqual(errors, [], 'no console errors');
ok('no console errors');
console.log(`\nAll passed. Screenshots in ${out}`);
await browser.close();
server.close();
