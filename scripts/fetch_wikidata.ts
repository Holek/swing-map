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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

// Load alignment mapping
const alignmentMapping: Record<string, number> = yaml.load(
  fs.readFileSync(path.join(__dirname, "mappings/alignment.yaml"), "utf8")
) as any;

// Load ideology mapping
const ideologyMappingData: any = yaml.load(
  fs.readFileSync(path.join(__dirname, "mappings/ideology.yaml"), "utf8")
);

const ideologyRules = ideologyMappingData.ideology_label_rules;

// SPARQL Query A: Head of Government → Party → Alignment/Ideology
const QUERY_HOG = `
SELECT
  ?country ?countryLabel
  ?iso3
  ?hog ?hogLabel
  ?party ?partyLabel
  ?alignment ?alignmentLabel
  ?ideology ?ideologyLabel
  ?hogStatement ?hogStart ?hogEnd
  ?partyStatement ?partyStart ?partyEnd
WHERE {
  ?country wdt:P31/wdt:P279* wd:Q3624078.     # sovereign state
  OPTIONAL { ?country wdt:P298 ?iso3. }       # ISO 3166-1 alpha-3

  # Head of government with qualifiers
  ?country p:P6 ?hogStatement.
  ?hogStatement ps:P6 ?hog.
  OPTIONAL { ?hogStatement pq:P580 ?hogStart. }  # start time
  OPTIONAL { ?hogStatement pq:P582 ?hogEnd. }    # end time

  # Party membership statements on the HoG
  OPTIONAL {
    ?hog p:P102 ?partyStatement.
    ?partyStatement ps:P102 ?party.
    OPTIONAL { ?partyStatement pq:P580 ?partyStart. }
    OPTIONAL { ?partyStatement pq:P582 ?partyEnd. }

    OPTIONAL { ?party wdt:P1387 ?alignment. }  # political alignment
    OPTIONAL { ?party wdt:P1142 ?ideology. }   # political ideology
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
`;

interface SparqlRow {
  country: { value: string };
  countryLabel: { value: string };
  iso3?: { value: string };
  hog?: { value: string };
  hogLabel?: { value: string };
  party?: { value: string };
  partyLabel?: { value: string };
  alignment?: { value: string };
  alignmentLabel?: { value: string };
  ideology?: { value: string };
  ideologyLabel?: { value: string };
  hogStart?: { value: string };
  hogEnd?: { value: string };
  partyStart?: { value: string };
  partyEnd?: { value: string };
}

interface SparqlResponse {
  results: {
    bindings: SparqlRow[];
  };
}

async function querySparql(query: string): Promise<SparqlResponse> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  console.log("Querying Wikidata...");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Political-Leanings-Map/1.0 (Educational project)",
    },
  });

  if (!response.ok) {
    throw new Error(`SPARQL query failed: ${response.statusText}`);
  }

  return response.json();
}

function extractQID(uri: string): string {
  return uri.split("/").pop() || "";
}

function scoreFromAlignment(alignmentQID: string): number | null {
  const mapping = alignmentMapping.alignment_qid_to_score;
  return mapping[alignmentQID] ?? null;
}

function scoreFromIdeologyLabel(label: string): number | null {
  const normalized = label.toLowerCase().trim();

  for (const rule of ideologyRules) {
    for (const match of rule.match) {
      if (normalized.includes(match.toLowerCase())) {
        return rule.score;
      }
    }
  }

  return null;
}

function computePartyScore(
  alignments: string[],
  ideologies: string[]
): { score: number | null; method: string } {
  // Try alignment first
  const alignmentScores = alignments
    .map((a) => scoreFromAlignment(extractQID(a)))
    .filter((s): s is number => s !== null);

  if (alignmentScores.length > 0) {
    const avg = alignmentScores.reduce((a, b) => a + b, 0) / alignmentScores.length;
    return { score: Math.max(-1, Math.min(1, avg)), method: "alignment" };
  }

  // Try ideology
  const ideologyScores = ideologies
    .map((i) => scoreFromIdeologyLabel(i))
    .filter((s): s is number => s !== null);

  if (ideologyScores.length > 0) {
    const avg = ideologyScores.reduce((a, b) => a + b, 0) / ideologyScores.length;
    return { score: Math.max(-1, Math.min(1, avg)), method: "ideology" };
  }

  return { score: null, method: "none" };
}

function selectCurrentHoG(rows: SparqlRow[]): SparqlRow | null {
  if (rows.length === 0) return null;

  // Prefer HoG with no end date (current), else latest start
  const noEnd = rows.filter((r) => !r.hogEnd);
  if (noEnd.length > 0) {
    noEnd.sort((a, b) => {
      const aStart = a.hogStart?.value || "";
      const bStart = b.hogStart?.value || "";
      return bStart.localeCompare(aStart);
    });
    return noEnd[0];
  }

  // Else latest end date
  rows.sort((a, b) => {
    const aEnd = a.hogEnd?.value || "";
    const bEnd = b.hogEnd?.value || "";
    return bEnd.localeCompare(aEnd);
  });
  return rows[0];
}

async function fetchPoliticalLeanings() {
  const response = await querySparql(QUERY_HOG);
  const rows = response.results.bindings;

  console.log(`Received ${rows.length} rows from Wikidata`);

  // Group by country
  const byCountry = new Map<string, SparqlRow[]>();
  for (const row of rows) {
    if (!row.iso3) continue; // Skip countries without ISO3
    const iso3 = row.iso3.value;
    if (!byCountry.has(iso3)) {
      byCountry.set(iso3, []);
    }
    byCountry.get(iso3)!.push(row);
  }

  console.log(`Grouped into ${byCountry.size} countries with ISO3 codes`);

  const countries: Record<string, any> = {};

  for (const [iso3, countryRows] of byCountry.entries()) {
    const currentHoG = selectCurrentHoG(countryRows);
    if (!currentHoG || !currentHoG.party) {
      countries[iso3] = {
        score: null,
        status: "unknown",
        sources: {
          wikidata_country_qid: extractQID(currentHoG?.country.value || ""),
          sparql_query_url: WIKIDATA_ENDPOINT,
        },
        government: {
          parties: [],
          explanation: "No governing party data available",
        },
      };
      continue;
    }

    // Collect all alignment/ideology for the party
    const partyRows = countryRows.filter(
      (r) => r.party?.value === currentHoG.party?.value
    );
    const alignments = partyRows
      .map((r) => r.alignment?.value)
      .filter((a): a is string => !!a);
    const ideologies = partyRows
      .map((r) => r.ideologyLabel?.value)
      .filter((i): i is string => !!i);

    const { score, method } = computePartyScore(alignments, ideologies);

    const partyLabel = currentHoG.partyLabel?.value || "Unknown party";
    const status = method === "alignment" ? "ok" : method === "ideology" ? "approx" : "unknown";

    countries[iso3] = {
      score,
      status,
      sources: {
        wikidata_country_qid: extractQID(currentHoG.country.value),
        sparql_query_url: WIKIDATA_ENDPOINT,
      },
      government: {
        parties: [
          {
            qid: extractQID(currentHoG.party.value),
            name: partyLabel,
            position_score: score,
            weight: 1.0,
          },
        ],
        explanation: `${partyLabel} (${method === "alignment" ? "alignment" : method === "ideology" ? "ideology-based" : "unknown"})`,
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
          },
        ])
      ),
    };

    const jsonPath = path.join(__dirname, "..", "public", "data", "leanings.min.json");
    fs.writeFileSync(jsonPath, JSON.stringify(minData, null, 2), "utf8");
    console.log(`Wrote compact JSON to ${jsonPath}`);

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
