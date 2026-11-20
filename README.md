# 52nd Leaf

A personal nature photo journal. Take one picture of nature each week and save it here.
Over the year the photos show how the world around you changes, and give you a reason
to notice the little things you'd usually walk past. By the end of the year you have 52.

## Run it

It's a static site with no build step. Serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000. It also works on any static host (GitHub Pages, Netlify, etc.).

## What it does

- **Home**: this week's number, your latest photo, progress toward 52, and recent leaves.
  With an empty journal it shows the "Your first leaf starts here" start screen instead.
- **Journal**: all 52 weeks of the year as a grid: saved photos, this week, missed weeks
  (still fillable) and weeks still to come. Arrows switch between years once you have more than one.
- **Add / edit**: choose or drag in a photo (on phones this offers the camera), plus an
  optional title, a note, where, and the weather. One photo per week.
- **Same-spot guide**: while adding a photo, a faded copy of your previous leaf sits over the
  frame so you can line up the same tree or view. Drag, pinch, scroll or use the arrow keys to
  frame it; the photo is saved cropped to what the frame shows. **Use camera with guide** shows
  the faded photo over a live camera viewfinder (needs HTTPS or localhost).
- **Year in review** (`#/review`): all 52 weeks as a contact sheet, one row per quarter, which you
  can save as an image, plus a timelapse of every leaf you can play or save as a video
  (MP4 or WebM, depending on the browser). Linked from Home and the Journal.
- **Compare** (`#/compare`): pick any two leaves and slide between them, or view them side by side.
  Opens from a leaf, the Journal, or the footer.
- **Spots** (`#/spots`): give a photo a spot name, like "Maple by the trail". Photos from the same
  spot are grouped, and when you add another the guide shows your last photo from that spot. A spot
  page shows its photos in order, can compare first and latest, and can be renamed or merged.
- **File photos in the right week**: if a photo's date falls in a different week, the add screen
  offers to move to that week. Only the date is read, and nothing is sent anywhere.
- **Hints**: a short "what to notice" idea for the season on the add screen (14 per season).
  Turn them off from the hint card or under Backup & restore.
- **Backup & restore** (`#/backup`): download everything as one `.json` file and restore it later,
  on this or another device. Location data is removed from photos. Restoring keeps weeks you
  already have unless you choose to replace them.
- **Works offline**: a service worker keeps a copy of the app, so it opens with no signal. On a phone,
  use your browser's "Add to Home Screen" (or the Install button in the footer where offered).
  Needs HTTPS or localhost.
- **Preferences** (on the Backup page):
  - **Appearance:** match your device, or force light or dark. Dark mode is a full palette, not an inversion.
  - **Seasons:** Northern or Southern Hemisphere. This changes the season shown on each leaf and the hints.
- **Weekly reminder:** downloads a repeating calendar event (`.ics`) for the day and time you pick. It uses
  your local time, so it keeps its time when you travel. No notification permission or account is needed.
- **Leaf**: the photo full-size with its note, place, weather and season, links to the
  previous and next leaves, and a "How it's changed" strip of the last seven weeks. **Share image**
  saves a 4:5 card with the photo, week, dates, season and note (on a phone it opens the share sheet).

## Tests

```bash
npm test            # unit tests: week math, backup format, spots, photo dates, hints (no dependencies)
npm run test:zones  # the same, in Auckland and Los Angeles time
npm run test:e2e    # drives the real app in a browser (needs Playwright and Chromium)
```

The browser test covers adding, editing and spots, the guide, week suggestions, compare, a full backup
and restore round trip, location data being stripped, offline use, and phone-width layout.

## How it works

- `index.html`, `styles.css`, `app.js`: plain HTML, CSS and JavaScript with hash routing
  (`#/journal`, `#/add/2026/47`, `#/leaf/2026/47`, `#/compare`, `#/spots`, `#/backup`).
- `weeks.js`, `core.js`, `exif.js`, `prompts.js`: logic with no page code, shared by the app and the tests.
- `sw.js`: the service worker. Pages and code load from the network first (so updates arrive) and fall
  back to the saved copy; fonts are saved after the first load.
- Photos and notes are stored **on this device** in the browser's IndexedDB. Nothing is
  uploaded anywhere. Large camera photos are resized to 1800px on the long edge before saving.
- Weeks start on Monday and follow ISO week numbers. In years with an ISO week 53, those
  last few days are folded into week 52, so every year has exactly 52 leaves.
- Seasons default to northern-hemisphere months; switch to the southern hemisphere under Backup & restore.

Because data lives in the browser, clearing site data or using a private window will lose
it, and it doesn't sync between devices. Make a backup now and then.

## Design

The original static mockups are in [`design/`](design/) for reference.
