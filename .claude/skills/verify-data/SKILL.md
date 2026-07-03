---
name: verify-data
description: Verify regenerated political-leaning data before committing. Use after running `npm run fetch-data`, or whenever data/leanings.yaml, public/data/leanings.min.json, or scripts/fetch_wikidata.ts changed, to catch coverage regressions and implausible score swings.
---

# Verify data

Data regenerations must be checked against the last committed version before they are
committed. A query bug typically shows up as one of: coverage collapse (more `unknown`),
mass score flips, or scores sourced from the wrong entity (former party, ceremonial head
of state).

## Checks

Run the comparison script below, then apply these judgments:

1. **Coverage** — baseline as of 2026-07 (post phase 1): **96 ok / 26 approx /
   76 unknown** of 198. Coverage should stay flat or improve. More than ~5 countries
   dropping out of `ok` or into `unknown` is a regression: find out why before
   committing. (An `unknown` caused by correctly rejecting a stale statement is fine —
   the point is that every drop must be explainable.)
2. **Swings** — per-country score change `|Δ| > 0.5` must be individually explainable
   (an actual election/government change, an override, a mapping fix). One or two
   explainable swings are normal; many at once means the query changed semantics.
3. **Explanation sanity** — for flagged countries, check the `explanation` field names
   the party that actually governs (not a former party of the leader, not the
   president's party in a parliamentary system).
4. **Structural** — all scores `null` or within [-1, 1]; every status in
   `{ok, approx, unknown, disputed}`; country count must not shrink; the ISO3 key sets
   of `data/leanings.yaml` and `public/data/leanings.min.json` must match.

## Comparison script

```bash
node -e '
const { execSync } = require("child_process");
const fs = require("fs");
const cur = JSON.parse(fs.readFileSync("public/data/leanings.min.json", "utf8"));
const old = JSON.parse(execSync("git show HEAD:public/data/leanings.min.json", { maxBuffer: 1e8 }).toString());
const stat = (d) => Object.values(d.countries).reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
console.log("old:", stat(old), Object.keys(old.countries).length, "countries");
console.log("new:", stat(cur), Object.keys(cur.countries).length, "countries");
const bad = [];
for (const [iso, c] of Object.entries(cur.countries)) {
  if (c.score !== null && (typeof c.score !== "number" || c.score < -1 || c.score > 1)) bad.push([iso, "score out of range", c.score]);
  if (!["ok", "approx", "unknown", "disputed"].includes(c.status)) bad.push([iso, "bad status", c.status]);
  const o = old.countries[iso];
  if (o && typeof o.score === "number" && typeof c.score === "number" && Math.abs(o.score - c.score) > 0.5)
    bad.push([iso, `swing ${o.score.toFixed(2)} -> ${c.score.toFixed(2)}`, `${o.explanation} => ${c.explanation}`]);
  if (o && typeof o.score === "number" && c.score === null) bad.push([iso, "lost score", o.explanation]);
}
for (const iso of Object.keys(old.countries)) if (!cur.countries[iso]) bad.push([iso, "country disappeared"]);
console.log(bad.length ? bad.map(b => b.join(" | ")).join("\n") : "no flags");
'
```

Also confirm YAML/JSON key parity:

```bash
node -e '
const yaml = require("js-yaml"), fs = require("fs");
const y = Object.keys(yaml.load(fs.readFileSync("data/leanings.yaml", "utf8")).countries).sort();
const j = Object.keys(JSON.parse(fs.readFileSync("public/data/leanings.min.json", "utf8")).countries).sort();
console.log(JSON.stringify(y) === JSON.stringify(j) ? "keys match" : "MISMATCH: " + y.filter(k => !j.includes(k)).concat(j.filter(k => !y.includes(k))).join(","));
'
```

## Verdict

Report the coverage delta and every flagged country with its explanation change. Only
call the data good if every flag is individually explained. If flags trace back to query
semantics (e.g. missing temporal qualifiers — see the **wikidata-pipeline** skill), fix
the query rather than overriding countries one by one.
