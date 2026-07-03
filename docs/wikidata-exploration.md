# Understanding Wikidata and Alternative Query Strategies

## Current Approach and Its Limitations

### How the Current Query Works

```sparql
Country → Head of Government (P6) → Party Membership (P102) → Political Alignment (P1387)
```

**Why this fails for some countries:**

1. **Missing Head of Government (P6)**: Some countries don't have P6 populated
   - Switzerland: Has Federal Council (collective), not a single head of government
   - Some authoritarian states: Data might be incomplete or disputed

2. **Missing Party Membership (P102)**: Head of government exists but party not linked
   - Independent politicians
   - Military governments
   - Data gaps

3. **Missing Political Alignment (P1387)**: Party exists but alignment not specified
   - Smaller parties with incomplete Wikidata entries
   - Non-Western parties where left-right spectrum doesn't apply well

## Wikidata Structure Basics

### Properties (P) and Items (Q)

- **Items (Q)**: Entities (countries, people, parties, concepts)
  - Example: Q212 = Ukraine, Q30 = United States

- **Properties (P)**: Relationships between items
  - P6 = head of government
  - P102 = member of political party
  - P1387 = political alignment
  - P1142 = political ideology

### Statement Types in SPARQL

1. **Simple statements** (`wdt:` prefix):
   ```sparql
   ?country wdt:P6 ?hog .  # Country has head of government
   ```
   Gets only the most recent/preferred value.

2. **Full statements** (`p:` and `ps:` prefix):
   ```sparql
   ?country p:P6 ?statement .  # Get the statement node
   ?statement ps:P6 ?hog .     # Extract the value
   ?statement pq:P580 ?start . # Get qualifiers (start time)
   ```
   Allows access to qualifiers (start time, end time, etc.)

## Alternative Query Strategies

### Strategy 1: Legislature-Based Approach

Instead of head of government, look at the legislature composition:

```sparql
Country → Legislature (P194) → Has Part (P527) → Parliamentary Group → Party
```

**Wikidata Properties:**
- P194: legislative body
- P527: has part (for parliamentary groups)
- P5460: parliamentary group (links legislators to groups)

**Advantages:**
- Works for countries with collective executives (Switzerland)
- Captures coalition governments better
- More likely to have recent data

**Challenges:**
- More complex query
- Need to identify which parties are in government vs. opposition

### Strategy 2: Reverse Party Search

Start with political parties and work backwards:

```sparql
Party → Country (P17) → Governing Party Status → Alignment
```

**Wikidata Properties:**
- P17: country
- P1142: political ideology
- P1387: political alignment
- Look for parties with recent election victories or government participation

**Advantages:**
- Finds parties even if head of government link is missing
- Can discover multiple governing parties (coalitions)

**Challenges:**
- How to determine which parties are currently in government?
- No direct "is governing party" property in Wikidata

### Strategy 3: Multiple Fallback Queries

Execute several queries in sequence:

1. **Primary**: Head of Government → Party (current approach)
2. **Fallback 1**: Legislature composition
3. **Fallback 2**: Recent election winners
4. **Fallback 3**: Head of State → Party (for parliamentary republics)

### Strategy 4: Use "Office Held" Property

```sparql
Person → Position Held (P39) → Prime Minister of [Country] → Party → Alignment
```

**Wikidata Properties:**
- P39: position held (with start/end qualifiers)
- Can search for positions like "Prime Minister of Ukraine"

**Advantages:**
- More direct than P6 (which might be missing)
- Time qualifiers help identify current officeholders

## Exploring Missing Countries

Let me check what data exists for the problematic countries:

### Ukraine (Q212)
- P6 (head of government): Check if populated
- P1906 (office held by head of government): Alternative
- P194 (legislative body): Q2184796 (Verkhovna Rada)

### Belarus (Q184)
- P6: Likely populated (Lukashenko)
- Issue: Might not have party data (independent/authoritarian)

### Switzerland (Q39)
- P6: Likely missing (collective Federal Council)
- P194: Q11774 (Federal Assembly)
- Need to query Federal Council members individually

## Proposed Improved Query

Combine multiple approaches with UNION:

```sparql
SELECT DISTINCT ?country ?countryLabel ?iso3 ?party ?partyLabel ?alignment ?ideology
WHERE {
  # All sovereign states
  ?country wdt:P31/wdt:P279* wd:Q3624078 .
  OPTIONAL { ?country wdt:P298 ?iso3 . }

  {
    # Approach 1: Head of Government → Party
    ?country wdt:P6 ?hog .
    ?hog wdt:P102 ?party .
  } UNION {
    # Approach 2: Head of State → Party (for parliamentary systems)
    ?country wdt:P35 ?hos .
    ?hos wdt:P102 ?party .
  } UNION {
    # Approach 3: Recent Prime Minister position holders
    ?country wdt:P1906 ?pmPosition .
    ?person p:P39 ?statement .
    ?statement ps:P39 ?pmPosition .
    FILTER NOT EXISTS { ?statement pq:P582 ?endTime }  # No end time = current
    ?person wdt:P102 ?party .
  } UNION {
    # Approach 4: Governing parties via legislative participation
    ?country wdt:P194 ?legislature .
    ?legislature wdt:P527 ?parliamentaryGroup .
    ?parliamentaryGroup wdt:P1142 ?party .
    # TODO: Add filter for government participation
  }

  # Get alignment and ideology from party
  OPTIONAL { ?party wdt:P1387 ?alignment . }
  OPTIONAL { ?party wdt:P1142 ?ideology . }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" . }
}
```

## Testing Queries

You can test SPARQL queries directly at:
https://query.wikidata.org/

### Test Query for Ukraine

```sparql
SELECT ?property ?propertyLabel ?value ?valueLabel WHERE {
  wd:Q212 ?p ?statement .
  ?property wikibase:claim ?p .
  ?statement ?ps ?value .

  FILTER(?property IN (wd:P6, wd:P35, wd:P194, wd:P1906))

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
```

### Test Query for Switzerland Federal Council

```sparql
SELECT ?member ?memberLabel ?party ?partyLabel ?alignment WHERE {
  wd:Q390551 wdt:P527 ?member .  # Q390551 = Swiss Federal Council
  OPTIONAL { ?member wdt:P102 ?party . }
  OPTIONAL { ?party wdt:P1387 ?alignment . }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
```

## Recommendations

1. **Short-term**: Add manual overrides for critical missing countries
2. **Medium-term**: Implement fallback query strategy with multiple approaches
3. **Long-term**: Contribute missing data to Wikidata to help future projects

## Next Steps

1. Test individual SPARQL queries for missing countries at query.wikidata.org
2. Identify which approach works best for each type of government system
3. Implement multi-strategy query with UNION clauses
4. Add better logging to see which strategy succeeded for each country
