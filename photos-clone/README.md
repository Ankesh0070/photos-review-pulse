# Photos — local-first photo library (clone of the Google Photos experience)

Everything runs in the browser. Photos, albums, faces and settings live in IndexedDB; nothing is uploaded anywhere.
There is no build step and no dependencies to install.

## Run

```bash
node photos-clone/serve.js 5330     # then open http://localhost:5330
```

Any static server works (`python -m http.server`, `npx serve`, …). It must be served over `http://localhost` or `https` (not `file://`) because of IndexedDB, service worker and module features.

Empty library? Click **Add sample photos** on the home screen, or drag in your own photos/folders.

## What is implemented

**Library & grid** — justified timeline, Day / Month / Year zoom (buttons, Ctrl+scroll, pinch), date scrubber, sticky date headers with place names, lazy tiles (tested with 4,000+ items), click / Shift-range / drag-box / long-press selection, per-section select, stacks, drag-and-drop & folder & paste upload, Google Takeout `.json` sidecar import (dates, descriptions, favorites, GPS), duplicate detection on import, storage-saver quality.

**Viewer** — swipe, pinch / wheel / double-tap zoom, swipe-down to close, filmstrip, preload, slideshow (fullscreen), info panel (editable description, date, rename, camera EXIF, location + map, people, albums, labels), Copy-text-from-image (OCR), video speed / loop / trim, copy, print, download, share, keyboard shortcuts.

**Editor** — Auto/Dynamic/Vivid/… suggestions, crop with draggable handles + aspect presets, straighten, rotate, flip, 17 light/colour/detail sliders (brightness, contrast, white/black point, highlights, shadows, vignette, saturation, warmth, tint, skin tone, deep blue, pop, HDR, clarity, sharpen, fade), 17 filters with strength, markup (pen, highlighter, text, eraser), undo/redo, hold-to-compare, Save / Save copy, revert to original.

**Search** — natural-language dates (“photos from June 2023”, “last week”, “5 March”), people, albums, places, labels, OCR text, types (videos, selfies, screenshots, panoramas, documents, favorites), filter dialog, history, suggestions.

**Explore** — People & pets (on-device face grouping, rename, merge, hide, mark as pet), Places (map view with clustering + place names), Things (object labels), Creations.

**Albums & sharing** — albums (cover, sort, description, duplicate), shared albums (members, roles, comments, likes, e-mail invite), link sharing, partner sharing, **standalone HTML / ZIP export** (the way to actually send photos to someone), Web Share API.

**Create** — collage (layouts, spacing, corners, background, swap), animated GIF, movie (themes, titles, soundtrack, real-time render to .webm), camera capture & document scan, memories (on this day, trips, best of month, recent highlights, people) with story viewer.

**Utilities** — duplicates, burst stacks, blurry photos, screenshots, large files, documents, recently added, print store (local order proofs), storage manager, export/import.

**Safety & housekeeping** — Trash (restore / auto-purge), Archive, PIN-protected Locked Folder (hashed PIN, auto-lock), strip location on share, dark/light/auto theme, PWA (installable, offline shell), full keyboard shortcuts (`?`).

## Memory search (added from the primary research)

Built from what survey respondents and interviewees asked for: describe photos the way you remember them, get help when search fails, add your own words, and don’t lose an unfinished search.

1. **AI-powered memory search** — type a description, not keywords: *“Find a photo where I was wearing a pink dress at my friend’s wedding”*. The query is split into clues (event, attire, people, places, dates incl. vague ones like “6 years back”, indoor/outdoor, tags, Hinglish words such as *shaadi*). Each photo is scored clue by clue, so a photo that fits *most* of what you remember still shows up as a **possible match**, and every result says **why** (✓ matched / ✗ missing). Clues are chips you can click to ignore. Events spread across a whole moment (one tagged wedding photo lifts the rest of that day). Optional **on-device CLIP** (Settings → Search & memory, ~90 MB once) adds true semantic matching for outfits/scenes; without it, outfit matching falls back to pixel colours + your tags and is labelled “≈ approximate”.
2. **Interactive search assistant** — when a search is vague or empty it asks follow-up questions (*Indoors or outdoors? Who was with you? Trip or event? Roughly when? Where?*). The next question is whichever splits the remaining candidates best, answers are soft (so a wrong memory doesn’t hide the photo), every answer is a removable chip, and **✓ This is it** closes the loop.
3. **Personal tags & memory notes** — per-photo tags and a longer note in the viewer’s Info panel, bulk **Add tags…** in the selection menu, **Name this moment** (tags every photo from that event at once), a **Tags** page (rename / remove) and *My tags* in Explore. Tags and notes carry the highest search weight.
4. **Search history & saved searches** — unfinished searches wait under **Continue where you left off** (answers restored), searches can be **saved** with optional **alerts** when newly added photos match, and everything is managed on the **Searches** page (Unfinished / Saved / History).

Tests for the language parser and retrieval engine (pure JS, no browser needed):

```bash
node photos-clone/tests/engine.test.js     # 30 tests incl. a 10,000-photo timing check
```

## Smart features (optional, off by default)

Settings → *Smart analysis* downloads models from public CDNs the first time (face-api, MobileNet, Tesseract.js) and runs them on-device. Place-name lookup (OpenStreetMap Nominatim) sends coordinates and is a separate opt-in toggle.

## Honest limits vs. the real product

- No cloud: no cross-device sync, no real server-side sharing links (links only open in the same browser; use the HTML/ZIP export to send photos to others), partner sharing/invites are stored locally and sent via `mailto:`.
- No Google ML: no Magic Eraser, Photo Unblur, Portrait light, Cinematic 3D photos, Lens object recognition, or Gemini “Ask Photos”. Labels come from MobileNet (1000 ImageNet classes), faces from face-api.js — good, not Google-grade.
- HEIC/HEIF is only supported where the browser can decode it (Safari). Raw files aren’t supported.
- Print store creates local order proofs; there is no payment or fulfilment.
