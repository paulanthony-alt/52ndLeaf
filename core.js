/* Pure logic for backups and spots. No DOM, so it runs in the browser and in tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeafCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WEEKS = 52;
  const APP = '52nd-leaf';
  const DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

  const oneLine = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

  /* ---- spots: a name for a place you come back to */
  // Reuses an existing spot's spelling when the new name matches it ignoring case and spacing.
  function normalizeSpot(input, existingNames) {
    const name = oneLine(input, 60);
    if (!name) return '';
    const key = name.toLowerCase();
    return (existingNames || []).find((n) => n.toLowerCase() === key) || name;
  }
  // [{ name, leaves: [oldest … newest] }] sorted by most recent photo first.
  function spotsFrom(leaves) {
    const map = new Map();
    for (const l of leaves) {
      if (!l.spot) continue;
      const key = l.spot.toLowerCase();
      if (!map.has(key)) map.set(key, { name: l.spot, leaves: [] });
      map.get(key).leaves.push(l);
    }
    const list = [...map.values()];
    // Photos run oldest to newest, and the newest photo's spelling names the spot.
    list.forEach((s) => { s.leaves.sort((a, b) => a.id.localeCompare(b.id)); s.name = s.leaves[s.leaves.length - 1].spot; });
    list.sort((a, b) => b.leaves[b.leaves.length - 1].id.localeCompare(a.leaves[a.leaves.length - 1].id) || a.name.localeCompare(b.name));
    return list;
  }

  /* ---- backups */
  // Checks a parsed backup file. Returns { leaves, skipped } or { error }.
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== APP || !Array.isArray(obj.leaves)) {
      return { error: "That doesn't look like a 52nd Leaf backup." };
    }
    if (typeof obj.version !== 'number' || obj.version > 1) {
      return { error: 'This backup was made by a newer version of 52nd Leaf. Update the app and try again.' };
    }
    const leaves = [], seen = new Set();
    let skipped = 0;
    for (const raw of obj.leaves) {
      const year = raw && Number.isInteger(raw.year) ? raw.year : NaN;
      const week = raw && Number.isInteger(raw.week) ? raw.week : NaN;
      if (!(year >= 1900 && year <= 2200) || !(week >= 1 && week <= WEEKS) || typeof raw.photo !== 'string' || !DATA_URL.test(raw.photo)) {
        skipped++;
        continue;
      }
      const id = `${year}-${String(week).padStart(2, '0')}`;
      if (seen.has(id)) { skipped++; continue; }
      seen.add(id);
      leaves.push({
        id, year, week, photo: raw.photo,
        title: oneLine(raw.title, 80),
        note: String(raw.note == null ? '' : raw.note).slice(0, 5000),
        place: oneLine(raw.place, 60),
        weather: oneLine(raw.weather, 60),
        spot: oneLine(raw.spot, 60),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      });
    }
    leaves.sort((a, b) => a.id.localeCompare(b.id));
    return { leaves, skipped };
  }
  // Decides what a restore will do. By default weeks you already have are kept.
  function planRestore(existingIds, incoming, replace) {
    const have = new Set(existingIds);
    const add = [], clash = [];
    for (const l of incoming) (have.has(l.id) ? clash : add).push(l);
    return { add, clash, write: replace ? add.concat(clash) : add, kept: replace ? 0 : clash.length };
  }

  return { normalizeSpot, spotsFrom, validateBackup, planRestore };
});
