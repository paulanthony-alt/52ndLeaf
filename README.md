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
- **Leaf**: the photo full-size with its note, place, weather and season, links to the
  previous and next leaves, and a "How it's changed" strip of the last seven weeks.

## How it works

- `index.html`, `styles.css`, `app.js`: plain HTML, CSS and JavaScript with hash routing
  (`#/journal`, `#/add/2026/47`, `#/leaf/2026/47`).
- Photos and notes are stored **on this device** in the browser's IndexedDB. Nothing is
  uploaded anywhere. Large camera photos are resized to 1800px on the long edge before saving.
- Weeks start on Monday and follow ISO week numbers. In years with an ISO week 53, those
  last few days are folded into week 52, so every year has exactly 52 leaves.
- Seasons use northern-hemisphere months.

Because data lives in the browser, clearing site data or using a private window will lose
it, and it doesn't sync between devices.

## Design

The original static mockups are in [`design/`](design/) for reference.
