/* 52nd Leaf — one photo of nature, every week.
 * Plain JavaScript, no build step. Photos and notes are stored on this device in IndexedDB.
 */
(function () {
  'use strict';

  const WEEKS = 52;
  const DAY = 86400000;
  const MAX_PHOTO_EDGE = 1800;

  /* ---------------------------------------------------------------- icons */
  const leafPath = '<path d="M5 19c0-8.3 5.7-14 14-14 0 8.3-5.7 14-14 14z"></path><path d="M5 19l8-8"></path>';
  const icon = {
    leaf: (size, sw, color) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${leafPath}</svg>`,
    plus: (size) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>`,
    left: (size) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>`,
    right: (size) =>
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"></path></svg>`,
    camera:
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2"></rect><circle cx="12" cy="12.5" r="3.5"></circle><path d="M8 5l1.5-2h5L16 5"></path></svg>',
    info:
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3F5A3C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>',
  };

  /* ---------------------------------------------------------------- helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const leafId = (year, week) => `${year}-${pad(week)}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------------------------------------------------------------- weeks
   * Weeks start on Monday and follow ISO week numbering. A journal year always
   * has 52 weeks: in the occasional ISO year with a 53rd week, those extra days
   * are folded into week 52 so every year ends with exactly 52 leaves.
   */
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
  function season(year, week) {
    // Northern-hemisphere meteorological seasons, by the middle of the week.
    const { start } = weekRange(year, week);
    const m = new Date(start.getTime() + 3 * DAY).getUTCMonth();
    if (m === 11 || m <= 1) return 'Winter';
    if (m <= 4) return 'Spring';
    if (m <= 7) return 'Summer';
    return 'Autumn';
  }
  const now = () => weekOf(new Date());
  // -1 past, 0 this week, 1 future
  function when(year, week) {
    const n = now();
    if (year !== n.year) return year < n.year ? -1 : 1;
    return week < n.week ? -1 : week === n.week ? 0 : 1;
  }

  /* ---------------------------------------------------------------- storage */
  const store = (function () {
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('This browser cannot store photos.'));
        const req = indexedDB.open('52nd-leaf', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('leaves')) {
            const os = db.createObjectStore('leaves', { keyPath: 'id' });
            os.createIndex('year', 'year');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    function run(mode, fn) {
      return open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction('leaves', mode);
            const result = fn(tx.objectStore('leaves'));
            tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Could not save. Your device may be out of space.'));
          })
      );
    }
    return {
      all: () => run('readonly', (os) => os.getAll()).then((list) => list.sort((a, b) => a.id.localeCompare(b.id))),
      get: (year, week) => run('readonly', (os) => os.get(leafId(year, week))),
      put: (leaf) => run('readwrite', (os) => os.put(leaf)),
      remove: (year, week) => run('readwrite', (os) => os.delete(leafId(year, week))),
    };
  })();

  /* ---------------------------------------------------------------- object URLs */
  let liveUrls = [];
  function urlFor(blob) {
    const u = URL.createObjectURL(blob);
    liveUrls.push(u);
    return u;
  }
  function releaseUrls() {
    liveUrls.forEach((u) => URL.revokeObjectURL(u));
    liveUrls = [];
  }

  /* ---------------------------------------------------------------- photo processing */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("That file couldn't be opened as a photo. Try a JPEG or PNG."));
      };
      img.src = url;
    });
  }
  // Resize big camera photos so a year of them fits comfortably in browser storage.
  async function preparePhoto(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Please choose an image file.');
    const { img, url } = await loadImage(file);
    try {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(w, h));
      if (scale === 1 && file.size < 1.5e6 && /jpeg|webp/.test(file.type)) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      return blob || file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------------------------------------------------------------- chrome */
  const brand = `<a href="#/" class="brand">${icon.leaf(28, 1.6, '#3F5A3C')}<span>52nd Leaf</span></a>`;
  function header(kind, active) {
    const h = $('#header');
    if (kind === 'back') {
      h.innerHTML = `${brand}<a href="${esc(active)}" class="back-link">${icon.left(18)}Back to journal</a>`;
      return;
    }
    const cur = (name) => (active === name ? ' aria-current="page"' : '');
    h.innerHTML = `${brand}
      <nav class="nav" aria-label="Main">
        <a href="#/journal"${cur('journal')}>Journal</a>
        <a href="#/how" class="nav-how">How it works</a>
        ${kind === 'noadd' ? '' : '<a href="#/add" class="btn-primary btn-sm">Add photo</a>'}
      </nav>`;
  }
  function footer(left) {
    $('#footer').innerHTML = left
      ? `<span>${esc(left)}</span><span>© ${new Date().getFullYear()}</span>`
      : '';
  }
  function setTitle(t) {
    document.title = t ? `52nd Leaf — ${t}` : '52nd Leaf';
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------------------------------------------------------- views */
  async function viewHome(scrollToHow) {
    const leaves = await store.all();
    const n = now();
    if (!leaves.length) {
      viewStart();
      if (scrollToHow) $('#how').scrollIntoView();
      return;
    }

    header('main', 'home');
    setTitle('Home');
    const yearLeaves = leaves.filter((l) => l.year === n.year);
    const thisWeek = yearLeaves.find((l) => l.week === n.week);
    const latest = leaves[leaves.length - 1];
    const heroLeaf = thisWeek || latest;
    const saved = yearLeaves.length;
    const left = WEEKS - n.week;
    const recent = leaves.slice(-4).reverse();

    $('#app').innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Week ${n.week} of ${WEEKS}</p>
          <h1 class="display">One photo of nature, every week.</h1>
          <p class="lede">Save one picture a week. Over a year, your photos show how the world around you changes, and give you a reason to notice the little things you'd usually walk past.</p>
          <div class="actions">
            ${thisWeek
              ? `<a href="#/leaf/${n.year}/${n.week}" class="btn-primary">View this week's leaf</a>`
              : `<a href="#/add" class="btn-primary">Add this week's photo</a>`}
            <a href="#/journal" class="btn-ghost">See the journal</a>
          </div>
        </div>
        <div class="hero-media">
          <a class="photo-frame" href="#/leaf/${heroLeaf.year}/${heroLeaf.week}" aria-label="Week ${heroLeaf.week} photo">
            <img src="${urlFor(heroLeaf.photo)}" alt="${esc(heroLeaf.title || `Week ${heroLeaf.week} photo`)}">
            <span class="chip">${thisWeek ? "This week's photo" : `Latest · Week ${heroLeaf.week}${heroLeaf.year !== n.year ? `, ${heroLeaf.year}` : ''}`}</span>
          </a>
        </div>
      </section>

      <section class="progress" aria-label="Progress">
        <div class="progress-count">
          <strong>${saved} ${saved === 1 ? 'leaf' : 'leaves'} saved</strong>
          <span>${left === 0 ? 'Last week of the year' : `${left} ${left === 1 ? 'week' : 'weeks'} left this year`}</span>
        </div>
        <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="${WEEKS}" aria-valuenow="${saved}" aria-label="Leaves saved this year">
          <div style="width:${(saved / WEEKS) * 100}%"></div>
        </div>
      </section>

      ${howSection()}

      <section class="recent">
        <div class="section-head">
          <h2 class="h2">Recent leaves</h2>
          <a href="#/journal">View all ${WEEKS} weeks</a>
        </div>
        <div class="recent-grid">
          ${recent
            .map(
              (l) => `<a href="#/leaf/${l.year}/${l.week}">
                <div class="tile"><img src="${urlFor(l.photo)}" alt="" loading="lazy"></div>
                <span>Week ${l.week}${l.year !== n.year ? `, ${l.year}` : ''}</span>
              </a>`
            )
            .join('')}
        </div>
      </section>`;
    footer('52nd Leaf — a nature journal, one week at a time.');
    if (scrollToHow) $('#how').scrollIntoView();
  }

  function howSection() {
    return `
      <section class="how" id="how">
        <h2 class="h2">How it works</h2>
        <div class="steps">
          <div class="step"><span class="num">01</span><h3>Step outside</h3><p>A walk, a backyard, a window. Anywhere you can see something growing.</p></div>
          <div class="step"><span class="num">02</span><h3>Take one photo</h3><p>Just one a week. Add a short note about what caught your eye.</p></div>
          <div class="step"><span class="num">03</span><h3>Look back</h3><p>By the end of the year you'll have ${WEEKS} photos to look back on.</p></div>
        </div>
      </section>`;
  }

  function viewStart() {
    header('noadd', 'journal');
    setTitle('Your first leaf');
    $('#app').innerHTML = `
      <section class="start">
        <div class="badge">${icon.leaf(44, 1.3)}</div>
        <h1 class="display">Your first leaf starts here.</h1>
        <p class="lede">Add one nature photo this week. Your journal fills in one square at a time until you have ${WEEKS}.</p>
        <a href="#/add" class="btn-primary">Add your first photo</a>
        <div class="tip">${icon.info}<p>Tip: pick a spot you pass often, like the same tree or the same view, so you can watch it change through the year.</p></div>
      </section>
      <section class="empty-grid" aria-label="${WEEKS} empty weeks">${'<div></div>'.repeat(WEEKS)}</section>
      ${howSection()}`;
    footer('52nd Leaf — a nature journal, one week at a time.');
  }

  async function viewJournal(yearParam) {
    const leaves = await store.all();
    const n = now();
    const year = yearParam || n.year;
    const years = new Set(leaves.map((l) => l.year));
    years.add(n.year);
    const sorted = [...years].sort((a, b) => a - b);
    const prevYear = sorted.filter((y) => y < year).pop();
    const nextYear = sorted.find((y) => y > year);
    const byWeek = new Map(leaves.filter((l) => l.year === year).map((l) => [l.week, l]));

    header('main', 'journal');
    setTitle(`${year} Journal`);
    const cells = [];
    for (let w = 1; w <= WEEKS; w++) {
      const leaf = byWeek.get(w);
      const t = when(year, w);
      const range = formatRange(year, w);
      let cls = 'week', inner;
      if (leaf) {
        inner = `<a href="#/leaf/${year}/${w}" class="tile" aria-label="Week ${w}, ${range}: ${esc(leaf.title || 'photo')}"><img src="${urlFor(leaf.photo)}" alt="" loading="lazy"></a>`;
      } else if (t === 0) {
        inner = `<a href="#/add/${year}/${w}" class="slot slot-now" aria-label="Add photo for this week, ${range}">${icon.plus(22)}</a>`;
      } else if (t < 0) {
        inner = `<a href="#/add/${year}/${w}" class="slot slot-missed" aria-label="Add a photo for missed week ${w}, ${range}">${icon.plus(18)}</a>`;
      } else {
        inner = `<div class="slot slot-future" title="${range}">${icon.leaf(20, 1.4)}</div>`;
      }
      if (t === 0) cls += ' is-now';
      if (t > 0) cls += ' is-future';
      cells.push(`<div class="${cls}">${inner}<span class="label">${t === 0 ? 'This week' : 'Wk ' + w}</span></div>`);
    }

    $('#app').innerHTML = `
      <section class="journal-head">
        <div class="journal-title">
          <p class="eyebrow">Your year in nature</p>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <h1 class="display">${year} Journal</h1>
            ${sorted.length > 1 ? `<nav class="year-nav" aria-label="Years">
              <a href="#/journal/${prevYear || ''}" aria-label="Previous year"${prevYear ? '' : ' aria-disabled="true" tabindex="-1"'}>${icon.left(18)}</a>
              <a href="#/journal/${nextYear || ''}" aria-label="Next year"${nextYear ? '' : ' aria-disabled="true" tabindex="-1"'}>${icon.right(18)}</a>
            </nav>` : ''}
          </div>
        </div>
        <div class="legend">
          <span><i class="l-saved"></i>Saved</span>
          ${year === n.year ? '<span><i class="l-now"></i>This week</span>' : ''}
          <span><i class="l-missed"></i>Missed</span>
          ${year >= n.year ? '<span><i class="l-future"></i>Still to come</span>' : ''}
        </div>
      </section>
      <section class="weeks" aria-label="${WEEKS} weeks">${cells.join('')}</section>`;
    footer(`${byWeek.size} of ${WEEKS} weeks saved`);
  }

  async function viewEntry(yearParam, weekParam) {
    const n = now();
    const year = yearParam || n.year;
    const week = weekParam || n.week;
    if (week < 1 || week > WEEKS) return viewNotFound();
    if (when(year, week) > 0) {
      header('back', '#/journal/' + year);
      setTitle('Not yet');
      footer('');
      $('#app').innerHTML = `<section class="notice">
        <p class="eyebrow">Week ${week} · ${formatRange(year, week)}</p>
        <h1 class="display">That week hasn't happened yet.</h1>
        <p class="lede">Come back when it arrives. For now, there's this week to notice.</p>
        <a href="#/add" class="btn-primary">Add this week's photo</a></section>`;
      return;
    }

    const existing = await store.get(year, week);
    const isNow = year === n.year && week === n.week;
    header('back', '#/journal/' + year);
    setTitle(existing ? `Edit week ${week}` : isNow ? "Add this week's photo" : `Add week ${week}`);
    footer('');

    let photo = existing ? existing.photo : null;
    const heading = existing ? 'Edit this leaf.' : isNow ? 'What did you notice this week?' : 'What did you notice that week?';

    $('#app').innerHTML = `
      <section class="split">
        <div class="media">
          <label for="photo" class="drop" id="drop">
            <span class="drop-empty">${icon.camera}<span class="big">Add your photo</span><span class="small">Drag it here or tap to choose</span></span>
          </label>
          <input id="photo" class="visually-hidden" type="file" accept="image/*">
        </div>
        <form class="side" id="entry-form" novalidate>
          <div style="display:flex;flex-direction:column;gap:10px">
            <p class="eyebrow">Week ${week} · ${formatRange(year, week)}${year !== n.year ? `, ${year}` : ''}</p>
            <h1 class="display">${heading}</h1>
          </div>
          <div class="field">
            <label for="title">Title <span class="opt">(optional)</span></label>
            <input id="title" type="text" maxlength="80" placeholder="Last leaves on the maple" value="${esc(existing && existing.title)}">
          </div>
          <div class="field">
            <label for="note">Note</label>
            <textarea id="note" rows="4" placeholder="The maple by the trail finally dropped its last leaves…">${esc(existing && existing.note)}</textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="place">Where</label>
              <input id="place" type="text" maxlength="60" placeholder="Trail, park, backyard" value="${esc(existing && existing.place)}">
            </div>
            <div class="field">
              <label for="weather">Weather</label>
              <input id="weather" type="text" maxlength="60" placeholder="Cool, overcast" value="${esc(existing && existing.weather)}">
            </div>
          </div>
          <p class="error" id="error" role="alert" hidden></p>
          <div class="actions" style="padding-top:4px">
            <button type="submit" class="btn-primary" id="save">${existing ? 'Save changes' : isNow ? "Save this week's leaf" : `Save week ${week}`}</button>
            <span class="form-note">One photo per week</span>
          </div>
        </form>
      </section>`;

    const drop = $('#drop'), input = $('#photo'), err = $('#error'), form = $('#entry-form');
    const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
    const emptyMarkup = drop.innerHTML;
    let previewUrl = null;

    function renderPhoto() {
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      if (!photo) {
        drop.classList.remove('has-photo');
        drop.innerHTML = emptyMarkup;
        return;
      }
      previewUrl = URL.createObjectURL(photo);
      liveUrls.push(previewUrl);
      drop.classList.add('has-photo');
      drop.innerHTML = `<img src="${previewUrl}" alt="Your photo for week ${week}"><span class="change">Change photo</span>`;
    }
    async function takeFile(file) {
      if (!file) return;
      showError('');
      drop.setAttribute('aria-busy', 'true');
      try {
        photo = await preparePhoto(file);
        renderPhoto();
      } catch (e) {
        showError(e.message);
      } finally {
        drop.removeAttribute('aria-busy');
      }
    }
    renderPhoto();

    input.addEventListener('change', () => takeFile(input.files && input.files[0]));
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); })
    );
    ['dragleave', 'dragend'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      takeFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!photo) { showError('Add a photo first. That\'s the one thing each week needs.'); drop.focus(); return; }
      const btn = $('#save');
      btn.disabled = true;
      const stamp = new Date().toISOString();
      try {
        await store.put({
          id: leafId(year, week), year, week, photo,
          title: $('#title').value.trim(),
          note: $('#note').value.trim(),
          place: $('#place').value.trim(),
          weather: $('#weather').value.trim(),
          createdAt: existing ? existing.createdAt : stamp,
          updatedAt: stamp,
        });
        toast(existing ? 'Changes saved' : `Week ${week} saved`);
        location.hash = `#/leaf/${year}/${week}`;
      } catch (ex) {
        btn.disabled = false;
        showError(ex.message || 'Something went wrong while saving.');
      }
    });
  }

  async function viewLeaf(year, week) {
    const leaves = await store.all();
    const leaf = leaves.find((l) => l.year === year && l.week === week);
    if (!leaf) return viewNotFound(`Week ${week} of ${year} doesn't have a photo yet.`, when(year, week) <= 0 ? `#/add/${year}/${week}` : null);

    const n = now();
    const idx = leaves.indexOf(leaf);
    const prev = leaves[idx - 1];
    const next = leaves[idx + 1];
    const range = formatRange(year, week);
    const title = leaf.title || `Week ${week}`;
    const isNow = year === n.year && week === n.week;

    // The last seven saved leaves of this year, up to and including this one.
    const sameYear = leaves.filter((l) => l.year === year && l.week <= week).slice(-7);

    header('back', '#/journal/' + year);
    setTitle(`Week ${week}${year !== n.year ? `, ${year}` : ''}`);
    footer('');

    let nextLink = '';
    if (next) {
      nextLink = `<a href="#/leaf/${next.year}/${next.week}" class="btn-ghost">Week ${next.week}${next.year !== year ? `, ${next.year}` : ''}${icon.right(16)}</a>`;
    } else if (!isNow && !(year === n.year && week > n.week)) {
      nextLink = `<a href="#/add" class="btn-ghost">This week${icon.right(16)}</a>`;
    }

    const photoUrl = urlFor(leaf.photo);
    $('#app').innerHTML = `
      <section class="split" style="padding-bottom:64px">
        <div class="media" style="flex-basis:460px">
          <div class="leaf-photo">
            <img src="${photoUrl}" alt="${esc(title)}">
            <a class="zoom" href="${photoUrl}" target="_blank" rel="noopener" aria-label="Open full-size photo"></a>
          </div>
        </div>
        <div class="side" style="flex-basis:360px">
          <div style="display:flex;flex-direction:column;gap:10px">
            <p class="eyebrow">Week ${week} · ${range}${year !== n.year ? `, ${year}` : ''}</p>
            <h1 class="display leaf-title">${esc(title)}</h1>
          </div>
          ${leaf.note
            ? `<p class="leaf-note">${esc(leaf.note)}</p>`
            : `<p class="leaf-note is-empty">No note for this week.</p>`}
          <dl class="meta">
            <div><dt>Where</dt><dd>${esc(leaf.place) || '—'}</dd></div>
            <div><dt>Weather</dt><dd>${esc(leaf.weather) || '—'}</dd></div>
            <div><dt>Season</dt><dd>${season(year, week)}</dd></div>
          </dl>
          <nav class="leaf-nav" aria-label="Weeks">
            ${prev ? `<a href="#/leaf/${prev.year}/${prev.week}" class="btn-ghost">${icon.left(16)}Week ${prev.week}${prev.year !== year ? `, ${prev.year}` : ''}</a>` : ''}
            ${nextLink}
          </nav>
          <div class="leaf-tools">
            <a href="#/add/${year}/${week}" class="text-btn">Edit</a>
            <button type="button" class="text-btn danger" id="delete">Delete</button>
          </div>
        </div>
      </section>
      ${sameYear.length > 1 ? `
      <section class="changed" aria-label="How it's changed">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h2 class="h2">How it's changed</h2>
          <p>${sameYear.length === 7 ? 'The last seven leaves' : `Your ${sameYear.length} leaves so far`}, side by side.</p>
        </div>
        <div class="changed-grid">
          ${sameYear
            .map((l) => {
              const cur = l === leaf;
              return `<a href="#/leaf/${l.year}/${l.week}" aria-label="Week ${l.week}${cur ? ', current' : ''}"${cur ? ' aria-current="page"' : ''}>
                <div class="tile"><img src="${cur ? photoUrl : urlFor(l.photo)}" alt="" loading="lazy"></div>Wk ${l.week}</a>`;
            })
            .join('')}
        </div>
      </section>` : ''}`;

    $('#delete').addEventListener('click', async () => {
      if (!confirm(`Delete the photo and note for week ${week}? This can't be undone.`)) return;
      await store.remove(year, week);
      toast(`Week ${week} deleted`);
      location.hash = '#/journal/' + year;
    });
  }

  function viewNotFound(msg, addHref) {
    header('main', '');
    setTitle('Not found');
    footer('');
    $('#app').innerHTML = `<section class="notice">
      <h1 class="display">Nothing here yet.</h1>
      <p class="lede">${esc(msg || "That page doesn't exist.")}</p>
      <div class="actions">
        ${addHref ? `<a href="${addHref}" class="btn-primary">Add a photo for it</a>` : ''}
        <a href="#/journal" class="${addHref ? 'btn-ghost' : 'btn-primary'}">Go to the journal</a>
      </div></section>`;
  }

  function viewError(e) {
    header('noadd', '');
    footer('');
    $('#app').innerHTML = `<section class="notice">
      <h1 class="display">Something went wrong.</h1>
      <p class="lede">${esc(e && e.message ? e.message : e)}</p>
      <p class="lede">52nd Leaf saves photos in your browser's storage. Private browsing windows sometimes block it.</p></section>`;
  }

  /* ---------------------------------------------------------------- router */
  let lastRoute = '';
  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    const num = (s) => (s && /^\d+$/.test(s) ? parseInt(s, 10) : null);
    const routeKey = parts[0] === 'how' ? '' : hash;
    releaseUrls();
    try {
      switch (parts[0] || '') {
        case '': await viewHome(false); break;
        case 'how': await viewHome(true); break;
        case 'journal': await viewJournal(num(parts[1])); break;
        case 'add': await viewEntry(num(parts[1]), num(parts[2])); break;
        case 'leaf': {
          const y = num(parts[1]), w = num(parts[2]);
          if (y && w) await viewLeaf(y, w); else viewNotFound();
          break;
        }
        default: viewNotFound();
      }
    } catch (e) {
      console.error(e);
      viewError(e);
    }
    if (parts[0] !== 'how' && routeKey !== lastRoute) {
      window.scrollTo(0, 0);
      $('#app').focus({ preventScroll: true });
    }
    lastRoute = routeKey;
  }

  window.addEventListener('hashchange', route);
  route();

  // Expose the week math for tests in the console.
  window.LeafWeeks = { weekOf, weekRange, formatRange, season };
})();
