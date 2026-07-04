/**
 * Append-only history snapshots (ROADMAP phase 3).
 *
 * data/history/YYYY-MM-DD.json — one snapshot per date, scored countries only.
 * Never rewritten once committed; the weekly pipeline appends a new file when
 * the data actually changed, the backfill script seeds historical dates.
 *
 * public/data/history.min.json — all snapshots aggregated for the frontend,
 * regenerated from data/history/ on every write.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const HISTORY_DIR = path.join(__dirname, "..", "..", "data", "history");
export const HISTORY_MIN_PATH = path.join(
  __dirname, "..", "..", "public", "data", "history.min.json"
);

export interface SnapshotCountry {
  score: number;
  status: string;
  party: string; // display name; coalitions comma-joined
  strategy?: string;
}

export interface Snapshot {
  date: string; // YYYY-MM-DD
  source: "live" | "backfill";
  countries: Record<string, SnapshotCountry>;
}

export function listSnapshotFiles(): string[] {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // date-named files sort chronologically
}

export function readSnapshot(file: string): Snapshot {
  return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), "utf8"));
}

export function writeSnapshot(snapshot: Snapshot): void {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const file = path.join(HISTORY_DIR, `${snapshot.date}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Append a live snapshot unless it is content-identical to the latest one on
 * disk (so unchanged weeks add no files — mirroring the workflow's "no
 * timestamp-only PRs" rule). Returns true if a file was written.
 */
export function appendSnapshotIfChanged(snapshot: Snapshot): boolean {
  const files = listSnapshotFiles();
  if (files.length > 0) {
    const latest = readSnapshot(files[files.length - 1]);
    if (JSON.stringify(latest.countries) === JSON.stringify(snapshot.countries)) {
      return false;
    }
  }
  writeSnapshot(snapshot);
  return true;
}

/** Compact form consumed by the frontend: iso3 → [score, status, party]. */
export function buildHistoryMin(): number {
  const snapshots = listSnapshotFiles().map((f) => {
    const snap = readSnapshot(f);
    return {
      date: snap.date,
      source: snap.source,
      countries: Object.fromEntries(
        Object.entries(snap.countries).map(([iso3, c]) => [
          iso3,
          [c.score, c.status, c.party],
        ])
      ),
    };
  });

  const out = { snapshots };
  fs.mkdirSync(dirname(HISTORY_MIN_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_MIN_PATH, JSON.stringify(out), "utf8");
  return snapshots.length;
}

/** Scored countries of a full pipeline result, in snapshot form. */
export function snapshotCountriesFrom(
  countries: Record<string, any>
): Record<string, SnapshotCountry> {
  const result: Record<string, SnapshotCountry> = {};
  for (const [iso3, data] of Object.entries(countries).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (typeof data.score !== "number") continue;
    const parties = (data.government?.parties ?? [])
      .map((p: any) => p.name)
      .filter(Boolean);
    result[iso3] = {
      score: data.score,
      status: data.status,
      party: parties.join(", ") || "Unknown party",
      strategy: data.sources?.strategy,
    };
  }
  return result;
}
