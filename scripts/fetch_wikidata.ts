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

// SPARQL Query: Multi-strategy approach to find governing parties
// Strategy 1: Head of Government → Party
// Strategy 2: Head of State → Party (fallback for parliamentary systems)
// Strategy 3: Executive Body Members → Parties (for collective executives like Switzerland)
const QUERY_HOG = `
SELECT DISTINCT
  ?country ?countryLabel
  ?iso3
  ?person ?personLabel
  ?party ?partyLabel
  ?alignment ?alignmentLabel
  ?ideology ?ideologyLabel
  ?strategy
WHERE {
  ?country wdt:P31/wdt:P279* wd:Q3624078.     # sovereign state
  OPTIONAL { ?country wdt:P298 ?iso3. }       # ISO 3166-1 alpha-3

  {
    # Strategy 1: Head of Government → Party
    ?country wdt:P6 ?person .
    ?person wdt:P102 ?party .
    BIND("head_of_government" AS ?strategy)
  } UNION {
    # Strategy 2: Head of State → Party (for parliamentary systems)
    ?country wdt:P35 ?person .
    ?person wdt:P102 ?party .
    BIND("head_of_state" AS ?strategy)
  } UNION {
    # Strategy 3: Executive Body Members → Parties (for Switzerland, etc.)
    ?country wdt:P208 ?executive .  # executive body
    ?executive wdt:P527 ?person .   # has part (members)
    ?person wdt:P102 ?party .
    BIND("executive_member" AS ?strategy)
  }

  # Get party alignment and ideology
  OPTIONAL { ?party wdt:P1387 ?alignment. }  # political alignment
  OPTIONAL { ?party wdt:P1142 ?ideology. }   # political ideology

  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
`;

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

function selectBestRows(rows: SparqlRow[]): SparqlRow[] {
  if (rows.length === 0) return [];

  // Priority order: head_of_government > head_of_state > executive_member
  const strategyPriority = {
    "head_of_government": 1,
    "head_of_state": 2,
    "executive_member": 3,
  };

  // Sort by strategy priority
  rows.sort((a, b) => {
    const aPriority = strategyPriority[a.strategy?.value as keyof typeof strategyPriority] || 999;
    const bPriority = strategyPriority[b.strategy?.value as keyof typeof strategyPriority] || 999;
    return aPriority - bPriority;
  });

  const bestStrategy = rows[0].strategy?.value;

  // For executive_member strategy (Switzerland), return all members
  if (bestStrategy === "executive_member") {
    return rows.filter(r => r.strategy?.value === "executive_member" && r.party);
  }

  // For other strategies, return just the best one
  return rows.slice(0, 1);
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
    const bestRows = selectBestRows(countryRows);

    if (bestRows.length === 0 || !bestRows[0].party) {
      countries[iso3] = {
        score: null,
        status: "unknown",
        sources: {
          wikidata_country_qid: extractQID(countryRows[0]?.country.value || ""),
          sparql_query_url: WIKIDATA_ENDPOINT,
        },
        government: {
          parties: [],
          explanation: "No governing party data available",
        },
      };
      continue;
    }

    // Compute scores for each party
    const partyScores: Array<{ party: string; partyLabel: string; score: number | null; method: string }> = [];

    for (const row of bestRows) {
      if (!row.party) continue;

      // Collect all alignment/ideology for this party
      const partyRows = countryRows.filter(
        (r) => r.party?.value === row.party?.value
      );
      const alignments = partyRows
        .map((r) => r.alignment?.value)
        .filter((a): a is string => !!a);
      const ideologies = partyRows
        .map((r) => r.ideologyLabel?.value)
        .filter((i): i is string => !!i);

      const { score, method } = computePartyScore(alignments, ideologies);
      const partyLabel = row.partyLabel?.value || "Unknown party";

      partyScores.push({
        party: row.party.value,
        partyLabel,
        score,
        method,
      });
    }

    // Compute weighted average (for now, equal weights)
    const validScores = partyScores.filter(p => p.score !== null) as Array<{ party: string; partyLabel: string; score: number; method: string }>;

    if (validScores.length === 0) {
      countries[iso3] = {
        score: null,
        status: "unknown",
        sources: {
          wikidata_country_qid: extractQID(bestRows[0].country.value),
          sparql_query_url: WIKIDATA_ENDPOINT,
        },
        government: {
          parties: partyScores.map(p => ({
            qid: extractQID(p.party),
            name: p.partyLabel,
            position_score: p.score,
            weight: 1.0 / partyScores.length,
          })),
          explanation: `${partyScores.map(p => p.partyLabel).join(", ")} (no alignment data)`,
        },
      };
      continue;
    }

    const avgScore = validScores.reduce((sum, p) => sum + p.score, 0) / validScores.length;
    const bestMethod = validScores.some(p => p.method === "alignment") ? "alignment" : "ideology";
    const status = bestMethod === "alignment" ? "ok" : "approx";

    const strategy = bestRows[0].strategy?.value || "unknown";
    const partyNames = validScores.map(p => p.partyLabel).join(", ");
    const explanation = validScores.length === 1
      ? `${partyNames} (${bestMethod === "alignment" ? "alignment" : "ideology-based"})`
      : `Coalition: ${partyNames} (${bestMethod === "alignment" ? "alignment" : "ideology-based"})`;

    countries[iso3] = {
      score: avgScore,
      status,
      sources: {
        wikidata_country_qid: extractQID(bestRows[0].country.value),
        sparql_query_url: WIKIDATA_ENDPOINT,
        strategy,
      },
      government: {
        parties: validScores.map(p => ({
          qid: extractQID(p.party),
          name: p.partyLabel,
          position_score: p.score,
          weight: 1.0 / validScores.length,
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
