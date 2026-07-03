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

- 175 countries scored: 103 `ok`, 33 `approx`, 39 `unknown`.
- Frontend: single-snapshot choropleth with tooltip (party name + leaning label only).
- Pending (uncommitted) work: multi-strategy SPARQL query
  (head of government → head of state → executive-body members), which solves
  Switzerland's collective Federal Council but **dropped the temporal qualifiers**
  (P580/P582) the old query had — see Phase 1.

---

## Phase 1 — Fix the multi-strategy query (prerequisite)

The pending query rework is a good direction but currently a data-quality regression:

- [ ] Reintroduce temporal qualifiers so only **current** officeholders and **current**
      party memberships count. `wdt:P102` without time bounds can return a leader's
      *former* party.
- [ ] Gate the head-of-state fallback: only use it for executive presidencies, or at
      minimum mark its results `approx`. A ceremonial president's party must not be
      scored as the government's leaning.
- [ ] Make row selection deterministic (`selectBestRows` currently sorts only by
      strategy, then takes the first row — ties are arbitrary).
- [ ] Keep the executive-members strategy (Switzerland), but average member scores as a
      weighted coalition instead of picking one row.
- [ ] Log which strategy produced each country's score; persist it into the data as the
      `method`.

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
