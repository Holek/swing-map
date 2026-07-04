/**
 * Party scoring shared by the fetch and backfill scripts: alignment QIDs map
 * to scores directly; ideology labels go through conservative heuristics.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { extractQID } from "./wdqs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const alignmentMapping: Record<string, any> = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "mappings/alignment.yaml"), "utf8")
) as any;

const ideologyMappingData: any = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "mappings/ideology.yaml"), "utf8")
);

const ideologyRules = ideologyMappingData.ideology_label_rules;

export function scoreFromAlignment(alignmentQID: string): number | null {
  const mapping = alignmentMapping.alignment_qid_to_score;
  return mapping[alignmentQID] ?? null;
}

export function scoreFromIdeologyLabel(label: string): number | null {
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

export function computePartyScore(
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
