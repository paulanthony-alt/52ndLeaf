/* Week math for 52nd Leaf. No DOM, so it runs in the browser and in tests.
 * Weeks start on Monday and follow ISO week numbering. A journal year always has 52 weeks:
 * in the occasional ISO year with a 53rd week, those extra days are folded into week 52.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeafWeeks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WEEKS = 52;
  const DAY = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
  }
  function week1Start(year) {
    // Monday of the week that contains Jan 4 (ISO week 1), as a UTC day number.
    const jan4 = new Date(year, 0, 4);
    return dayNumber(jan4) - ((jan4.getDay() + 6) % 7);
  }
  function weekOf(date) {
    const d = dayNumber(date);
    let year = date.getFullYear();
    if (d < week1Start(year)) year -= 1;
    else if (d >= week1Start(year + 1)) year += 1;
    const week = Math.min(WEEKS, Math.floor((d - week1Start(year)) / 7) + 1);
    return { year, week };
  }
  function weekRange(year, week) {
    const start = week1Start(year) + (week - 1) * 7;
    const end = week === WEEKS ? week1Start(year + 1) - 1 : start + 6;
    return { start: new Date(start * DAY), end: new Date(end * DAY) };
  }
  function formatRange(year, week) {
    const { start, end } = weekRange(year, week);
    const sm = MONTHS[start.getUTCMonth()], em = MONTHS[end.getUTCMonth()];
    if (sm === em) return `${sm} ${start.getUTCDate()}–${end.getUTCDate()}`;
    return `${sm} ${start.getUTCDate()} – ${em} ${end.getUTCDate()}`;
  }
  // A local calendar date, like "Nov 3".
  function formatDay(date) {
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  }

  // Meteorological seasons by the middle of the week. Northern Hemisphere unless told otherwise.
  const FLIP = { Winter: 'Summer', Summer: 'Winter', Spring: 'Autumn', Autumn: 'Spring' };
  function mid(year, week) {
    return new Date(weekRange(year, week).start.getTime() + 3 * DAY);
  }
  function season(year, week, hemisphere) {
    const m = mid(year, week).getUTCMonth();
    const north = m === 11 || m <= 1 ? 'Winter' : m <= 4 ? 'Spring' : m <= 7 ? 'Summer' : 'Autumn';
    return hemisphere === 'south' ? FLIP[north] : north;
  }
  // 0 for the first week of a calendar season (Dec, Mar, Jun, Sep), counting up to 13.
  function seasonWeekIndex(year, week) {
    const d = mid(year, week);
    const m = d.getUTCMonth();
    let y = d.getUTCFullYear();
    let startMonth = [11, 8, 5, 2].find((s) => m >= s);
    if (startMonth === undefined) { startMonth = 11; y -= 1; }
    return Math.floor((d.getTime() - Date.UTC(y, startMonth, 1)) / (7 * DAY));
  }

  return { WEEKS, weekOf, weekRange, formatRange, formatDay, season, seasonWeekIndex };
});
