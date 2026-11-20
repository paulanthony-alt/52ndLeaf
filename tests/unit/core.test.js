const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../core.js');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const good = (o = {}) => ({ year: 2026, week: 40, photo: PNG, title: 'A', note: 'n', place: 'p', weather: 'w', spot: 's', createdAt: 'x', updatedAt: 'y', ...o });
const file = (leaves, o = {}) => ({ app: '52nd-leaf', version: 1, leaves, ...o });

test('normalizeSpot reuses an existing spelling and tidies new names', () => {
  assert.equal(C.normalizeSpot('  maple   by the TRAIL ', ['Maple by the trail']), 'Maple by the trail');
  assert.equal(C.normalizeSpot('Back  garden', []), 'Back garden');
  assert.equal(C.normalizeSpot('   ', ['x']), '');
  assert.equal(C.normalizeSpot(null, []), '');
  assert.equal(C.normalizeSpot('x'.repeat(200), []).length, 60);
});

test('spotsFrom groups ignoring case, orders photos oldest first and spots by latest photo', () => {
  const L = (id, spot) => ({ id, spot });
  const spots = C.spotsFrom([L('2026-12', 'Pond'), L('2026-03', 'maple'), L('2026-01', 'Maple'), L('2026-20', ''), L('2026-30', 'Maple'), L('2026-05')]);
  assert.deepEqual(spots.map((s) => s.name), ['Maple', 'Pond']);   // newest photo (week 30) spells it "Maple"
  assert.deepEqual(spots[0].leaves.map((l) => l.id), ['2026-01', '2026-03', '2026-30']);
  assert.equal(spots.length, 2);
});

test('validateBackup accepts a good file and cleans the fields', () => {
  const v = C.validateBackup(file([good({ title: '  Spaced   out  ' }), good({ week: 3 })]));
  assert.equal(v.error, undefined);
  assert.deepEqual(v.leaves.map((l) => l.id), ['2026-03', '2026-40']);
  assert.equal(v.leaves[1].title, 'Spaced out');
  assert.equal(v.skipped, 0);
});

test('validateBackup rejects the wrong kind of file', () => {
  for (const bad of [null, 5, 'x', {}, { leaves: [] }, file([], { app: 'other' }), file('nope'), { app: '52nd-leaf', version: 1 }]) {
    assert.ok(C.validateBackup(bad).error, JSON.stringify(bad));
  }
  assert.match(C.validateBackup(file([], { version: 2 })).error, /newer version/);
});

test('validateBackup skips broken leaves but keeps the rest', () => {
  const v = C.validateBackup(file([
    good({ week: 1 }),
    good({ week: 0 }), good({ week: 53 }), good({ week: 1.5 }), good({ year: 1800 }),
    good({ photo: 'https://example.com/x.jpg' }), good({ photo: 'data:text/html;base64,AAAA' }), good({ photo: 42 }),
    good({ week: 1 }),            // duplicate of the first
    null, 'x',
  ]));
  assert.equal(v.leaves.length, 1);
  assert.equal(v.skipped, 10);
});

test('validateBackup never lets script-like text through as anything but text fields', () => {
  const v = C.validateBackup(file([good({ title: '<img src=x onerror=alert(1)>', note: 'x'.repeat(9000) })]));
  assert.equal(v.leaves[0].title, '<img src=x onerror=alert(1)>'); // stored as text; the app escapes it when drawing
  assert.equal(v.leaves[0].note.length, 5000);
});

test('planRestore keeps weeks you already have unless told to replace them', () => {
  const incoming = [good({ week: 1 }), good({ week: 2 }), good({ week: 3 })].map((l) => ({ ...l, id: `2026-0${l.week}` }));
  const keep = C.planRestore(['2026-02'], incoming, false);
  assert.deepEqual(keep.write.map((l) => l.id), ['2026-01', '2026-03']);
  assert.equal(keep.kept, 1);
  assert.equal(keep.clash.length, 1);
  const replace = C.planRestore(['2026-02'], incoming, true);
  assert.deepEqual(replace.write.map((l) => l.id).sort(), ['2026-01', '2026-02', '2026-03']);
  assert.equal(replace.kept, 0);
  assert.deepEqual(C.planRestore([], incoming, false).write.length, 3);
});

test('reminderIcs: a weekly event on the chosen day, starting at the next occurrence', () => {
  const now = new Date(2026, 10, 20, 12, 0); // Friday 20 Nov 2026
  const ics = C.reminderIcs({ day: 'MO', time: '09:30', now, nowUtc: new Date(Date.UTC(2026, 10, 20, 12)) });
  assert.ok(ics.includes('DTSTART:20261123T093000'), 'Monday 23 Nov');
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO'));
  assert.ok(ics.includes('DTSTAMP:20261120T120000Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'lines fit the 75-character limit');
  assert.equal(ics.split('\n').length, ics.split('\r\n').length, 'every line break is CRLF');
});

test('reminderIcs: today if the time is still ahead, otherwise a week later', () => {
  const monMorning = new Date(2026, 10, 23, 8, 0);
  assert.ok(C.reminderIcs({ day: 'MO', time: '09:00', now: monMorning }).includes('DTSTART:20261123T090000'));
  const monLater = new Date(2026, 10, 23, 10, 0);
  assert.ok(C.reminderIcs({ day: 'MO', time: '09:00', now: monLater }).includes('DTSTART:20261130T090000'));
});

test('reminderIcs: the first event falls on the chosen weekday for every day', () => {
  const names = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  for (const day of Object.keys(names)) {
    for (let k = 0; k < 7; k++) {
      const now = new Date(2026, 10, 16 + k, 12, 0);
      const ics = C.reminderIcs({ day, time: '18:15', now });
      const [, y, mo, d] = /DTSTART:(\d{4})(\d{2})(\d{2})T181500/.exec(ics);
      assert.equal(new Date(+y, +mo - 1, +d).getDay(), names[day], `${day} from ${now.toDateString()}`);
      assert.ok(new Date(+y, +mo - 1, +d, 18, 15) > now);
    }
  }
});

test('reminderIcs refuses bad days and times', () => {
  const now = new Date(2026, 10, 20, 12);
  for (const [day, time] of [['XX', '09:00'], ['MO', '9:00'], ['MO', '25:00'], ['MO', '12:60'], ['MO', ''], [undefined, '09:00'], ['MO', undefined]]) {
    assert.equal(C.reminderIcs({ day, time, now }), null, `${day} ${time}`);
  }
  assert.equal(C.reminderIcs({ day: 'MO', time: '09:00', now: 'tomorrow' }), null);
});
