const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../prompts.js');
const W = require('../../weeks.js');

test('every season has 14 distinct, non-empty hints', () => {
  assert.deepEqual(Object.keys(P).sort(), ['Autumn', 'Spring', 'Summer', 'Winter']);
  const seen = new Set();
  for (const [season, list] of Object.entries(P)) {
    assert.equal(list.length, 14, season);
    for (const text of list) {
      assert.ok(text.length > 20 && text.length < 140, `reasonable length: ${text}`);
      assert.ok(!seen.has(text), `unique: ${text}`);
      seen.add(text);
    }
  }
});

test('every week of every year finds a hint, in either hemisphere', () => {
  for (let y = 2024; y <= 2032; y++) {
    for (let w = 1; w <= 52; w++) {
      for (const h of ['north', 'south']) {
        const list = P[W.season(y, w, h)];
        assert.ok(list && list[W.seasonWeekIndex(y, w) % list.length], `${y} week ${w} ${h}`);
      }
    }
  }
});
