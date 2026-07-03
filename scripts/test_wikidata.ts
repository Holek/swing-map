#!/usr/bin/env tsx
/**
 * Test script to explore Wikidata for missing countries
 * Helps understand what data is available and which query strategies work
 */

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

async function querySparql(query: string): Promise<any> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;

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

// Test queries for specific countries
const countries = [
  { name: "Ukraine", qid: "Q212", iso3: "UKR" },
  { name: "Belarus", qid: "Q184", iso3: "BLR" },
  { name: "Switzerland", qid: "Q39", iso3: "CHE" },
];

async function testCountry(country: { name: string; qid: string; iso3: string }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${country.name} (${country.qid})`);
  console.log("=".repeat(60));

  // Query 1: Check Head of Government
  console.log("\n1. HEAD OF GOVERNMENT (P6):");
  const hogQuery = `
    SELECT ?hog ?hogLabel ?party ?partyLabel WHERE {
      wd:${country.qid} wdt:P6 ?hog .
      OPTIONAL { ?hog wdt:P102 ?party . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
  `;

  try {
    const hogResult = await querySparql(hogQuery);
    if (hogResult.results.bindings.length > 0) {
      hogResult.results.bindings.forEach((row: any) => {
        console.log(`   Head of Gov: ${row.hogLabel?.value || "N/A"}`);
        console.log(`   Party: ${row.partyLabel?.value || "No party data"}`);
      });
    } else {
      console.log("   ❌ No head of government found");
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Query 2: Check Head of State
  console.log("\n2. HEAD OF STATE (P35):");
  const hosQuery = `
    SELECT ?hos ?hosLabel ?party ?partyLabel WHERE {
      wd:${country.qid} wdt:P35 ?hos .
      OPTIONAL { ?hos wdt:P102 ?party . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
  `;

  try {
    const hosResult = await querySparql(hosQuery);
    if (hosResult.results.bindings.length > 0) {
      hosResult.results.bindings.forEach((row: any) => {
        console.log(`   Head of State: ${row.hosLabel?.value || "N/A"}`);
        console.log(`   Party: ${row.partyLabel?.value || "No party data"}`);
      });
    } else {
      console.log("   ❌ No head of state found");
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Query 3: Check Legislature
  console.log("\n3. LEGISLATIVE BODY (P194):");
  const legislatureQuery = `
    SELECT ?legislature ?legislatureLabel WHERE {
      wd:${country.qid} wdt:P194 ?legislature .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
  `;

  try {
    const legislatureResult = await querySparql(legislatureQuery);
    if (legislatureResult.results.bindings.length > 0) {
      legislatureResult.results.bindings.forEach((row: any) => {
        console.log(`   ✓ Legislature: ${row.legislatureLabel?.value}`);
      });
    } else {
      console.log("   ❌ No legislature found");
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Query 4: Check Executive Body (for Switzerland)
  console.log("\n4. EXECUTIVE BODY (P208):");
  const executiveQuery = `
    SELECT ?executive ?executiveLabel ?member ?memberLabel ?party ?partyLabel WHERE {
      wd:${country.qid} wdt:P208 ?executive .
      OPTIONAL {
        ?executive wdt:P527 ?member .
        OPTIONAL { ?member wdt:P102 ?party . }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
    LIMIT 10
  `;

  try {
    const executiveResult = await querySparql(executiveQuery);
    if (executiveResult.results.bindings.length > 0) {
      console.log(`   ✓ Executive body found:`);
      executiveResult.results.bindings.forEach((row: any) => {
        if (row.memberLabel) {
          console.log(`     - ${row.memberLabel.value}: ${row.partyLabel?.value || "No party"}`);
        } else {
          console.log(`     ${row.executiveLabel?.value || "N/A"}`);
        }
      });
    } else {
      console.log("   ❌ No executive body found");
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Query 5: Position Held approach
  console.log("\n5. POSITION HELD (P39) - Recent office holders:");
  const positionQuery = `
    SELECT ?person ?personLabel ?position ?positionLabel ?party ?partyLabel ?startTime ?endTime WHERE {
      ?person wdt:P27 wd:${country.qid} ;  # citizen of country
              p:P39 ?statement .
      ?statement ps:P39 ?position .
      ?position wdt:P31 wd:Q294414 .  # instance of public office

      OPTIONAL { ?statement pq:P580 ?startTime . }
      OPTIONAL { ?statement pq:P582 ?endTime . }
      OPTIONAL { ?person wdt:P102 ?party . }

      FILTER(!BOUND(?endTime) || YEAR(?endTime) >= 2020)  # Current or recent

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    }
    ORDER BY DESC(?startTime)
    LIMIT 5
  `;

  try {
    const positionResult = await querySparql(positionQuery);
    if (positionResult.results.bindings.length > 0) {
      console.log(`   ✓ Recent office holders:`);
      positionResult.results.bindings.forEach((row: any) => {
        const person = row.personLabel?.value || "N/A";
        const position = row.positionLabel?.value || "N/A";
        const party = row.partyLabel?.value || "No party";
        const endTime = row.endTime?.value || "Current";
        console.log(`     - ${person} (${position}): ${party} [Until: ${endTime}]`);
      });
    } else {
      console.log("   ❌ No recent office holders found");
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
}

async function main() {
  console.log("Wikidata Exploration Tool");
  console.log("Testing missing countries to understand data availability\n");

  for (const country of countries) {
    await testCountry(country);
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log("\nThis exploration helps identify:");
  console.log("1. Which Wikidata properties are populated for each country");
  console.log("2. Alternative query strategies that might work");
  console.log("3. Missing data that needs manual overrides or Wikidata contributions");
  console.log("\nNext steps:");
  console.log("- Add manual overrides for countries with insufficient data");
  console.log("- Implement multi-strategy query with fallbacks");
  console.log("- Contribute missing data to Wikidata");
}

main().catch(console.error);
