# Roadmap: from snapshot to swing

## Vision

Swing-map should lean into its name: not a static snapshot of political leanings, but an
**honest, time-aware, self-correcting public record of how the world's governments swing
left and right** — one that funnels its own data gaps back into the open-data commons.

A one-dimensional political snapshot can easily mislead. This roadmap steers the project
toward being the opposite of that, on three pillars:

1. **Time** — show the pendulum swinging, not just where it hangs today.
2. **Honesty** — make data confidence visible; never render a guess as authoritative.
3. **Commons loop** — turn viewers into Wikidata contributors, so the map repairs the
   open data it draws from and every downstream project benefits.

## Current state (2026-07)

- 198 countries in the data: 96 `ok`, 26 `approx`, 76 `unknown` (post-phase-1
  baseline).
- Frontend: single-snapshot choropleth with tooltip (party name + leaning label only).
- Multi-strategy SPARQL query (head of government → gated head of state →
  executive-body members) landed with phase 1.

---

## Phase 1 — Fix the multi-strategy query (prerequisite) ✅ (2026-07-04)

The pending query rework is a good direction but currently a data-quality regression:

- [x] Reintroduce temporal qualifiers so only **current** officeholders and **current**
      party memberships count (best-rank statements without P582 end date, plus a
      P570 date-of-death guard against never-closed statements).
- [x] Gate the head-of-state fallback: only used when a country has no P6 at all, and
      results are always capped at `approx`. (Fires for exactly 3 countries: BWA, SMR,
      VEN.)
- [x] Make row selection deterministic (`selectGovernment` sorts strategies, persons,
      and parties; countries are processed in ISO3 order).
- [x] Keep the executive-members strategy (Switzerland), averaging member scores as a
      member-weighted coalition. P527 on the executive links to a *position* item, so
      current holders are resolved via P39.
- [x] Persist which strategy produced each country's score (`sources.strategy` in
      `data/leanings.yaml`).

Implementation notes: a single UNION query exceeds the WDQS 60s timeout, so the
pipeline runs one cheap country-universe query (fixes countries vanishing from the
output) plus one query per strategy, joined on ISO3 in JS. Coverage baseline moved
from 92 ok / 31 approx / 70 unknown of 193 to **96 ok / 26 approx / 76 unknown of
198** — slightly more unknowns because stale statements (e.g. Belarus scored via the
CPSU) are now honestly rejected.

## Phase 2 — Honesty layer

- [ ] Restore confidence in the UI (the "simplify the tooltip" commit hid it): hatched
      or desaturated fills for `approx`, clearly distinct rendering for `unknown`.
- [ ] Tooltip provenance: scoring method, data status, last-updated date.
- [ ] Link the methodology doc from the UI (one click away from the map).

## Phase 3 — History: the actual "swing"

- [ ] Append-only snapshot schema (e.g. `data/history/YYYY-MM-DD.json` or a single
      NDJSON file); the weekly GitHub Action appends instead of overwriting.
- [ ] Timeline scrubber in the frontend to travel through snapshots.
- [ ] "What changed this week" panel: highlight countries whose government leaning moved
      since the previous snapshot.
- [ ] Historical backfill script: use Wikidata `position held` (P39) start/end
      qualifiers to reconstruct past governments and their leanings — potentially
      decades of pendulum swings, which no free tool currently shows well.

## Phase 4 — Commons contribution loop

- [ ] Tooltip links to the exact Wikidata entities used (party, officeholder).
- [ ] "Improve this data" deep links for `unknown`/`approx` countries, pointing at the
      missing statement on Wikidata.
- [ ] Auto-generated public "data gaps" page at build time (39 unknown countries today)
      as a curated contribution list.
- [ ] CONTRIBUTING section: how to fix a country's data on Wikidata.

---

## Ordering

Phase 1 must land before the pending query changes ship. Phases 2–4 are independent and
can be reordered, but Phase 3 is what makes the project distinctive rather than another
static choropleth.

## Later / out of scope for now

- Coalition weighting by seat share (beyond the Switzerland executive-members case).
- Second axis (authoritarian–libertarian) or external indices (V-Dem, Freedom House).
- Embeddable widget for journalists/educators.
