# swing-map

Interactive world map of national governments' political leanings (-1 left … +1 right),
computed from Wikidata, rendered with D3, hosted as a fully static site on GitHub Pages.

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — typecheck + production build
- `npm run lint` — `tsc --noEmit`
- `npm run fetch-data` — regenerate data from Wikidata (see wikidata-pipeline skill)
- `npx tsx scripts/test_wikidata.ts` — probe Wikidata properties for specific countries

## Ground rules

- `data/leanings.yaml` and `public/data/leanings.min.json` are **generated** by
  `scripts/fetch_wikidata.ts` — never hand-edit. Manual fixes go in
  `data/overrides.yaml`, which is merged on top during generation.
- After regenerating data or touching the fetch script, run the **verify-data** skill
  before committing.
- Before modifying any SPARQL query, read the **wikidata-pipeline** skill (temporal
  qualifier semantics are a known footgun).
- Scores: -1..+1; status is `ok` (alignment-based), `approx` (ideology heuristics),
  `unknown` (no signal). Don't render approx/unknown as authoritative.
- Frontend is a single file, `src/main.ts` (no framework). GH Pages base path lives in
  `vite.config.ts`.

## Where things are decided

- `ROADMAP.md` — agreed plan and phase ordering; phase 1 (query fixes) gates shipping
  the pending multi-strategy query work.
- `docs/methodology.md` — public methodology; keep in sync with scoring changes.
