# Methodology: Political Leaning Scoring

## Overview

This project attempts to visualize the political leaning of national governments on a left-right spectrum using a numeric scale from **-1.0 (far-left)** to **+1.0 (far-right)**, with **0** representing the political center.

## Important Caveats

1. **Approximation, not truth**: Political positions are complex and multidimensional. The left-right spectrum is a simplification that cannot capture nuances like authoritarianism vs. libertarianism, social vs. economic policy, or regional variations in political terminology.

2. **Government ≠ Country**: We score the current government's leaning, not the country's population or political culture.

3. **Wikidata limitations**: Data quality depends entirely on Wikidata's coverage and accuracy. Not all countries have well-maintained political data.

4. **Western-centric scale**: The left-right spectrum is primarily a Western European/North American construct and may not apply well to all political systems.

## Data Source

All data comes from **Wikidata**, a free, collaborative knowledge base maintained by the Wikimedia Foundation.

Primary query approach:
```
Country → Head of Government → Political Party → Political Alignment / Ideology
```

### SPARQL Query Strategy

We use Wikidata's SPARQL endpoint to query:

1. **Sovereign states** (P31: instance of → Q3624078: sovereign state)
2. Their **head of government** (P6) with time qualifiers
3. The head of government's **political party membership** (P102) with time qualifiers
4. The party's **political alignment** (P1387) - preferred source
5. The party's **political ideology** (P1142) - fallback source

Time qualifiers help us identify the *current* head of government and their *current* party affiliation.

## Scoring Model

### Step 1: Extract Party Position

For each governing party, we attempt to determine a position score using this hierarchy:

#### Priority 1: Political Alignment (P1387)

Wikidata property P1387 ("political alignment") is specifically designed for left-right positioning. We use this conservative mapping:

| Wikidata Item | Label | Score |
|--------------|-------|-------|
| Q1129409 | far-left | -1.0 |
| Q164597 | left-wing | -0.8 |
| Q737014 | centre-left | -0.4 |
| Q6587194 | centrism | 0.0 |
| Q844072 | centre-right | +0.4 |
| Q76074 | right-wing | +0.8 |
| Q127869500 | far-right | +1.0 |

**If P1387 is present, we use it exclusively and ignore ideology.**

#### Priority 2: Political Ideology (P1142) - Fallback

If no political alignment is available, we attempt to infer position from ideology labels. This is inherently less reliable because ideologies are multidimensional.

We use substring matching on ideology labels (case-insensitive) with conservative mappings:

**Far-left (-0.9)**: communism, marxism, leninism, trotskyism

**Left (-0.6)**: democratic socialism, socialism, social democracy, labourism

**Centre-left (-0.3)**: progressivism, green politics, environmentalism, social liberalism

**Centre (0.0)**: centrism, third way, radical centrism, liberalism (too broad to position precisely)

**Centre-right (+0.3)**: libertarianism, classical liberalism, neoliberalism

**Right (+0.5)**: conservatism, liberal conservatism, christian democracy

**Far-right (+0.7)**: national conservatism, right-wing populism

**Far-right (+0.95)**: fascism, nazism, neo-nazism, white nationalism, ultranationalism

**Unmapped ideologies** (e.g., populism, nationalism, environmentalism as standalone) → no score assigned.

### Step 2: Compute Government Score

#### Single-party government
Use that party's score directly.

#### Coalition government
*(Future enhancement - currently not fully implemented)*

Compute weighted average of coalition parties' scores. Default to equal weights unless seat share data is available.

### Step 3: Status Flag

Each country receives a status indicating confidence level:

- **`ok`**: Score derived from explicit political alignment (P1387) statements for governing parties
- **`approx`**: Score derived from weaker signals (ideology inference, single-party fallback, incomplete data)
- **`unknown`**: Insufficient data to compute a score
- **`disputed`**: Manual flag for complex cases (e.g., non-competitive elections, unclear government structure)

## Handling Edge Cases

### One-party states
Countries with no meaningful party competition (e.g., China, Cuba, North Korea) often can't be meaningfully placed on a Western left-right spectrum. These are typically marked as `unknown`.

### Presidential systems with ceremonial heads of government
We attempt to use head of government (prime minister) rather than head of state (president) where they differ. This can fail in ambiguous systems.

### Recent government changes
Wikidata may lag behind recent elections. Manual overrides can be added to `data/overrides.yaml`.

### Missing ISO codes
Countries without ISO 3166-1 alpha-3 codes cannot be matched to map boundaries and are excluded from visualization (though present in YAML).

## Manual Overrides

The file `data/overrides.yaml` allows manual specification of scores for:
- Edge cases not handled well by automated scoring
- Very recent changes not yet in Wikidata
- Disputed or complex government structures

Overrides completely replace the automated result for a given country.

## Known Limitations

1. **Coalition complexity**: We don't yet handle coalitions with seat-share weighting; we use simple head of government party only.

2. **Subnational variation**: Federal systems with powerful subnational governments (e.g., USA, Germany) have their national government scored, ignoring state/provincial variation.

3. **Policy vs. rhetoric**: We score based on stated party positions in Wikidata, not actual policy outcomes.

4. **Temporal lag**: Wikidata updates are volunteer-driven and may lag real-world changes by days or weeks.

5. **Eurocentric bias**: The left-right spectrum itself is a European construct; applying it globally is inherently problematic.

6. **Ideology ambiguity**: Terms like "populism," "nationalism," or "liberalism" have different meanings in different contexts; our mappings are necessarily crude.

## Reproducibility

The entire pipeline is deterministic and reproducible:

1. Alignment and ideology mappings are version-controlled in `scripts/mappings/*.yaml`
2. SPARQL query is embedded in `scripts/fetch_wikidata.ts`
3. Scoring algorithm is documented here and implemented in the same script
4. All intermediate data is committed to the repository

To reproduce:
```bash
npx tsx scripts/fetch_wikidata.ts
```

This will re-query Wikidata and regenerate all data files.

## Future Enhancements

- **Time travel**: Store monthly snapshots to enable historical visualization
- **Coalition weighting**: Properly handle multi-party coalitions with seat shares
- **Confidence visualization**: Use opacity to show data quality (ok vs. approx vs. unknown)
- **Alternative dimensions**: Add authoritarian-libertarian or other axes beyond left-right
- **Explanatory provenance**: Link directly to Wikidata entities in tooltips

## References

- Wikidata: https://www.wikidata.org/
- Wikidata SPARQL Service: https://query.wikidata.org/
- P1387 (political alignment): https://www.wikidata.org/wiki/Property:P1387
- P1142 (political ideology): https://www.wikidata.org/wiki/Property:P1142
- P6 (head of government): https://www.wikidata.org/wiki/Property:P6
- P102 (member of political party): https://www.wikidata.org/wiki/Property:P102

---

**Last updated**: 2026-01-15
