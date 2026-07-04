/**
 * Wikidata Query Service client shared by the fetch and backfill scripts.
 */

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

export interface SparqlBinding {
  [variable: string]: { value: string } | undefined;
}

export interface SparqlResponse {
  results: {
    bindings: SparqlBinding[];
  };
}

export async function querySparql(query: string, retries = 2): Promise<SparqlResponse> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;

  for (let attempt = 0; ; attempt++) {
    console.log(`Querying Wikidata...${attempt > 0 ? ` (retry ${attempt})` : ""}`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Political-Leanings-Map/1.0 (Educational project)",
      },
    });

    if (response.ok) {
      return response.json();
    }
    if (attempt >= retries) {
      throw new Error(`SPARQL query failed: ${response.statusText}`);
    }
    // WDQS occasionally times out under load; back off and retry
    await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
  }
}

export function extractQID(uri: string): string {
  return uri.split("/").pop() || "";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
