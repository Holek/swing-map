---
name: wikidata-pipeline
description: Domain knowledge for working on the Wikidata SPARQL data pipeline — modifying queries in scripts/fetch_wikidata.ts, editing score mappings, or investigating why a country's leaning is missing or wrong. Use BEFORE touching any SPARQL query in this repo.
---

# Wikidata pipeline

How this repo turns Wikidata into political leaning scores, and the pitfalls that have
already bitten us once. Read fully before changing `scripts/fetch_wikidata.ts` or the
mappings.

## Pipeline at a glance

```
SPARQL (query.wikidata.org)
  → group rows by ISO3
  → pick governing part(y/ies) per country   [selectBestRows]
  → score each party: alignment map, else ideology heuristics, else null
  → equal-weight average across parties
  → merge data/overrides.yaml on top
  → write data/leanings.yaml (full) + public/data/leanings.min.json (frontend)
```

Run with `npm run fetch-data`. Both output files are **generated — never hand-edit**;
edge cases go in `data/overrides.yaml` instead.

## Wikidata property cheat sheet

| ID | Meaning | Used for |
|----|---------|----------|
| P6 | head of government | primary strategy |
| P35 | head of state | fallback strategy (see warning below) |
| P208 | executive body | Switzerland-style collective executives |
| P527 | has part | members of an executive body |
| P102 | member of political party | person → party |
| P1387 | political alignment | party → score via `scripts/mappings/alignment.yaml` |
| P1142 | political ideology | party → score via label heuristics in `scripts/mappings/ideology.yaml` |
| P39 | position held | historical/backfill queries (ROADMAP phase 3) |
| P580 / P582 | start time / end time (qualifiers) | filtering to *current* statements |
| P298 | ISO 3166-1 alpha-3 | country key used everywhere |
| P194 | legislative body | explored, not used yet |

Sovereign states are matched with `?country wdt:P31/wdt:P279* wd:Q3624078`.

## Critical SPARQL semantics (the footguns)

1. **`wdt:` returns truthy statements with NO qualifier access.** `?person wdt:P102
   ?party` returns **all** party memberships, including former parties. To restrict to
   current ones you must use the full statement form:

   ```sparql
   ?person p:P102 ?st .
   ?st ps:P102 ?party .
   FILTER NOT EXISTS { ?st pq:P582 ?end }   # no end date = current
   ```

   Same applies to officeholder statements (`p:P6` / `pq:P580` / `pq:P582`). **Rule:
   any query about "who currently holds office" or "current party" must handle temporal
   qualifiers.** The original query did this; a rework once dropped it and produced
   scores based on leaders' former parties.

2. **Head-of-state fallback is dangerous.** In parliamentary systems the head of state
   (P35) is often ceremonial; scoring a country by the president's party instead of the
   governing coalition is wrong. If P35 is used as a fallback, gate it to executive
   presidencies or force the result's status to `approx`.

3. **UNION strategies need deterministic selection.** When multiple strategies return
   rows for a country, sort with an explicit, total ordering before slicing — sorting by
   strategy alone leaves ties arbitrary and makes runs non-reproducible.

4. **One party can produce many rows** (one per alignment/ideology value). Scoring
   collects all alignments/ideologies for a party across rows — don't assume one row per
   party.

## Scoring rules

- Alignment (P1387) QIDs map to scores in `scripts/mappings/alignment.yaml` → status
  `ok`.
- If no alignment maps, ideology labels are matched (substring, case-insensitive)
  against `scripts/mappings/ideology.yaml` rules → status `approx`. These heuristics are
  intentionally conservative — only add rules for ideologies that are unambiguously
  left↔right.
- No signal → score `null`, status `unknown`.
- Scores are clamped to [-1, +1]; multi-party results use equal weights (seat-share
  weighting is a ROADMAP item).

## Testing queries

- Interactive: https://query.wikidata.org/ (paste and run; fastest iteration loop).
- Per-country exploration: `npx tsx scripts/test_wikidata.ts` — probes P6, P35, P194,
  P208 and P39 for the countries in its `countries` array; add the country you're
  debugging there.
- Full pipeline: `npm run fetch-data`, then run the **verify-data** skill before
  committing — it diffs coverage and per-country swings against HEAD.

## Endpoint etiquette

- Endpoint: `https://query.wikidata.org/sparql` with `format=json`.
- Always send a descriptive `User-Agent` (already done in both scripts).
- Sleep ~1s between queries in loops (`test_wikidata.ts` does this).
- The big query returns thousands of rows; expect ~10–30s.

## Related docs

- `docs/methodology.md` — public methodology write-up (keep in sync with code changes).
- `docs/wikidata-exploration.md` — notes on alternative query strategies.
- `ROADMAP.md` — phase 1 lists the known query defects to fix.
