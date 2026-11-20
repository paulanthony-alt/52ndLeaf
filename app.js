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
  const { weekOf, weekRange, formatRange } = LeafWeeks;
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } },
  };
  // The Southern Hemisphere flips the seasons. There is no setting for it yet, so this stays 'north'.
  const getHemisphere = () => (storage.get('leaf.hemisphere') === 'south' ? 'south' : 'north');
  const seasonOf = (year, week) => LeafWeeks.season(year, week, getHemisphere());
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
  // Things a view must undo when you leave it (camera streams, animations, observers).
  let cleanups = [];
  const onLeave = (fn) => cleanups.push(fn);
  function runCleanups() {
    cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
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
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      if (!blob) throw new Error("That photo couldn't be prepared. Try a JPEG or PNG.");
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------------------------------------------------------------- chrome */
  const brand = `<a href="#/" class="brand">${icon.leaf(28, 1.6, '#3F5A3C')}<span>52nd Leaf</span></a>`;
  function header(kind, active, backLabel) {
    const h = $('#header');
    if (kind === 'back') {
      h.innerHTML = `${brand}<a href="${esc(active)}" class="back-link">${icon.left(18)}${esc(backLabel || 'Back to journal')}</a>`;
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
  let footerLeft = '';
  let installPrompt = null;
  function footer(left) {
    if (left !== undefined) footerLeft = left;
    $('#footer').innerHTML = `<span>${esc(footerLeft)}</span>
      <nav class="footer-links" aria-label="More">
        <a href="#/spots">Spots</a>
        <a href="#/compare">Compare</a>
        <a href="#/backup">Backup &amp; restore</a>
        ${installPrompt ? '<button type="button" class="text-btn" id="install">Install app</button>' : ''}
        <span>© ${new Date().getFullYear()}</span>
      </nav>`;
    const btn = $('#install');
    if (btn) btn.addEventListener('click', async () => {
      const p = installPrompt;
      installPrompt = null;
      footer();
      if (p) { p.prompt(); try { await p.userChoice; } catch (e) { /* dismissed */ } }
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; footer(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; footer(); });
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
    const lastBackup = Date.parse(storage.get('leaf.lastBackup') || '');
    const needsBackup = leaves.length >= 3 && !(Date.now() - lastBackup < 30 * DAY);

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
          ${saved ? `<a href="#/review" class="review-link">See your year in review</a>` : ''}
          ${needsBackup ? `<a href="#/backup" class="review-link">Back up your journal</a>` : ''}
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
            ${byWeek.size ? `<a href="#/review/${year}" class="btn-ghost btn-sm">Year in review</a>` : ''}
            ${leaves.length > 1 ? `<a href="#/compare" class="btn-ghost btn-sm">Compare weeks</a>` : ''}
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

  /* ---------------------------------------------------------------- add / edit
   * The photo sits in the same 4:5 frame used everywhere else. Drag, pinch, scroll or use the
   * arrow keys to frame it; a faded copy of an earlier leaf helps line up the same view. When
   * you name a spot you have used before, the guide switches to your last photo from that spot.
   * A photo whose EXIF date falls in another week offers to move to that week.
   */
  let pendingFile = null; // a photo carried over when you switch to the week it was taken in

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

    const all = await store.all();
    const id = leafId(year, week);
    const existing = all.find((l) => l.id === id);
    const others = all.filter((l) => l.id !== id);
    const spotNames = LeafCore.spotsFrom(all).map((s) => s.name);
    const isNow = year === n.year && week === n.week;
    const canCamera = !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const wk = (l) => `week ${l.week}${l.year !== year ? ` of ${l.year}` : ''}`;

    // The guide is the closest earlier leaf from the named spot, else the closest earlier leaf at all.
    function pickGuide(spotText) {
      const spot = LeafCore.normalizeSpot(spotText, spotNames);
      let pool = others, bySpot = false;
      if (spot && spotNames.includes(spot)) {
        const inSpot = others.filter((l) => l.spot === spot);
        if (inSpot.length) { pool = inSpot; bySpot = true; }
      }
      const leaf = pool.filter((l) => l.id < id).pop() || pool[0] || null;
      return { leaf, bySpot };
    }
    let { leaf: guide, bySpot } = pickGuide(existing ? existing.spot : '');

    header('back', '#/journal/' + year);
    setTitle(existing ? `Edit week ${week}` : isNow ? "Add this week's photo" : `Add week ${week}`);
    footer('');

    const heading = existing ? 'Edit this leaf.' : isNow ? 'What did you notice this week?' : 'What did you notice that week?';
    const hintsOn = !existing && storage.get('leaf.hints') !== 'off';
    $('#app').innerHTML = `
      <section class="split">
        <div class="media">
          <div class="frame is-empty" id="frame" aria-label="Photo framing. Drag or use the arrow keys to move, plus and minus to zoom.">
            <div class="frame-empty" id="frame-empty" role="button" tabindex="0">
              ${icon.camera}<span class="big">Add your photo</span><span class="small">Drag it here or tap to choose</span>
            </div>
            <img id="shot" class="shot" alt="Your photo for week ${week}" draggable="false" hidden>
            <video id="viewfinder" class="viewfinder" playsinline muted hidden></video>
            <img id="ghost" class="ghost" alt="" hidden>
            <span class="ghost-tag" id="ghost-tag" hidden></span>
          </div>
          <input id="photo" class="visually-hidden" type="file" accept="image/*" aria-label="Choose a photo">
          <div class="suggest" id="suggest" role="status" hidden></div>
          <div class="frame-tools" id="tools"></div>
          <p class="frame-hint" id="hint"></p>
        </div>
        <form class="side" id="entry-form" novalidate>
          <div style="display:flex;flex-direction:column;gap:10px">
            <p class="eyebrow">Week ${week} · ${formatRange(year, week)}${year !== n.year ? `, ${year}` : ''}</p>
            <h1 class="display">${heading}</h1>
          </div>
          <div class="prompt" id="prompt" hidden>
            <p><span class="prompt-label">Not sure what to look for?</span> <span id="prompt-text"></span></p>
            <div class="prompt-actions">
              <button type="button" class="text-btn" id="prompt-next">Another idea</button>
              <button type="button" class="text-btn" id="prompt-hide">Hide hints</button>
            </div>
          </div>
          <p class="info" id="info" role="status" hidden></p>
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
          <div class="field">
            <label for="spot">Spot <span class="opt">(optional)</span></label>
            <input id="spot" type="text" maxlength="60" list="spot-list" autocomplete="off" placeholder="Maple by the trail" value="${esc(existing && existing.spot)}" aria-describedby="spot-hint">
            <datalist id="spot-list">${spotNames.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
            <span class="field-hint" id="spot-hint">Name a place you'll come back to. The guide then shows your last photo from it.</span>
          </div>
          <p class="error" id="error" role="alert" hidden></p>
          <div class="actions" style="padding-top:4px">
            <button type="submit" class="btn-primary" id="save">${existing ? 'Save changes' : isNow ? "Save this week's leaf" : `Save week ${week}`}</button>
            <span class="form-note">One photo per week</span>
          </div>
        </form>
      </section>`;

    const frame = $('#frame'), emptyEl = $('#frame-empty'), shot = $('#shot'), video = $('#viewfinder');
    const ghost = $('#ghost'), ghostTag = $('#ghost-tag'), tools = $('#tools'), hint = $('#hint');
    const input = $('#photo'), err = $('#error'), form = $('#entry-form'), suggest = $('#suggest'), info = $('#info');
    const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
    const showInfo = (msg) => { info.textContent = msg; info.hidden = !msg; };

    let mode = 'empty';            // 'empty' | 'photo' | 'camera'
    let photo = existing ? existing.photo : null;
    let original = null;           // the full-size file, so framing crops from every pixel available
    let photoReady = false;        // shot has decoded the current photo
    let adjusted = false;          // user moved or zoomed the photo
    const align = { zoom: 1, x: 0, y: 0 }; // x, y: offset as a fraction of the frame size
    let ghostOn = true, ghostOpacity = 0.4;
    let stream = null;
    let shownGuideId = null;

    /* ---- hints: one "what to notice" idea per week, matched to the season */
    if (hintsOn) {
      const list = LeafPrompts[seasonOf(year, week)] || [];
      let shift = 0;
      const text = $('#prompt-text');
      const show = () => { text.textContent = list[(LeafWeeks.seasonWeekIndex(year, week) + shift) % list.length]; };
      if (list.length) {
        show();
        $('#prompt').hidden = false;
        $('#prompt-next').addEventListener('click', () => { shift++; show(); });
        $('#prompt-hide').addEventListener('click', () => {
          storage.set('leaf.hints', 'off');
          $('#prompt').hidden = true;
          toast('Hints hidden. You can turn them back on under Backup & restore.');
        });
      }
    }

    /* ---- guide */
    function refreshGuide() {
      const gid = guide ? guide.id : null;
      if (gid !== shownGuideId) {
        shownGuideId = gid;
        if (guide) ghost.src = urlFor(guide.photo);
      }
      if (guide) ghostTag.textContent = `Faded: ${wk(guide)}${bySpot ? ', same spot' : ''}`;
      applyGhost();
      renderTools();
      updateHint();
    }
    function guideLabel() { return guide ? wk(guide) : ''; }

    /* ---- framing math */
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    function coverScale() {
      return Math.max(frame.clientWidth / shot.naturalWidth, frame.clientHeight / shot.naturalHeight) * align.zoom;
    }
    function layout() {
      if (!photoReady) return;
      const W = frame.clientWidth, H = frame.clientHeight;
      const w = shot.naturalWidth, h = shot.naturalHeight, s = coverScale();
      const mx = Math.max(0, (w * s - W) / 2) / W, my = Math.max(0, (h * s - H) / 2) / H;
      align.x = clamp(align.x, -mx, mx);
      align.y = clamp(align.y, -my, my);
      shot.style.width = w * s + 'px';
      shot.style.height = h * s + 'px';
      shot.style.transform = `translate(-50%, -50%) translate(${align.x * W}px, ${align.y * H}px)`;
    }
    function markAdjusted() {
      if (!adjusted) { adjusted = true; renderTools(); }
    }
    function panBy(dx, dy) {
      align.x += dx / frame.clientWidth;
      align.y += dy / frame.clientHeight;
      markAdjusted();
      layout();
    }
    // Zoom by factor f around a point given in px from the frame's centre.
    function zoomAt(f, px, py) {
      const nz = clamp(align.zoom * f, 1, 4);
      f = nz / align.zoom;
      if (f === 1) return;
      const W = frame.clientWidth, H = frame.clientHeight;
      align.x = (px - (px - align.x * W) * f) / W;
      align.y = (py - (py - align.y * H) * f) / H;
      align.zoom = nz;
      markAdjusted();
      layout();
    }
    // Crop the photo to exactly what the frame shows, from the full-size original when we have it.
    async function framedBlob() {
      const W = frame.clientWidth, H = frame.clientHeight;
      const w = shot.naturalWidth, h = shot.naturalHeight, s = coverScale();
      let src = shot, k = 1, url = null;
      if (original) {
        try {
          const loaded = await loadImage(original);
          src = loaded.img; url = loaded.url;
          k = src.naturalWidth / w;
        } catch (e) { /* the original can't be decoded here (e.g. HEIC); use the resized copy */ }
      }
      const sw = (W / s) * k, sh = (H / s) * k;
      const sx = (w / 2 + (-W / 2 - align.x * W) / s) * k;
      const sy = (h / 2 + (-H / 2 - align.y * H) / s) * k;
      const outW = Math.min(1440, Math.round(sw)), outH = Math.round((outW * 5) / 4);
      const c = document.createElement('canvas');
      c.width = outW; c.height = outH;
      c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
      if (url) URL.revokeObjectURL(url);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    }

    /* ---- modes */
    function updateHint() {
      if (mode === 'photo') hint.textContent = guide
        ? `Drag to line it up with ${guideLabel()}. Pinch or scroll to zoom. It saves as framed.`
        : 'Drag to frame it. Pinch or scroll to zoom. It saves as framed.';
      else if (mode === 'camera') hint.textContent = guide ? `Line up the faded ${guideLabel()}, then take the photo.` : 'Frame the view, then take the photo.';
      else hint.textContent = guide && canCamera ? `Tip: "Use camera with guide" shows ${guideLabel()} faded over your camera so you can match the view.` : '';
    }
    function setMode(m) {
      mode = m;
      frame.classList.toggle('is-empty', m === 'empty');
      frame.classList.toggle('is-photo', m === 'photo');
      frame.classList.toggle('is-camera', m === 'camera');
      emptyEl.hidden = m !== 'empty';
      shot.hidden = m !== 'photo';
      video.hidden = m !== 'camera';
      if (m === 'photo') frame.setAttribute('tabindex', '0'); else frame.removeAttribute('tabindex');
      frame.setAttribute('role', m === 'photo' ? 'group' : 'presentation');
      applyGhost();
      renderTools();
      updateHint();
      layout();
    }
    function applyGhost() {
      const show = !!guide && ghostOn && mode !== 'empty';
      ghost.hidden = !show;
      ghostTag.hidden = !show;
      ghost.style.opacity = ghostOpacity;
    }
    function renderTools() {
      const b = [];
      if (mode === 'camera') {
        b.push('<button type="button" class="btn-primary btn-sm" data-act="shoot">Take photo</button>');
        b.push('<button type="button" class="btn-ghost btn-sm" data-act="cancel-cam">Cancel</button>');
      } else {
        b.push(`<button type="button" class="btn-ghost btn-sm" data-act="choose">${photo ? 'Change photo' : 'Choose photo'}</button>`);
        if (canCamera) b.push(`<button type="button" class="btn-ghost btn-sm" data-act="camera">${guide ? 'Use camera with guide' : 'Use camera'}</button>`);
        if (mode === 'photo' && adjusted) b.push('<button type="button" class="text-btn" data-act="reset">Reset framing</button>');
      }
      const ghostCtl = guide && mode !== 'empty'
        ? `<div class="ghost-ctl">
             <label><input type="checkbox" id="ghost-on"${ghostOn ? ' checked' : ''}> Show ${esc(guideLabel())} faded</label>
             <input type="range" id="ghost-op" min="10" max="80" step="5" value="${Math.round(ghostOpacity * 100)}" aria-label="How strong the faded photo is"${ghostOn ? '' : ' disabled'}>
           </div>`
        : '';
      tools.innerHTML = `<div class="tool-row">${b.join('')}</div>${ghostCtl}`;
    }

    async function showPhoto(blob, fresh, orig) {
      photo = blob;
      original = orig || null;
      photoReady = false;
      adjusted = false;
      Object.assign(align, { zoom: 1, x: 0, y: 0 });
      shot.src = urlFor(blob);
      try { await shot.decode(); } catch (e) { /* decode() can reject for valid images in some browsers */ }
      photoReady = shot.naturalWidth > 0;
      if (fresh) showError('');
      setMode('photo');
    }

    /* ---- file the photo in the week it was taken */
    async function suggestWeek(file) {
      suggest.hidden = true;
      if (existing) return;
      let taken = null;
      try { taken = LeafExif.readTakenDate(await file.slice(0, 262144).arrayBuffer()); } catch (e) { /* no date */ }
      if (!taken) return;
      const target = weekOf(taken);
      if ((target.year === year && target.week === week) || when(target.year, target.week) > 0) return;
      const tid = leafId(target.year, target.week);
      const filled = all.some((l) => l.id === tid);
      suggest.innerHTML = `<p>This photo was taken on <strong>${LeafWeeks.formatDay(taken)}</strong>, in week ${target.week}${target.year !== year ? ` of ${target.year}` : ''}.${filled ? ' That week already has a photo.' : ''}</p>
        <div class="tool-row"><button type="button" class="btn-primary btn-sm" id="suggest-go">${filled ? `Replace week ${target.week}` : `Save it to week ${target.week}`}</button>
        <button type="button" class="text-btn" id="suggest-stay">Keep week ${week}</button></div>`;
      suggest.hidden = false;
      $('#suggest-go').addEventListener('click', () => { pendingFile = file; location.hash = `#/add/${target.year}/${target.week}`; });
      $('#suggest-stay').addEventListener('click', () => { suggest.hidden = true; });
    }
    async function takeFile(file, skipSuggest) {
      if (!file) return;
      showError('');
      frame.setAttribute('aria-busy', 'true');
      try {
        await showPhoto(await preparePhoto(file), true, file);
        if (!skipSuggest) suggestWeek(file);
      } catch (e) {
        showError(e.message);
      } finally {
        frame.removeAttribute('aria-busy');
        input.value = '';
      }
    }

    /* ---- camera */
    function stopCamera() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
    }
    onLeave(stopCamera);
    async function startCamera() {
      showError('');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        });
      } catch (e) {
        showError(e && e.name === 'NotAllowedError'
          ? 'Camera access is blocked. Allow it in your browser settings, or choose a photo instead.'
          : "The camera couldn't be opened. Choose a photo instead.");
        return;
      }
      video.srcObject = stream;
      setMode('camera');
      try { await video.play(); } catch (e) { /* autoplay of a muted inline video is allowed; ignore */ }
    }
    async function capture() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) { showError('The camera is still starting. Try again in a moment.'); return; }
      // Same crop the viewfinder shows: the centre of the video at the frame's 4:5 shape.
      const aspect = 4 / 5;
      let sw = vw, sh = vh;
      if (vw / vh > aspect) sw = vh * aspect; else sh = vw / aspect;
      const c = document.createElement('canvas');
      c.width = Math.min(1440, Math.round(sw));
      c.height = Math.round(c.width / aspect);
      c.getContext('2d').drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      stopCamera();
      if (blob) await showPhoto(blob, true);
    }

    /* ---- events */
    tools.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      switch (act.dataset.act) {
        case 'choose': input.click(); break;
        case 'camera': startCamera(); break;
        case 'shoot': capture(); break;
        case 'cancel-cam': stopCamera(); setMode(photo ? 'photo' : 'empty'); break;
        case 'reset':
          Object.assign(align, { zoom: 1, x: 0, y: 0 });
          adjusted = false;
          layout();
          renderTools();
          frame.focus();
          break;
      }
    });
    tools.addEventListener('input', (e) => {
      if (e.target.id === 'ghost-on') {
        ghostOn = e.target.checked;
        const op = $('#ghost-op');
        if (op) op.disabled = !ghostOn;
      } else if (e.target.id === 'ghost-op') {
        ghostOpacity = e.target.value / 100;
      }
      applyGhost();
    });
    $('#spot').addEventListener('input', (e) => {
      const next = pickGuide(e.target.value);
      if ((next.leaf && next.leaf.id) !== (guide && guide.id) || next.bySpot !== bySpot) {
        ({ leaf: guide, bySpot } = next);
        refreshGuide();
      }
    });
    input.addEventListener('change', () => takeFile(input.files && input.files[0]));
    emptyEl.addEventListener('click', () => input.click());
    emptyEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      frame.addEventListener(ev, (e) => { if (mode !== 'camera') { e.preventDefault(); frame.classList.add('is-over'); } })
    );
    ['dragleave', 'dragend'].forEach((ev) => frame.addEventListener(ev, () => frame.classList.remove('is-over')));
    frame.addEventListener('drop', (e) => {
      e.preventDefault();
      frame.classList.remove('is-over');
      if (mode !== 'camera') takeFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    // Drag to pan, two fingers to pinch-zoom.
    const pointers = new Map();
    const centre = () => { const r = frame.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    frame.addEventListener('pointerdown', (e) => {
      if (mode !== 'photo' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      frame.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    frame.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const before = [...pointers.values()];
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = [...pointers.values()];
      if (after.length === 1) {
        panBy(after[0].x - before[0].x, after[0].y - before[0].y);
      } else if (after.length >= 2) {
        const [a0, b0] = before, [a1, b1] = after;
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
        panBy(m1.x - m0.x, m1.y - m0.y);
        const c = centre();
        if (d0 > 0) zoomAt(d1 / d0, m1.x - c.x, m1.y - c.y);
      }
    });
    const lift = (e) => pointers.delete(e.pointerId);
    frame.addEventListener('pointerup', lift);
    frame.addEventListener('pointercancel', lift);
    frame.addEventListener('wheel', (e) => {
      if (mode !== 'photo') return;
      e.preventDefault();
      const c = centre();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - c.x, e.clientY - c.y);
    }, { passive: false });
    frame.addEventListener('keydown', (e) => {
      if (mode !== 'photo' || e.target !== frame) return;
      const step = frame.clientWidth * 0.03;
      const keys = {
        ArrowLeft: () => panBy(step, 0), ArrowRight: () => panBy(-step, 0),
        ArrowUp: () => panBy(0, step), ArrowDown: () => panBy(0, -step),
        '+': () => zoomAt(1.1, 0, 0), '=': () => zoomAt(1.1, 0, 0), '-': () => zoomAt(1 / 1.1, 0, 0),
      };
      if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    });
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(layout);
      ro.observe(frame);
      onLeave(() => ro.disconnect());
    }

    refreshGuide();
    if (photo) await showPhoto(photo, false); else setMode('empty');
    if (pendingFile) {
      const f = pendingFile;
      pendingFile = null;
      await takeFile(f, true);
      if (existing) showInfo(`Week ${week} already has a photo. Saving will replace it.`);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (mode === 'camera') { showError('Take the photo first, or cancel the camera.'); return; }
      if (!photo) { showError("Add a photo first. That's the one thing each week needs."); emptyEl.focus(); return; }
      const btn = $('#save');
      btn.disabled = true;
      const stamp = new Date().toISOString();
      try {
        const toSave = adjusted && photoReady ? (await framedBlob()) || photo : photo;
        await store.put({
          id, year, week, photo: toSave,
          title: $('#title').value.trim(),
          note: $('#note').value.trim(),
          place: $('#place').value.trim(),
          weather: $('#weather').value.trim(),
          spot: LeafCore.normalizeSpot($('#spot').value, spotNames),
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
            <div><dt>Season</dt><dd>${seasonOf(year, week)}</dd></div>
          </dl>
          ${leaf.spot ? `<p class="spot-line">Spot: <a href="${spotHref(leaf.spot)}">${esc(leaf.spot)}</a></p>` : ''}
          <nav class="leaf-nav" aria-label="Weeks">
            ${prev ? `<a href="#/leaf/${prev.year}/${prev.week}" class="btn-ghost">${icon.left(16)}Week ${prev.week}${prev.year !== year ? `, ${prev.year}` : ''}</a>` : ''}
            ${nextLink}
          </nav>
          <div class="leaf-tools">
            <a href="#/add/${year}/${week}" class="text-btn">Edit</a>
            ${leaves.length > 1 ? `<a href="${compareHref(leaf, leaves)}" class="text-btn">Compare</a>` : ''}
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

  /* ---------------------------------------------------------------- year in review
   * A contact sheet of all 52 weeks (one row per quarter) and a timelapse of the year,
   * both drawn on a canvas and saved as files on this device.
   */
  const INK = '#2B2B28', CREAM = '#F4F1EA', GREEN = '#3F5A3C', LINE = '#DDD7C9', FAINT = '#CFC9BA', MUTED = '#6B6A63';

  async function decodePhoto(blob) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(blob); } catch (e) { /* fall back to <img> */ }
    }
    const { img, url } = await loadImage(blob);
    URL.revokeObjectURL(url);
    return img;
  }
  const srcSize = (s) => ({ w: s.naturalWidth || s.width, h: s.naturalHeight || s.height });
  // Draw src cropped to fill the box, like CSS object-fit: cover.
  function drawCover(ctx, src, x, y, w, h) {
    const { w: sw, h: sh } = srcSize(src);
    let cw = sw, ch = sh;
    if (sw / sh > w / h) cw = sh * (w / h); else ch = sw / (w / h);
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  async function fontsReady() {
    if (!document.fonts) return;
    await Promise.all(['500 72px Fraunces', '500 28px Inter', '400 28px Inter'].map((f) => document.fonts.load(f).catch(() => null)));
  }
  const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  async function saveFile(blob, name) {
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (file && touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  async function buildSheet(year, byWeek) {
    await fontsReady();
    const tile = 220, gap = 14, cols = 13, rows = 4, pad = 96, head = 190, foot = 96;
    const W = pad * 2 + cols * tile + (cols - 1) * gap;
    const H = pad + head + rows * tile + (rows - 1) * gap + foot + pad / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = INK;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 96px Fraunces, Georgia, serif';
    ctx.fillText(String(year), pad, pad + 96);
    ctx.fillStyle = MUTED;
    ctx.font = '400 30px Inter, system-ui, sans-serif';
    ctx.fillText(`${byWeek.size} of ${WEEKS} weeks · one photo of nature, every week`, pad, pad + 150);

    for (let w = 1; w <= WEEKS; w++) {
      const col = (w - 1) % cols, row = Math.floor((w - 1) / cols);
      const x = pad + col * (tile + gap), y = pad + head + row * (tile + gap);
      const leaf = byWeek.get(w);
      ctx.save();
      roundRect(ctx, x, y, tile, tile, 18);
      if (leaf) {
        ctx.clip();
        const src = await decodePhoto(leaf.photo);
        drawCover(ctx, src, x, y, tile, tile);
        if (src.close) src.close();
      } else {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = FAINT;
        ctx.font = '500 30px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(w), x + tile / 2, y + tile / 2);
      }
      ctx.restore();
    }

    ctx.fillStyle = GREEN;
    ctx.font = '600 30px Fraunces, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('52nd Leaf', pad, H - pad / 2 - 20);
    ctx.fillStyle = MUTED;
    ctx.font = '400 26px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Each row is a quarter: 13 weeks', W - pad, H - pad / 2 - 20);
    return toBlob(c, 'image/jpeg', 0.92);
  }

  /* Timelapse: title card, each leaf with a crossfade, end card. Drawn in real time so the
   * same loop can play in the page or be recorded with MediaRecorder. */
  function makeTimelapse(canvas, year, leaves) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const TITLE = 1500, HOLD = 600, FADE = 280, END = 2000;
    const frames = new Map();
    let stopped = false;

    function prep(i) {
      if (i < 0 || i >= leaves.length) return Promise.resolve(null);
      if (!frames.has(i)) {
        frames.set(i, (async () => {
          const src = await decodePhoto(leaves[i].photo);
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          drawCover(c.getContext('2d'), src, 0, 0, W, H);
          if (src.close) src.close();
          return c;
        })());
      }
      return frames.get(i);
    }
    function free(i) {
      const p = frames.get(i);
      if (!p) return;
      frames.delete(i);
      p.then((c) => { if (c) c.width = c.height = 0; });
    }

    function card(big, small, line) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = CREAM;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '500 200px Fraunces, Georgia, serif';
      ctx.fillText(big, W / 2, H / 2 + 40);
      ctx.font = '500 44px Inter, system-ui, sans-serif';
      ctx.fillText(small, W / 2, H / 2 + 140);
      ctx.globalAlpha = 0.75;
      ctx.font = '400 32px Inter, system-ui, sans-serif';
      ctx.fillText(line, W / 2, H - 120);
      ctx.globalAlpha = 1;
    }
    const titleCard = () => card(String(year), '52nd Leaf', 'One photo of nature, every week');
    const endCard = () => card(String(leaves.length), leaves.length === 1 ? 'leaf this year' : 'leaves this year', 'What will you notice next year?');

    function photoFrame(i, img) {
      const leaf = leaves[i];
      ctx.drawImage(img, 0, 0);
      const g = ctx.createLinearGradient(0, H - 380, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, H - 380, W, 380);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '500 72px Fraunces, Georgia, serif';
      ctx.fillText(`Week ${leaf.week}`, 72, H - 150);
      ctx.globalAlpha = 0.85;
      ctx.font = '400 34px Inter, system-ui, sans-serif';
      ctx.fillText(`${formatRange(leaf.year, leaf.week)} · ${seasonOf(leaf.year, leaf.week)}`, 72, H - 100);
      ctx.globalAlpha = 1;
      // 52 ticks: where in the year this photo sits.
      const x0 = 72, x1 = W - 72, step = (x1 - x0) / WEEKS;
      for (let w = 1; w <= WEEKS; w++) {
        ctx.fillStyle = w === leaf.week ? '#FFFFFF' : w < leaf.week ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
        const h = w === leaf.week ? 22 : 10;
        ctx.fillRect(x0 + (w - 1) * step + 1, H - 56 - h, Math.max(2, step - 4), h);
      }
    }

    const tick = () => new Promise((r) => requestAnimationFrame(r));
    async function animate(ms, draw) {
      const t0 = performance.now();
      for (;;) {
        if (stopped) throw new Error('stopped');
        const p = Math.min(1, (performance.now() - t0) / ms);
        draw(p);
        if (p >= 1) return;
        await tick();
      }
    }
    async function fadeBetween(drawA, drawB) {
      await animate(FADE, (p) => {
        drawA();
        ctx.globalAlpha = p;
        drawB();
        ctx.globalAlpha = 1;
      });
    }

    async function play(onProgress) {
      stopped = false;
      await fontsReady();
      let cur = await prep(0);
      prep(1);
      await animate(TITLE, titleCard);
      await fadeBetween(titleCard, () => photoFrame(0, cur));
      for (let i = 0; i < leaves.length; i++) {
        onProgress && onProgress(i + 1, leaves.length);
        await animate(HOLD, () => photoFrame(i, cur));
        if (i === leaves.length - 1) break;
        const next = await prep(i + 1);
        prep(i + 2);
        const a = cur;
        await fadeBetween(() => photoFrame(i, a), () => photoFrame(i + 1, next));
        free(i);
        cur = next;
      }
      const last = cur, li = leaves.length - 1;
      await fadeBetween(() => photoFrame(li, last), endCard);
      await animate(END, endCard);
      [...frames.keys()].forEach(free);
    }

    return {
      play,
      stop() { stopped = true; [...frames.keys()].forEach(free); },
      still: titleCard,
      seconds: Math.round((TITLE + FADE + leaves.length * (HOLD + FADE) + END) / 1000),
    };
  }

  function pickVideoType() {
    if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) return null;
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
  }

  async function viewReview(yearParam) {
    const n = now();
    const year = yearParam || n.year;
    const leaves = (await store.all()).filter((l) => l.year === year);
    header('main', 'journal');
    setTitle(`${year} in review`);

    if (!leaves.length) {
      footer('');
      $('#app').innerHTML = `<section class="notice">
        <p class="eyebrow">Year in review</p>
        <h1 class="display">No leaves in ${year} yet.</h1>
        <p class="lede">Your review fills in as you save a photo each week.</p>
        <a href="#/add" class="btn-primary">Add this week's photo</a></section>`;
      return;
    }

    const byWeek = new Map(leaves.map((l) => [l.week, l]));
    const done = year < n.year || (year === n.year && n.week === WEEKS);
    const left = year === n.year ? WEEKS - n.week : 0;
    const sub = done
      ? `${leaves.length} of ${WEEKS} weeks saved. Here's how the year looked.`
      : `${leaves.length} so far, with ${left} ${left === 1 ? 'week' : 'weeks'} to go. This page grows as the year does.`;
    const videoType = pickVideoType();
    const quarters = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];

    let sheetRows = '';
    for (let q = 0; q < 4; q++) {
      let cells = '';
      for (let w = q * 13 + 1; w <= q * 13 + 13; w++) {
        const leaf = byWeek.get(w);
        cells += leaf
          ? `<a href="#/leaf/${year}/${w}" aria-label="Week ${w}"><img src="${urlFor(leaf.photo)}" alt="" loading="lazy"></a>`
          : `<span class="cell-empty" aria-hidden="true">${w}</span>`;
      }
      sheetRows += `<div class="sheet-row"><span class="q">Wk ${q * 13 + 1}–${q * 13 + 13}<small>${quarters[q]}</small></span><div class="sheet-cells">${cells}</div></div>`;
    }

    $('#app').innerHTML = `
      <section class="review-head">
        <p class="eyebrow">Year in review</p>
        <h1 class="display">Your ${year} in ${leaves.length} ${leaves.length === 1 ? 'leaf' : 'leaves'}</h1>
        <p class="lede">${sub}</p>
      </section>

      <section class="review-block" aria-labelledby="sheet-h">
        <div class="section-head">
          <h2 class="h2" id="sheet-h">The year at a glance</h2>
          <button type="button" class="btn-ghost btn-sm" id="save-sheet">Save as image</button>
        </div>
        <div class="sheet">${sheetRows}</div>
        <p class="review-note" id="sheet-status" role="status"></p>
      </section>

      <section class="review-block" aria-labelledby="tl-h">
        <div class="section-head"><h2 class="h2" id="tl-h">Timelapse</h2></div>
        <div class="tl">
          <canvas id="tl" width="1080" height="1350" aria-label="Timelapse of your ${year} photos"></canvas>
          <video id="tl-video" controls playsinline hidden></video>
          <div class="tl-side">
            <p class="lede" style="font-size:16px">Every leaf in order, about ${makeTimelapse(document.createElement('canvas'), year, leaves).seconds} seconds long, with a marker showing where each week sits in the year.</p>
            <div class="actions" style="padding-top:0">
              <button type="button" class="btn-primary btn-sm" id="tl-play">Play</button>
              ${videoType ? '<button type="button" class="btn-ghost btn-sm" id="tl-record">Save as video</button>' : ''}
            </div>
            <p class="review-note" id="tl-status" role="status">${videoType ? '' : "This browser can play the timelapse but can't save it as a video."}</p>
            <div class="actions" style="padding-top:0" id="tl-result" hidden>
              <button type="button" class="btn-primary btn-sm" id="tl-download">Download video</button>
              <button type="button" class="text-btn" id="tl-back">Back to preview</button>
            </div>
          </div>
        </div>
      </section>`;
    footer(`${leaves.length} of ${WEEKS} weeks saved`);

    /* contact sheet */
    const sheetBtn = $('#save-sheet'), sheetStatus = $('#sheet-status');
    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true;
      sheetStatus.textContent = 'Making your image…';
      try {
        const blob = await buildSheet(year, byWeek);
        await saveFile(blob, `52nd-leaf-${year}.jpg`);
        sheetStatus.textContent = 'Saved.';
      } catch (e) {
        sheetStatus.textContent = "The image couldn't be made. Try again, or try another browser.";
      } finally {
        sheetBtn.disabled = false;
      }
    });

    /* timelapse */
    const canvas = $('#tl'), videoEl = $('#tl-video'), playBtn = $('#tl-play'), recBtn = $('#tl-record');
    const status = $('#tl-status'), result = $('#tl-result');
    const tl = makeTimelapse(canvas, year, leaves);
    let running = null; // 'play' | 'record'
    let recorded = null;
    fontsReady().then(() => { if (!running) tl.still(); });
    tl.still();

    function setRunning(kind) {
      running = kind;
      playBtn.textContent = kind === 'play' ? 'Stop' : 'Play';
      playBtn.disabled = kind === 'record';
      if (recBtn) recBtn.disabled = !!kind;
    }
    const onHide = () => { if (document.hidden && running) tl.stop(); };
    document.addEventListener('visibilitychange', onHide);
    onLeave(() => { tl.stop(); document.removeEventListener('visibilitychange', onHide); if (videoEl.src) URL.revokeObjectURL(videoEl.src); });

    playBtn.addEventListener('click', async () => {
      if (running === 'play') { tl.stop(); return; }
      setRunning('play');
      status.textContent = '';
      try {
        await tl.play();
      } catch (e) { /* stopped */ }
      setRunning(null);
      tl.still();
    });

    if (recBtn) recBtn.addEventListener('click', async () => {
      setRunning('record');
      const chunks = [];
      let rec;
      try {
        rec = new MediaRecorder(canvas.captureStream(30), { mimeType: videoType, videoBitsPerSecond: 8e6 });
      } catch (e) {
        status.textContent = "This browser can't record video here. You can still play the timelapse.";
        setRunning(null);
        return;
      }
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stoppedRec = new Promise((r) => { rec.onstop = r; });
      rec.start(250);
      let ok = true;
      try {
        await tl.play((i, total) => {
          status.textContent = `Recording leaf ${i} of ${total}. Keep this page open.`;
        });
      } catch (e) { ok = false; }
      rec.stop();
      await stoppedRec;
      setRunning(null);
      if (!ok) {
        status.textContent = 'Recording stopped because the page was hidden or closed. Try again and keep it open.';
        tl.still();
        return;
      }
      const type = (rec.mimeType || videoType).split(';')[0];
      recorded = new Blob(chunks, { type });
      if (videoEl.src) URL.revokeObjectURL(videoEl.src);
      videoEl.src = URL.createObjectURL(recorded);
      canvas.hidden = true;
      videoEl.hidden = false;
      result.hidden = false;
      playBtn.hidden = true;
      recBtn.hidden = true;
      status.textContent = `Your video is ready (${(recorded.size / 1e6).toFixed(1)} MB).`;
    });

    $('#tl-download').addEventListener('click', () => {
      if (recorded) saveFile(recorded, `52nd-leaf-${year}.${/mp4/.test(recorded.type) ? 'mp4' : 'webm'}`);
    });
    $('#tl-back').addEventListener('click', () => {
      videoEl.pause();
      videoEl.hidden = true;
      canvas.hidden = false;
      result.hidden = true;
      playBtn.hidden = false;
      if (recBtn) recBtn.hidden = false;
      status.textContent = '';
      tl.still();
    });
  }

  /* ---------------------------------------------------------------- compare any two weeks */
  const leafLabel = (l, max) => {
    const t = l.title ? ` · ${l.title}` : '';
    const s = `Week ${l.week}, ${l.year}${t}`;
    return max && s.length > max ? s.slice(0, max - 1) + '…' : s;
  };
  // Where "Compare" should start for a leaf: its first photo from the same spot (or the year), else the latest.
  function compareHref(leaf, leaves) {
    const spotLeaves = leaf.spot ? leaves.filter((l) => l.spot && l.spot.toLowerCase() === leaf.spot.toLowerCase()) : [];
    const pool = spotLeaves.length > 1 ? spotLeaves : leaves.filter((l) => l.year === leaf.year).length > 1 ? leaves.filter((l) => l.year === leaf.year) : leaves;
    const first = pool[0], last = pool[pool.length - 1];
    return first === leaf ? `#/compare/${leaf.id}/${last.id}` : `#/compare/${first.id}/${leaf.id}`;
  }

  async function viewCompare(idA, idB) {
    const leaves = await store.all();
    header('back', '#/journal');
    setTitle('Compare weeks');
    footer('');
    if (leaves.length < 2) {
      $('#app').innerHTML = `<section class="notice">
        <p class="eyebrow">Compare weeks</p>
        <h1 class="display">Add one more photo to compare.</h1>
        <p class="lede">Comparing needs two leaves. Once you have them, you can slide between any two weeks and see what changed.</p>
        <a href="#/add" class="btn-primary">Add a photo</a></section>`;
      return;
    }
    const byId = new Map(leaves.map((l) => [l.id, l]));
    let A = byId.get(idA) || leaves[0];
    let B = byId.get(idB) || leaves[leaves.length - 1];
    if (A === B) B = leaves.find((l) => l !== A);
    let view = storage.get('leaf.compare') === 'side' ? 'side' : 'slide';

    const opts = (sel) => leaves.map((l) => `<option value="${l.id}"${l === sel ? ' selected' : ''}>${esc(leafLabel(l, 56))}</option>`).join('');
    $('#app').innerHTML = `
      <section class="compare">
        <div class="compare-head">
          <p class="eyebrow">Compare weeks</p>
          <h1 class="display">See what changed.</h1>
        </div>
        <div class="compare-pick">
          <div class="field"><label for="cmp-a">Before</label><select id="cmp-a">${opts(A)}</select></div>
          <button type="button" class="btn-ghost btn-sm" id="cmp-swap" aria-label="Swap before and after">Swap</button>
          <div class="field"><label for="cmp-b">After</label><select id="cmp-b">${opts(B)}</select></div>
        </div>
        <div class="seg" role="group" aria-label="How to compare">
          <button type="button" data-view="slide" aria-pressed="${view === 'slide'}">Slider</button>
          <button type="button" data-view="side" aria-pressed="${view === 'side'}">Side by side</button>
        </div>
        <div id="cmp-stage"></div>
      </section>`;
    footer('');

    const stage = $('#cmp-stage'), selA = $('#cmp-a'), selB = $('#cmp-b');
    const urls = new Map();
    const src = (l) => { if (!urls.has(l.id)) urls.set(l.id, urlFor(l.photo)); return urls.get(l.id); };
    const when2 = (l) => `${formatRange(l.year, l.week)}, ${l.year}`;
    const cap = (l) => `<figcaption><strong>Week ${l.week}</strong> · ${when2(l)}${l.place ? `<br><span>${esc(l.place)}</span>` : ''}${l.note ? `<br><span class="cap-note">${esc(l.note.length > 120 ? l.note.slice(0, 119) + '…' : l.note)}</span>` : ''}</figcaption>`;

    function draw() {
      if (view === 'slide') {
        stage.innerHTML = `
          <div class="slider" id="slider" style="--pos:50%">
            <img class="s-under" src="${src(B)}" alt="Week ${B.week}, ${B.year}">
            <img class="s-over" src="${src(A)}" alt="Week ${A.week}, ${A.year}">
            <span class="s-tag s-tag-a">Week ${A.week} · ${esc(formatRange(A.year, A.week))}</span>
            <span class="s-tag s-tag-b">Week ${B.week} · ${esc(formatRange(B.year, B.week))}</span>
            <span class="s-line" aria-hidden="true"><span class="s-knob">${icon.left(14)}${icon.right(14)}</span></span>
            <input type="range" class="s-range" min="0" max="100" value="50" aria-label="Slide to reveal ${esc(`week ${A.week} and week ${B.week}`)}">
          </div>
          <div class="cmp-caps">${cap(A)}${cap(B)}</div>`;
        const slider = $('#slider');
        $('.s-range', slider).addEventListener('input', (e) => slider.style.setProperty('--pos', e.target.value + '%'));
      } else {
        stage.innerHTML = `
          <div class="side-by-side">
            <figure><div class="tile big"><img src="${src(A)}" alt="Week ${A.week}, ${A.year}"></div>${cap(A)}</figure>
            <figure><div class="tile big"><img src="${src(B)}" alt="Week ${B.week}, ${B.year}"></div>${cap(B)}</figure>
          </div>`;
      }
    }
    function sync() {
      selA.value = A.id; selB.value = B.id;
      history.replaceState(null, '', `#/compare/${A.id}/${B.id}`);
      draw();
    }
    selA.addEventListener('change', () => { A = byId.get(selA.value); sync(); });
    selB.addEventListener('change', () => { B = byId.get(selB.value); sync(); });
    $('#cmp-swap').addEventListener('click', () => { [A, B] = [B, A]; sync(); });
    document.querySelectorAll('.seg button').forEach((btn) => btn.addEventListener('click', () => {
      view = btn.dataset.view;
      storage.set('leaf.compare', view);
      document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === btn));
      draw();
    }));
    sync();
  }

  /* ---------------------------------------------------------------- spots */
  const spotHref = (name) => `#/spot/${encodeURIComponent(name)}`;

  async function viewSpots() {
    const leaves = await store.all();
    const spots = LeafCore.spotsFrom(leaves);
    header('main', '');
    setTitle('Spots');
    if (!spots.length) {
      footer('');
      $('#app').innerHTML = `<section class="notice">
        <p class="eyebrow">Spots</p>
        <h1 class="display">Follow one place through the year.</h1>
        <p class="lede">When you add a photo, name the spot, like “Maple by the trail”. Photos from the same spot are grouped here, and the guide shows your last one so you can line up the same view.</p>
        <a href="#/add" class="btn-primary">Add a photo</a></section>`;
      return;
    }
    $('#app').innerHTML = `
      <section class="review-head">
        <p class="eyebrow">Spots</p>
        <h1 class="display">Places you come back to</h1>
        <p class="lede">${spots.length} ${spots.length === 1 ? 'spot' : 'spots'}. Open one to see it change through the year.</p>
      </section>
      <section class="spot-grid" aria-label="Spots">
        ${spots.map((s) => {
          const latest = s.leaves[s.leaves.length - 1];
          return `<a href="${spotHref(s.name)}" class="spot-card">
            <div class="tile"><img src="${urlFor(latest.photo)}" alt="" loading="lazy"></div>
            <h2>${esc(s.name)}</h2>
            <span>${s.leaves.length} ${s.leaves.length === 1 ? 'photo' : 'photos'} · latest week ${latest.week}${latest.year !== now().year ? `, ${latest.year}` : ''}</span>
          </a>`;
        }).join('')}
      </section>`;
    footer('');
  }

  async function viewSpot(name) {
    const leaves = await store.all();
    const spot = LeafCore.spotsFrom(leaves).find((s) => s.name.toLowerCase() === String(name).toLowerCase());
    if (!spot) return viewNotFound("That spot doesn't have any photos.", '#/spots');
    header('back', '#/spots', 'All spots');
    setTitle(spot.name);
    const first = spot.leaves[0], last = spot.leaves[spot.leaves.length - 1];
    const day = (l) => `${formatRange(l.year, l.week)}, ${l.year}`;
    $('#app').innerHTML = `
      <section class="review-head">
        <p class="eyebrow">Spot</p>
        <h1 class="display" id="spot-title">${esc(spot.name)}</h1>
        <p class="lede">${spot.leaves.length} ${spot.leaves.length === 1 ? 'photo' : 'photos'}${spot.leaves.length > 1 ? `, from ${esc(day(first))} to ${esc(day(last))}` : `, ${esc(day(first))}`}.</p>
        <div class="actions" style="padding-top:4px">
          ${spot.leaves.length > 1 ? `<a class="btn-primary btn-sm" href="#/compare/${first.id}/${last.id}">Compare first and latest</a>` : ''}
          <button type="button" class="btn-ghost btn-sm" id="rename">Rename spot</button>
        </div>
        <form class="rename" id="rename-form" hidden>
          <label for="rename-input" class="visually-hidden">New name for this spot</label>
          <input id="rename-input" type="text" maxlength="60" value="${esc(spot.name)}">
          <button type="submit" class="btn-primary btn-sm">Save name</button>
          <button type="button" class="text-btn" id="rename-cancel">Cancel</button>
        </form>
      </section>
      <section class="spot-strip" aria-label="Photos from ${esc(spot.name)}">
        ${spot.leaves.map((l) => `<a href="#/leaf/${l.year}/${l.week}" class="spot-leaf">
            <div class="tile"><img src="${urlFor(l.photo)}" alt="" loading="lazy"></div>
            <strong>Week ${l.week}${l.year !== now().year ? `, ${l.year}` : ''}</strong>
            <span>${esc(formatRange(l.year, l.week))}</span>
          </a>`).join('')}
      </section>`;
    footer('');

    const form = $('#rename-form'), field = $('#rename-input');
    $('#rename').addEventListener('click', () => { form.hidden = false; field.focus(); field.select(); });
    $('#rename-cancel').addEventListener('click', () => { form.hidden = true; $('#rename').focus(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const others = LeafCore.spotsFrom(leaves).map((s) => s.name).filter((n) => n.toLowerCase() !== spot.name.toLowerCase());
      const next = LeafCore.normalizeSpot(field.value, others);
      if (!next || next === spot.name) { form.hidden = true; return; }
      if (others.includes(next) && !confirm(`You already have a spot called “${next}”. Merge these photos into it?`)) return;
      for (const l of spot.leaves) await store.put({ ...l, spot: next, updatedAt: new Date().toISOString() });
      toast('Spot renamed');
      location.hash = spotHref(next);
    });
  }

  /* ---------------------------------------------------------------- backup & restore */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(/^data:image\//.test(r.result) ? r.result : String(r.result).replace(/^data:[^;]*;/, 'data:image/jpeg;'));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function dataUrlToBlob(url) {
    return await (await fetch(url)).blob();
  }
  // Photos from other tools can carry EXIF (including GPS). Re-encode those so a backup never does.
  async function withoutMetadata(blob) {
    try {
      if (!LeafExif.hasExif(await blob.slice(0, 262144).arrayBuffer())) return blob;
      const bmp = 'createImageBitmap' in window ? await createImageBitmap(blob) : (await loadImage(blob)).img;
      const c = document.createElement('canvas');
      c.width = bmp.width || bmp.naturalWidth;
      c.height = bmp.height || bmp.naturalHeight;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))) || blob;
    } catch (e) {
      return blob;
    }
  }
  async function packBackup(leaves, onProgress) {
    const parts = [`{"app":"52nd-leaf","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"leaves":[`];
    for (let i = 0; i < leaves.length; i++) {
      onProgress && onProgress(i + 1, leaves.length);
      const { photo, ...fields } = leaves[i];
      parts.push((i ? ',' : '') + JSON.stringify({ ...fields, photo: await blobToDataURL(await withoutMetadata(photo)) }));
    }
    parts.push(']}');
    return new Blob(parts, { type: 'application/json' });
  }
  const mb = (bytes) => (bytes / 1e6 < 10 ? (bytes / 1e6).toFixed(1) : Math.round(bytes / 1e6)) + ' MB';
  const longDate = (d) => `${LeafWeeks.formatDay(d)}, ${d.getFullYear()}`;

  async function viewBackup() {
    const leaves = await store.all();
    header('main', '');
    setTitle('Backup & restore');
    const total = leaves.reduce((s, l) => s + (l.photo ? l.photo.size : 0), 0);
    const last = storage.get('leaf.lastBackup');
    const lastDate = last && !isNaN(new Date(last)) ? new Date(last) : null;

    $('#app').innerHTML = `
      <section class="review-head">
        <p class="eyebrow">Your data</p>
        <h1 class="display">Backup &amp; restore</h1>
        <p class="lede">Your photos and notes live only in this browser, on this device. Download a backup now and then, and you can bring the whole journal back if the browser is cleared or you get a new phone.</p>
      </section>

      <section class="panel" aria-labelledby="bk-h">
        <h2 class="h2" id="bk-h">Save a backup</h2>
        <p>${leaves.length ? `${leaves.length} ${leaves.length === 1 ? 'leaf' : 'leaves'}, about ${mb(total)}.` : 'Nothing to back up yet.'} Location data is removed from photos in the file.</p>
        <p class="review-note">${lastDate ? `Last backup: ${esc(longDate(lastDate))}.` : leaves.length ? "You haven't made a backup yet." : ''}</p>
        <div class="actions" style="padding-top:0">
          <button type="button" class="btn-primary btn-sm" id="bk-go"${leaves.length ? '' : ' disabled'}>Download backup</button>
        </div>
        <p class="review-note" id="bk-status" role="status"></p>
      </section>

      <section class="panel" aria-labelledby="rs-h">
        <h2 class="h2" id="rs-h">Restore from a backup</h2>
        <p>Choose a backup file. Weeks you already have are kept unless you say otherwise.</p>
        <div class="actions" style="padding-top:0">
          <input id="rs-file" class="visually-hidden" type="file" accept=".json,application/json">
          <label for="rs-file" class="btn-ghost btn-sm" id="rs-label" tabindex="0">Choose backup file</label>
        </div>
        <div class="restore-plan" id="rs-plan" hidden></div>
        <p class="error" id="rs-error" role="alert" hidden></p>
      </section>

      <section class="panel" aria-labelledby="st-h">
        <h2 class="h2" id="st-h">Hints</h2>
        <label class="check"><input type="checkbox" id="st-hints"${storage.get('leaf.hints') === 'off' ? '' : ' checked'}> Show a “what to notice” idea when I add a photo</label>
      </section>`;
    footer('');

    $('#st-hints').addEventListener('change', (e) => storage.set('leaf.hints', e.target.checked ? 'on' : 'off'));
    $('#rs-label').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#rs-file').click(); } });

    const go = $('#bk-go'), status = $('#bk-status');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const blob = await packBackup(leaves, (i, n) => { status.textContent = `Packing leaf ${i} of ${n}…`; });
        const d = new Date();
        await saveFile(blob, `52nd-leaf-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`);
        storage.set('leaf.lastBackup', d.toISOString());
        status.textContent = `Backup made (${mb(blob.size)}). Keep it somewhere safe, like your cloud storage.`;
      } catch (e) {
        status.textContent = "The backup couldn't be made. Try again, or try another browser.";
      } finally {
        go.disabled = false;
      }
    });

    const planBox = $('#rs-plan'), rsErr = $('#rs-error');
    const fail = (msg) => { rsErr.textContent = msg; rsErr.hidden = !msg; if (msg) planBox.hidden = true; };
    $('#rs-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      fail('');
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch (ex) { return fail("That file couldn't be read as a backup."); }
      const v = LeafCore.validateBackup(parsed);
      if (v.error) return fail(v.error);
      if (!v.leaves.length) return fail('That backup has no leaves in it.');
      const have = await store.all();
      const plan = LeafCore.planRestore(have.map((l) => l.id), v.leaves, false);
      const from = v.leaves[0], to = v.leaves[v.leaves.length - 1];
      planBox.hidden = false;
      planBox.innerHTML = `
        <p><strong>${v.leaves.length} ${v.leaves.length === 1 ? 'leaf' : 'leaves'}</strong> found, from week ${from.week}, ${from.year} to week ${to.week}, ${to.year}.
        ${plan.add.length} ${plan.add.length === 1 ? 'is' : 'are'} new${plan.clash.length ? `, ${plan.clash.length} ${plan.clash.length === 1 ? 'is a week' : 'are weeks'} you already have` : ''}.${v.skipped ? ` ${v.skipped} couldn't be read and will be skipped.` : ''}</p>
        ${plan.clash.length ? `<label class="check"><input type="checkbox" id="rs-replace"> Replace the ${plan.clash.length} ${plan.clash.length === 1 ? 'week' : 'weeks'} I already have</label>` : ''}
        <div class="actions" style="padding-top:0">
          <button type="button" class="btn-primary btn-sm" id="rs-go">Restore</button>
          <button type="button" class="text-btn" id="rs-cancel">Cancel</button>
        </div>`;
      $('#rs-cancel').addEventListener('click', () => { planBox.hidden = true; });
      $('#rs-go').addEventListener('click', async () => {
        const replace = !!($('#rs-replace') && $('#rs-replace').checked);
        const run = LeafCore.planRestore(have.map((l) => l.id), v.leaves, replace);
        $('#rs-go').disabled = true;
        try {
          for (const l of run.write) {
            const { photo, ...fields } = l;
            await store.put({ ...fields, photo: await dataUrlToBlob(photo) });
          }
          toast(`Restored ${run.write.length} ${run.write.length === 1 ? 'leaf' : 'leaves'}`);
          location.hash = '#/journal';
        } catch (ex) {
          $('#rs-go').disabled = false;
          fail(ex.message || "The restore didn't finish. Some leaves may have been added.");
        }
      });
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
    runCleanups();
    releaseUrls();
    try {
      switch (parts[0] || '') {
        case '': await viewHome(false); break;
        case 'how': await viewHome(true); break;
        case 'journal': await viewJournal(num(parts[1])); break;
        case 'add': await viewEntry(num(parts[1]), num(parts[2])); break;
        case 'review': await viewReview(num(parts[1])); break;
        case 'compare': await viewCompare(parts[1], parts[2]); break;
        case 'spots': await viewSpots(); break;
        case 'spot': await viewSpot(decodeURIComponent(parts[1] || '')); break;
        case 'backup': await viewBackup(); break;
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

  // Work offline: the service worker keeps a copy of the app on this device.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works online */ }));
  }

})();
