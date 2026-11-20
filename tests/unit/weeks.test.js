const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../weeks.js');

const d = (y, m, day) => new Date(y, m - 1, day, 12);

test('weekOf: this journal year starts on the Monday of ISO week 1', () => {
  assert.deepEqual(W.weekOf(d(2026, 1, 1)), { year: 2026, week: 1 });       // Thursday, ISO week 1
  assert.deepEqual(W.weekOf(d(2025, 12, 29)), { year: 2026, week: 1 });     // Monday before it
  assert.deepEqual(W.weekOf(d(2025, 12, 28)), { year: 2025, week: 52 });
  assert.deepEqual(W.weekOf(d(2026, 11, 18)), { year: 2026, week: 47 });
  assert.deepEqual(W.weekOf(d(2026, 11, 16)), { year: 2026, week: 47 });    // Monday
  assert.deepEqual(W.weekOf(d(2026, 11, 22)), { year: 2026, week: 47 });    // Sunday
  assert.deepEqual(W.weekOf(d(2026, 11, 23)), { year: 2026, week: 48 });
});

test('weekOf: ISO week 53 is folded into week 52, in every 53-week year', () => {
  // 2015, 2020, 2026 and 2032 have 53 ISO weeks.
  for (const y of [2015, 2020, 2026, 2032]) {
    const last = W.weekRange(y, 52).end;
    assert.ok(last.getUTCDate() >= 1, 'has a last day');
    // The day after week 52 ends belongs to the next year's week 1.
    const next = new Date(last.getTime() + 86400000);
    assert.deepEqual(W.weekOf(new Date(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 12)), { year: y + 1, week: 1 });
    // Week 52 is longer than seven days in those years.
    const days = (W.weekRange(y, 52).end - W.weekRange(y, 52).start) / 86400000 + 1;
    assert.equal(days, 14, `${y} week 52 absorbs the extra week`);
  }
  assert.deepEqual(W.weekOf(d(2026, 12, 31)), { year: 2026, week: 52 });
  assert.deepEqual(W.weekOf(d(2027, 1, 3)), { year: 2026, week: 52 });
  assert.deepEqual(W.weekOf(d(2027, 1, 4)), { year: 2027, week: 1 });
});

test('every day of many years lands in a week whose range contains it, with no gaps or overlaps', () => {
  for (let y = 2018; y <= 2036; y++) {
    for (let w = 1; w <= 52; w++) {
      const { start, end } = W.weekRange(y, w);
      const next = w < 52 ? W.weekRange(y, w + 1).start : W.weekRange(y + 1, 1).start;
      assert.equal(end.getTime() + 86400000, next.getTime(), `${y} week ${w} runs straight into the next`);
      assert.equal(start.getUTCDay(), 1, `${y} week ${w} starts on a Monday`);
    }
  }
  for (let t = Date.UTC(2019, 0, 1); t < Date.UTC(2035, 0, 1); t += 86400000) {
    const u = new Date(t);
    const { year, week } = W.weekOf(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12));
    const r = W.weekRange(year, week);
    assert.ok(t >= r.start.getTime() && t <= r.end.getTime(), `${u.toISOString()} is inside week ${week} of ${year}`);
    assert.ok(week >= 1 && week <= 52);
  }
});

test('formatRange', () => {
  assert.equal(W.formatRange(2026, 47), 'Nov 16–22');
  assert.equal(W.formatRange(2026, 46), 'Nov 9–15');
  assert.equal(W.formatRange(2026, 52), 'Dec 21 – Jan 3');
  assert.equal(W.formatRange(2026, 1), 'Dec 29 – Jan 4');
});

test('formatDay uses local calendar dates', () => {
  assert.equal(W.formatDay(new Date(2026, 10, 3, 23, 59)), 'Nov 3');
});

test('season: northern by default, flipped for the south', () => {
  assert.equal(W.season(2026, 47), 'Autumn');
  assert.equal(W.season(2026, 9), 'Winter');    // Feb 23 – Mar 1, middle in February
  assert.equal(W.season(2026, 10), 'Spring');   // Mar 2–8
  assert.equal(W.season(2026, 1), 'Winter');
  assert.equal(W.season(2026, 26), 'Summer');
  assert.equal(W.season(2026, 47, 'south'), 'Spring');
  assert.equal(W.season(2026, 26, 'south'), 'Winter');
  assert.equal(W.season(2026, 1, 'south'), 'Summer');
});

test('seasonWeekIndex counts weeks from the start of each calendar season and stays in 0..13', () => {
  let max = 0;
  for (let y = 2020; y <= 2034; y++) {
    for (let w = 1; w <= 52; w++) {
      const i = W.seasonWeekIndex(y, w);
      assert.ok(Number.isInteger(i) && i >= 0 && i <= 13, `${y} week ${w} -> ${i}`);
      max = Math.max(max, i);
    }
  }
  assert.equal(max, 13);
  // Winter runs across New Year: late December is early, February is late.
  assert.ok(W.seasonWeekIndex(2026, 51) < 4);
  assert.ok(W.seasonWeekIndex(2026, 1) >= 4 && W.seasonWeekIndex(2026, 1) <= 5);
  assert.ok(W.seasonWeekIndex(2026, 8) >= 9);
  // Consecutive weeks inside a season go up by one.
  assert.equal(W.seasonWeekIndex(2026, 40) + 1, W.seasonWeekIndex(2026, 41));
});
