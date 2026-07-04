#!/usr/bin/env tsx
/**
 * Fetch political leaning data from Wikidata SPARQL endpoint
 * Outputs to data/leanings.yaml and public/data/leanings.min.json
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { WIKIDATA_ENDPOINT, querySparql, extractQID, sleep } from "./lib/wdqs";
import { computePartyScore } from "./lib/scoring";
import {
  appendSnapshotIfChanged,
  buildHistoryMin,
  snapshotCountriesFrom,
} from "./lib/history";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Query 1: the country universe. Every sovereign state with an ISO3 code
// appears in the output — countries with no usable government data get
// status "unknown" instead of vanishing from the map.
const QUERY_COUNTRIES = `
SELECT DISTINCT ?country ?countryLabel ?iso3 WHERE {
  ?country wdt:P31/wdt:P279* wd:Q3624078.     # sovereign state
  ?country wdt:P298 ?iso3.                    # ISO 3166-1 alpha-3
  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
`;

// Governing-party queries, one per strategy (a single UNION query exceeds the
// WDQS 60s timeout). Results are merged and joined to the country universe in
// JS. All strategies share the same tail: current party memberships only —
// best-rank statements without an end date (pq:P582) — so former officeholders
// and former party memberships never leak into the results.
function strategyQuery(officePattern: string): string {
  return `
SELECT DISTINCT ?country ?iso3 ?person ?party ?partyLabel ?alignment ?ideologyLabel WHERE {
  ?country wdt:P31/wdt:P279* wd:Q3624078.     # sovereign state
  ?country wdt:P298 ?iso3.                    # ISO 3166-1 alpha-3
${officePattern}

  # Current officeholders are alive; guards against historical officeholders
  # whose statements are missing an end date
  FILTER NOT EXISTS { ?person wdt:P570 ?dateOfDeath. }

  # Current party memberships only
  ?person p:P102 ?pmSt.
  ?pmSt a wikibase:BestRank;
        ps:P102 ?party.
  FILTER NOT EXISTS { ?pmSt pq:P582 ?pmEnd. }

  OPTIONAL { ?party wdt:P1387 ?alignment. }  # political alignment
  OPTIONAL { ?party wdt:P1142 ?ideology. }   # political ideology

  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
`;
}

const STRATEGY_QUERIES: Array<{ strategy: string; query: string }> = [
  {
    // Strategy 1: current head of government
    strategy: "head_of_government",
    query: strategyQuery(`
  ?country p:P6 ?officeSt.
  ?officeSt a wikibase:BestRank;
            ps:P6 ?person.
  FILTER NOT EXISTS { ?officeSt pq:P582 ?officeEnd. }`),
  },
  {
    // Strategy 2: current head of state, gated to countries with no head of
    // government at all (avoids scoring ceremonial presidents)
    strategy: "head_of_state",
    query: strategyQuery(`
  ?country p:P35 ?officeSt.
  ?officeSt a wikibase:BestRank;
            ps:P35 ?person.
  FILTER NOT EXISTS { ?officeSt pq:P582 ?officeEnd. }
  FILTER NOT EXISTS { ?country wdt:P6 ?anyHog. }`),
  },
  {
    // Strategy 3: collective executive bodies (Switzerland, etc.). P527 on
    // the executive links to a *position* item (e.g. "Member of the Swiss
    // Federal Council"), so current holders are resolved via P39.
    strategy: "executive_member",
    query: strategyQuery(`
  ?country wdt:P208 ?executive.   # executive body
  ?executive wdt:P527 ?part.      # has part (membership position)
  ?person p:P39 ?posSt.
  ?posSt a wikibase:BestRank;
         ps:P39 ?part.
  FILTER NOT EXISTS { ?posSt pq:P582 ?posEnd. }`),
  },
];

interface SparqlRow {
  country: { value: string };
  countryLabel: { value: string };
  iso3?: { value: string };
  person?: { value: string };
  personLabel?: { value: string };
  party?: { value: string };
  partyLabel?: { value: string };
  alignment?: { value: string };
  alignmentLabel?: { value: string };
  ideology?: { value: string };
  ideologyLabel?: { value: string };
  strategy?: { value: string };
}

interface SparqlResponse {
  results: {
    bindings: SparqlRow[];
  };
}

const STRATEGY_PRIORITY: Record<string, number> = {
  head_of_government: 1,
  head_of_state: 2,
  executive_member: 3,
};

interface GovernmentSelection {
  strategy: string;
  // Unique persons and their current parties, both sorted for determinism
  members: Array<{ person: string; parties: string[] }>;
}

function selectGovernment(rows: SparqlRow[]): GovernmentSelection | null {
  const usable = rows.filter((r) => r.person && r.party && r.strategy);
  if (usable.length === 0) return null;

  const strategies = [...new Set(usable.map((r) => r.strategy!.value))].sort(
    (a, b) =>
      (STRATEGY_PRIORITY[a] ?? 999) - (STRATEGY_PRIORITY[b] ?? 999) ||
      a.localeCompare(b)
  );
  const strategy = strategies[0];

  const byPerson = new Map<string, Set<string>>();
  for (const row of usable) {
    if (row.strategy!.value !== strategy) continue;
    if (!byPerson.has(row.person!.value)) byPerson.set(row.person!.value, new Set());
    byPerson.get(row.person!.value)!.add(row.party!.value);
  }

  let members = [...byPerson.entries()]
    .map(([person, parties]) => ({ person, parties: [...parties].sort() }))
    .sort((a, b) => a.person.localeCompare(b.person));

  // A single office (HoG/HoS) should yield one person. If Wikidata carries
  // several open-ended statements, pick one deterministically rather than
  // depending on result order.
  if (strategy !== "executive_member") {
    members = members.slice(0, 1);
  }

  return { strategy, members };
}

async function fetchPoliticalLeanings() {
  const universeResponse = (await querySparql(QUERY_COUNTRIES)) as SparqlResponse;

  const rows: SparqlRow[] = [];
  for (const { strategy, query } of STRATEGY_QUERIES) {
    await sleep(1000); // be polite to WDQS
    const resp = (await querySparql(query)) as SparqlResponse;
    console.log(`  ${strategy}: ${resp.results.bindings.length} rows`);
    for (const row of resp.results.bindings) {
      rows.push({ ...row, strategy: { value: strategy } });
    }
  }

  // ISO3 → country entity. If several entities share a code (e.g. a state and
  // its historical predecessor), keep the lowest URI for determinism.
  const universe = new Map<string, { qid: string; uri: string }>();
  for (const row of universeResponse.results.bindings) {
    if (!row.iso3) continue;
    const iso3 = row.iso3.value;
    const existing = universe.get(iso3);
    if (!existing || row.country.value < existing.uri) {
      universe.set(iso3, { qid: extractQID(row.country.value), uri: row.country.value });
    }
  }

  console.log(`Country universe: ${universe.size} sovereign states with ISO3`);
  console.log(`Received ${rows.length} governing-party rows from Wikidata`);

  // Group party rows by country
  const byCountry = new Map<string, SparqlRow[]>();
  for (const row of rows) {
    if (!row.iso3) continue; // Skip countries without ISO3
    const iso3 = row.iso3.value;
    if (!byCountry.has(iso3)) {
      byCountry.set(iso3, []);
    }
    byCountry.get(iso3)!.push(row);
  }

  const countries: Record<string, any> = {};

  for (const [iso3, countryInfo] of [...universe.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const countryRows = byCountry.get(iso3) ?? [];
    const selection = selectGovernment(countryRows);

    if (!selection) {
      countries[iso3] = {
        score: null,
        status: "unknown",
        sources: {
          wikidata_country_qid: countryInfo.qid,
          sparql_query_url: WIKIDATA_ENDPOINT,
        },
        government: {
          parties: [],
          explanation: "No governing party data available",
        },
      };
      continue;
    }

    // Party weights: each selected person contributes 1 unit, split equally
    // across their current parties. For a single HoG this is the old behavior;
    // for collective executives parties are weighted by member count.
    const partyWeights = new Map<string, number>();
    for (const member of selection.members) {
      for (const party of member.parties) {
        partyWeights.set(
          party,
          (partyWeights.get(party) ?? 0) + 1 / member.parties.length
        );
      }
    }
    const totalWeight = selection.members.length;

    // Compute scores for each party
    const partyScores: Array<{
      party: string;
      partyLabel: string;
      score: number | null;
      method: string;
      weight: number;
    }> = [];

    for (const [party, weight] of [...partyWeights.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      // Collect all distinct alignment/ideology values for this party
      const partyRows = countryRows.filter((r) => r.party?.value === party);
      const alignments = [
        ...new Set(
          partyRows.map((r) => r.alignment?.value).filter((a): a is string => !!a)
        ),
      ];
      const ideologies = [
        ...new Set(
          partyRows
            .map((r) => r.ideologyLabel?.value)
            .filter((i): i is string => !!i)
        ),
      ];

      const { score, method } = computePartyScore(alignments, ideologies);
      const partyLabel = partyRows[0]?.partyLabel?.value || "Unknown party";

      partyScores.push({
        party,
        partyLabel,
        score,
        method,
        weight: weight / totalWeight,
      });
    }

    const validScores = partyScores.filter(
      (p) => p.score !== null
    ) as Array<{ party: string; partyLabel: string; score: number; method: string; weight: number }>;

    if (validScores.length === 0) {
      countries[iso3] = {
        score: null,
        status: "unknown",
        sources: {
          wikidata_country_qid: countryInfo.qid,
          sparql_query_url: WIKIDATA_ENDPOINT,
          strategy: selection.strategy,
        },
        government: {
          parties: partyScores.map(p => ({
            qid: extractQID(p.party),
            name: p.partyLabel,
            position_score: p.score,
            weight: p.weight,
          })),
          explanation: `${partyScores.map(p => p.partyLabel).join(", ")} (no alignment data)`,
        },
      };
      continue;
    }

    // Weighted average over scored parties (weights renormalized so parties
    // without a score don't drag the result toward zero)
    const scoredWeight = validScores.reduce((sum, p) => sum + p.weight, 0);
    const avgScore =
      validScores.reduce((sum, p) => sum + p.score * p.weight, 0) / scoredWeight;
    const bestMethod = validScores.some(p => p.method === "alignment") ? "alignment" : "ideology";

    // Head-of-state inference is indirect (only used where no head of
    // government exists) — never report it as high confidence.
    const status =
      selection.strategy === "head_of_state"
        ? "approx"
        : bestMethod === "alignment"
          ? "ok"
          : "approx";

    const partyNames = validScores.map(p => p.partyLabel).join(", ");
    const explanation = validScores.length === 1
      ? `${partyNames} (${bestMethod === "alignment" ? "alignment" : "ideology-based"})`
      : `Coalition: ${partyNames} (${bestMethod === "alignment" ? "alignment" : "ideology-based"})`;

    countries[iso3] = {
      score: avgScore,
      status,
      sources: {
        wikidata_country_qid: extractQID(countryRows[0].country.value),
        sparql_query_url: WIKIDATA_ENDPOINT,
        strategy: selection.strategy,
      },
      government: {
        parties: validScores.map(p => ({
          qid: extractQID(p.party),
          name: p.partyLabel,
          position_score: p.score,
          weight: p.weight,
        })),
        explanation,
      },
    };
  }

  return countries;
}

async function main() {
  try {
    console.log("Fetching political leanings from Wikidata...");
    const countries = await fetchPoliticalLeanings();

    // Load overrides
    const overridesPath = path.join(__dirname, "..", "data", "overrides.yaml");
    let overrides: any = { countries: {} };
    if (fs.existsSync(overridesPath)) {
      const overridesData = yaml.load(fs.readFileSync(overridesPath, "utf8")) as any;
      overrides = overridesData || { countries: {} };
    }

    // Merge overrides
    for (const [iso3, override] of Object.entries(overrides.countries || {})) {
      countries[iso3] = override;
    }

    // Write full YAML
    const fullData = {
      updated_at: new Date().toISOString(),
      model: {
        scale: "-1..+1",
        method: "party-weighted average",
        notes: "Political leaning derived from governing party alignment and ideology in Wikidata",
      },
      countries,
    };

    const yamlPath = path.join(__dirname, "..", "data", "leanings.yaml");
    fs.writeFileSync(yamlPath, yaml.dump(fullData), "utf8");
    console.log(`Wrote full data to ${yamlPath}`);

    // Write compact JSON for frontend
    const minData = {
      updated_at: fullData.updated_at,
      countries: Object.fromEntries(
        Object.entries(countries).map(([iso3, data]: [string, any]) => [
          iso3,
          {
            score: data.score,
            status: data.status,
            name: iso3, // Will be enriched from TopoJSON
            explanation: data.government?.explanation || "No data",
            strategy: data.sources?.strategy,
          },
        ])
      ),
    };

    const jsonPath = path.join(__dirname, "..", "public", "data", "leanings.min.json");
    fs.writeFileSync(jsonPath, JSON.stringify(minData, null, 2), "utf8");
    console.log(`Wrote compact JSON to ${jsonPath}`);

    // Append-only history: record a snapshot when the data actually changed,
    // then rebuild the aggregated frontend file (ROADMAP phase 3)
    const snapshotDate = fullData.updated_at.slice(0, 10);
    const appended = appendSnapshotIfChanged({
      date: snapshotDate,
      source: "live",
      countries: snapshotCountriesFrom(countries),
    });
    const snapshotCount = buildHistoryMin();
    console.log(
      appended
        ? `Appended history snapshot ${snapshotDate} (${snapshotCount} total)`
        : `No content change — history unchanged (${snapshotCount} snapshots)`
    );

    console.log(`\nProcessed ${Object.keys(countries).length} countries`);
    const withScores = Object.values(countries).filter(
      (c: any) => typeof c.score === "number"
    ).length;
    console.log(`Countries with scores: ${withScores}`);
    console.log(`Countries without scores: ${Object.keys(countries).length - withScores}`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
