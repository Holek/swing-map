#!/usr/bin/env tsx
/**
 * Historical backfill (ROADMAP phase 3): reconstruct past governments from
 * Wikidata office-holder records and write yearly Jan-1 snapshots into
 * data/history/.
 *
 * Method: every country p:P6 (head of government) statement carries P580/P582
 * qualifiers; party membership (p:P102) statements carry them too. For each
 * snapshot date we pick the officeholder whose term covers the date and the
 * parties whose membership covers it, then score with the same alignment /
 * ideology mappings as the live pipeline.
 *
 * Honesty limits, by construction:
 * - P6 only — no head-of-state fallback and no collective executives, so
 *   countries like Switzerland are simply absent from backfilled snapshots.
 * - Party alignment/ideology is as recorded *today*; projecting it onto the
 *   past is an approximation. Every backfilled entry is therefore capped at
 *   status "approx".
 *
 * Usage: npx tsx scripts/backfill_history.ts [--from 1946] [--to 2026]
 * Re-runs regenerate backfill snapshots idempotently; live snapshot files
 * (source: "live") are never overwritten.
 */

import { querySparql, extractQID, sleep } from "./lib/wdqs";
import { computePartyScore } from "./lib/scoring";
import {
  HISTORY_DIR,
  buildHistoryMin,
  listSnapshotFiles,
  readSnapshot,
  writeSnapshot,
  Snapshot,
  SnapshotCountry,
} from "./lib/history";

const QUERY_TERMS = `
SELECT ?iso3 ?person ?start ?end WHERE {
  ?country wdt:P31/wdt:P279* wd:Q3624078.     # sovereign state
  ?country wdt:P298 ?iso3.                    # ISO 3166-1 alpha-3
  ?country p:P6 ?st.
  ?st ps:P6 ?person.
  ?st pq:P580 ?start.                         # undatable terms are unusable
  OPTIONAL { ?st pq:P582 ?end. }
  MINUS { ?st wikibase:rank wikibase:DeprecatedRank. }
}
`;

function membershipsQuery(personQIDs: string[]): string {
  return `
SELECT ?person ?party ?partyLabel ?pmStart ?pmEnd ?alignment ?ideologyLabel WHERE {
  VALUES ?person { ${personQIDs.map((q) => `wd:${q}`).join(" ")} }
  ?person p:P102 ?pmSt.
  ?pmSt ps:P102 ?party.
  MINUS { ?pmSt wikibase:rank wikibase:DeprecatedRank. }
  OPTIONAL { ?pmSt pq:P580 ?pmStart. }
  OPTIONAL { ?pmSt pq:P582 ?pmEnd. }
  OPTIONAL { ?party wdt:P1387 ?alignment. }  # political alignment
  OPTIONAL { ?party wdt:P1142 ?ideology. }   # political ideology
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;
}

interface Term {
  iso3: string;
  person: string; // QID
  start: string; // YYYY-MM-DD
  end: string | null;
}

interface Membership {
  party: string; // QID
  partyLabel: string;
  start: string | null;
  end: string | null;
}

interface PartyFacts {
  label: string;
  alignments: Set<string>;
  ideologies: Set<string>;
}

// Wikidata timestamps look like "1990-05-12T00:00:00Z"; keep the date part.
// Pre-year-1000 and BCE values can't be compared as fixed-width strings — the
// modern era is all we chart, so drop them.
function toDate(value: string | undefined): string | null {
  if (!value || value.startsWith("-") || !/^\d{4}-/.test(value)) return null;
  return value.slice(0, 10);
}

function parseArgs(): { from: number; to: number } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : fallback;
  };
  const currentYear = parseInt(
    new Date().toISOString().slice(0, 4),
    10
  );
  return { from: get("--from", 1946), to: get("--to", currentYear) };
}

async function main() {
  const { from, to } = parseArgs();
  console.log(`Backfilling yearly snapshots ${from}-01-01 .. ${to}-01-01`);

  // 1. All datable head-of-government terms
  const termsResp = await querySparql(QUERY_TERMS);
  const terms: Term[] = [];
  for (const row of termsResp.results.bindings) {
    const start = toDate(row.start?.value);
    if (!row.iso3 || !row.person || !start) continue;
    terms.push({
      iso3: row.iso3.value,
      person: extractQID(row.person.value),
      start,
      end: toDate(row.end?.value),
    });
  }
  const byCountry = new Map<string, Term[]>();
  for (const t of terms) {
    if (!byCountry.has(t.iso3)) byCountry.set(t.iso3, []);
    byCountry.get(t.iso3)!.push(t);
  }
  console.log(`${terms.length} dated HoG terms across ${byCountry.size} countries`);

  // 2. Party memberships (with validity windows) for every officeholder
  const persons = [...new Set(terms.map((t) => t.person))].sort();
  console.log(`${persons.length} distinct officeholders; fetching memberships...`);

  const membershipsByPerson = new Map<string, Membership[]>();
  const partyFacts = new Map<string, PartyFacts>();
  const BATCH = 150;
  for (let i = 0; i < persons.length; i += BATCH) {
    const batch = persons.slice(i, i + BATCH);
    await sleep(1000); // be polite to WDQS
    const resp = await querySparql(membershipsQuery(batch));
    console.log(
      `  memberships batch ${i / BATCH + 1}/${Math.ceil(persons.length / BATCH)}: ` +
        `${resp.results.bindings.length} rows`
    );
    for (const row of resp.results.bindings) {
      if (!row.person || !row.party) continue;
      const person = extractQID(row.person.value);
      const party = extractQID(row.party.value);

      if (!partyFacts.has(party)) {
        partyFacts.set(party, {
          label: row.partyLabel?.value || "Unknown party",
          alignments: new Set(),
          ideologies: new Set(),
        });
      }
      const facts = partyFacts.get(party)!;
      if (row.alignment) facts.alignments.add(row.alignment.value);
      if (row.ideologyLabel) facts.ideologies.add(row.ideologyLabel.value);

      if (!membershipsByPerson.has(person)) membershipsByPerson.set(person, []);
      const list = membershipsByPerson.get(person)!;
      const start = toDate(row.pmStart?.value);
      const end = toDate(row.pmEnd?.value);
      if (!list.some((m) => m.party === party && m.start === start && m.end === end)) {
        list.push({
          party,
          partyLabel: row.partyLabel?.value || "Unknown party",
          start,
          end,
        });
      }
    }
  }

  // 3. Reconstruct one snapshot per year
  const liveDates = new Set(
    listSnapshotFiles()
      .map((f) => readSnapshot(f))
      .filter((s) => s.source === "live")
      .map((s) => s.date)
  );

  let written = 0;
  for (let year = from; year <= to; year++) {
    const date = `${year}-01-01`;
    if (liveDates.has(date)) continue; // never clobber live snapshots

    const countries: Record<string, SnapshotCountry> = {};
    for (const [iso3, countryTerms] of [...byCountry.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      // The officeholder at this date: term covers it; on overlapping
      // statements (usually a missing end date upstream) prefer the latest
      // start, then lowest QID, for determinism.
      const holders = countryTerms
        .filter((t) => t.start <= date && (!t.end || t.end > date))
        .sort((a, b) => b.start.localeCompare(a.start) || a.person.localeCompare(b.person));
      if (holders.length === 0) continue;
      const holder = holders[0];

      // Parties whose membership covers the date; undated memberships count
      // as always valid (the common single-lifelong-party case)
      const memberships = (membershipsByPerson.get(holder.person) ?? []).filter(
        (m) => (!m.start || m.start <= date) && (!m.end || m.end > date)
      );
      const parties = [...new Set(memberships.map((m) => m.party))].sort();
      if (parties.length === 0) continue;

      const scored = parties
        .map((party) => {
          const facts = partyFacts.get(party)!;
          const { score } = computePartyScore(
            [...facts.alignments].sort(),
            [...facts.ideologies].sort()
          );
          return { party, label: facts.label, score };
        })
        .filter((p): p is { party: string; label: string; score: number } =>
          typeof p.score === "number"
        );
      if (scored.length === 0) continue;

      const avg = scored.reduce((sum, p) => sum + p.score, 0) / scored.length;
      countries[iso3] = {
        score: Math.max(-1, Math.min(1, avg)),
        // Today's alignment data projected onto the past — never better than approx
        status: "approx",
        party: scored.map((p) => p.label).join(", "),
        strategy: "head_of_government",
      };
    }

    if (Object.keys(countries).length === 0) continue;
    const snapshot: Snapshot = { date, source: "backfill", countries };
    writeSnapshot(snapshot);
    written++;
    console.log(`  ${date}: ${Object.keys(countries).length} countries`);
  }

  const total = buildHistoryMin();
  console.log(`\nWrote ${written} backfill snapshots to ${HISTORY_DIR}`);
  console.log(`history.min.json now has ${total} snapshots`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
