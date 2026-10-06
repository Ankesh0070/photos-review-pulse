# Photos Review Pulse

Research dashboard and question-answering bot ("Oracle") for **Google Photos user feedback**: 117k store/community reviews, a survey (n=18) and voice interviews (n=3).

- **Dashboard** - `dashboard.html` (charts, survey, interviews, and the **Discovery engine**: what kinds of old photos are hard to retrieve, what people remember vs forget, how they search when memory is incomplete, ranked opportunity areas, final summary).
- **Oracle bot** - `chatbot.html` (BM25 retrieval over the data plus curated discovery answers; no LLM, runs fully in the browser).
- **Solution (live demo)** - `photos-clone/` is a local-first Photos app with the four features built from the findings: memory search, interactive assistant, personal tags/notes, search history + saved searches. Open `photos-clone/?demo=1` to auto-load a demo story library. **Ask Photos** (floating button) is a chat assistant: describe the photo, it shows likely matches, and if it cannot find it (or there are too many) it asks clarifying questions one at a time. It runs on-device with rule-based language understanding, no cloud model.
- `docs/Discovery_Report.md` - full written report.

The two pages link to each other; dashboard questions open the bot with `?q=...`.

## Run locally

```bash
node scripts/static_server.js 5321   # then open http://localhost:5321
node tests/discovery.test.js
node tests/rag.test.js
```

## Method notes
Review coding is rule-based (sampled precision about 85-90%), so counts are lower bounds. Survey and interviews are small convenience samples: read them as patterns, not percentages. Opportunity scores depend on weights; the dashboard reports stability across 1,000 random re-weightings. `scripts/discovery_engine.js` regenerates `static/discovery.json` from the raw review dataset (not included here because of size).