import * as d3 from "d3";
import { feature } from "topojson-client";

type Theme = 'light' | 'dark';

interface ThemeColors {
  mapBackground: string;
  legendBackground: string;
  legendText: string;
  legendBorder: string;
  tooltipBackground: string;
  tooltipText: string;
  countryStroke: string;
  unknownFill: string;
  hatchStripe: string;
  unknownHatch: string;
  changeOutline: string;
  toggleBackground: string;
  toggleText: string;
}

const THEME_COLORS: Record<Theme, ThemeColors> = {
  light: {
    mapBackground: '#ffffff',
    legendBackground: 'rgba(255,255,255,0.9)',
    legendText: '#333333',
    legendBorder: 'rgba(0,0,0,0.15)',
    tooltipBackground: 'rgba(0,0,0,0.75)',
    tooltipText: '#ffffff',
    countryStroke: 'rgba(0,0,0,0.35)',
    unknownFill: '#999999',
    hatchStripe: 'rgba(255,255,255,0.65)',
    unknownHatch: 'rgba(255,255,255,0.5)',
    changeOutline: '#b8860b',
    toggleBackground: 'rgba(255,255,255,0.9)',
    toggleText: '#333333',
  },
  dark: {
    mapBackground: '#1a1a1a',
    legendBackground: 'rgba(40,40,50,0.9)',
    legendText: '#e0e0e0',
    legendBorder: 'rgba(255,255,255,0.2)',
    tooltipBackground: 'rgba(50,50,60,0.95)',
    tooltipText: '#e0e0e0',
    countryStroke: 'rgba(255,255,255,0.3)',
    unknownFill: '#666666',
    hatchStripe: 'rgba(26,26,26,0.65)',
    unknownHatch: 'rgba(26,26,26,0.55)',
    changeOutline: '#ffd24d',
    toggleBackground: 'rgba(40,40,50,0.9)',
    toggleText: '#ffffff',
  }
};

const ThemeManager = {
  currentTheme: 'light' as Theme,
  listeners: new Set<(theme: Theme) => void>(),

  initialize(): Theme {
    try {
      const saved = localStorage.getItem('swing-map-theme');
      if (saved === 'light' || saved === 'dark') {
        this.currentTheme = saved;
      } else {
        this.currentTheme = this.getSystemPreference();
      }
    } catch {
      this.currentTheme = this.getSystemPreference();
    }

    this.watchSystemPreference();
    return this.currentTheme;
  },

  getSystemPreference(): Theme {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  watchSystemPreference() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      try {
        if (!localStorage.getItem('swing-map-theme')) {
          this.setTheme(e.matches ? 'dark' : 'light', false);
        }
      } catch {
        // localStorage unavailable, ignore persistence
      }
    });
  },

  setTheme(theme: Theme, persist: boolean = true) {
    this.currentTheme = theme;
    if (persist) {
      try {
        localStorage.setItem('swing-map-theme', theme);
      } catch {
        console.warn('localStorage unavailable, theme won\'t persist');
      }
    }
    this.notifyListeners();
  },

  toggle() {
    this.setTheme(this.currentTheme === 'light' ? 'dark' : 'light');
  },

  subscribe(callback: (theme: Theme) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  },

  notifyListeners() {
    this.listeners.forEach(cb => cb(this.currentTheme));
  }
};

type LeaningEntry = {
  score: number | null; // null => unknown
  status: "ok" | "approx" | "unknown" | "disputed";
  name?: string;
  explanation?: string;
  strategy?: string; // sources.strategy from the pipeline; absent for overrides/no-data
};

const METHODOLOGY_URL = "https://github.com/Holek/swing-map/blob/main/docs/methodology.md";

const STRATEGY_LABELS: Record<string, string> = {
  head_of_government: "head of government's party",
  head_of_state: "head of state's party (fallback)",
  executive_member: "executive body members' parties",
};

const METHOD_LABELS: Record<string, string> = {
  "alignment": "party alignment data",
  "ideology-based": "ideology heuristic",
  "no alignment data": "no alignment data",
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  ok: { label: "OK", color: "#7ee0a3" },
  approx: { label: "Approximate", color: "#ffcf7d" },
  disputed: { label: "Disputed", color: "#ffcf7d" },
  unknown: { label: "No data", color: "#c9c9c9" },
};

type LeaningsFile = {
  updated_at: string;
  countries: Record<string, LeaningEntry>;
};

// history.min.json: compact per-snapshot entries, absent iso3 = no data
type CompactEntry = [number, string, string]; // score, status, party
type HistorySnapshot = {
  date: string;
  source: "live" | "backfill";
  countries: Record<string, CompactEntry>;
};
type HistoryFile = { snapshots: HistorySnapshot[] };

// Survives theme redraws so toggling doesn't reset the timeline
let selectedSnapshotIndex: number | null = null;

type TopologyLike = {
  objects: Record<string, any>;
  arcs: any;
  transform?: any;
};

function scoreToFill(score: number): string {
  // symmetric diverging scale [-1..+1]
  const t = (score + 1) / 2; // 0..1
  // pick your endpoints once; this is a simple interpolation in RGB
  const left = d3.rgb(40, 90, 200);
  const mid = d3.rgb(230, 230, 230);
  const right = d3.rgb(220, 60, 60);

  // piecewise: left->mid and mid->right
  return t < 0.5
    ? d3.interpolateRgb(left, mid)(t * 2)
    : d3.interpolateRgb(mid, right)((t - 0.5) * 2);
}

function iso3FromFeature(f: any): string | null {
  const p = f.properties || {};
  return (p.ISO_A3 || p.iso_a3 || p.ADM0_A3 || p.ISO3 || null) as string | null;
}

async function loadData(): Promise<{
  topo: TopologyLike;
  leanings: LeaningsFile;
  history: HistoryFile | null;
}> {
  const [topo, leanings, history] = await Promise.all([
    fetch(import.meta.env.BASE_URL + "data/countries.topo.json").then((r) => r.json()),
    fetch(import.meta.env.BASE_URL + "data/leanings.min.json").then((r) => r.json()),
    // History is optional — the map must keep working without it
    fetch(import.meta.env.BASE_URL + "data/history.min.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  return { topo, leanings, history };
}

function ensureRoot() {
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app");
  root.style.margin = "0";
  root.style.width = "100vw";
  root.style.height = "100vh";
  root.style.overflow = "hidden";
  return root;
}

function renderLegend(root: HTMLElement, theme: Theme, updatedAt: string) {
  const colors = THEME_COLORS[theme];
  const legend = document.createElement("div");
  legend.style.position = "absolute";
  legend.style.left = "12px";
  legend.style.bottom = "12px";
  legend.style.padding = "8px 10px";
  legend.style.background = colors.legendBackground;
  legend.style.borderRadius = "8px";
  legend.style.font = "12px system-ui, sans-serif";
  legend.style.color = colors.legendText;
  legend.style.pointerEvents = "none";

  const approxSwatch = `
    <svg width="14" height="12" style="flex:none;">
      <defs>
        <linearGradient id="legend-approx-grad">
          <stop offset="0%" stop-color="${scoreToFill(-1)}"/>
          <stop offset="50%" stop-color="${scoreToFill(0)}"/>
          <stop offset="100%" stop-color="${scoreToFill(1)}"/>
        </linearGradient>
        <pattern id="legend-approx-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="2.2" height="6" fill="${colors.hatchStripe}"/>
        </pattern>
      </defs>
      <rect width="14" height="12" fill="url(#legend-approx-grad)"/>
      <rect width="14" height="12" fill="url(#legend-approx-hatch)" stroke="${colors.legendBorder}"/>
    </svg>`;
  const unknownSwatch = `
    <svg width="14" height="12" style="flex:none;">
      <defs>
        <pattern id="legend-unknown-hatch" patternUnits="userSpaceOnUse" width="7" height="7">
          <rect width="7" height="7" fill="${colors.unknownFill}"/>
          <path d="M0,0 L7,7 M7,0 L0,7" stroke="${colors.unknownHatch}" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="14" height="12" fill="url(#legend-unknown-hatch)" stroke="${colors.legendBorder}"/>
    </svg>`;

  legend.innerHTML = `
    <div style="margin-bottom:6px;">Government leaning</div>
    <div style="display:flex; align-items:center; gap:8px;">
      <span>Left</span>
      <div style="width:140px; height:10px; border-radius:6px;
        background: linear-gradient(90deg, ${scoreToFill(-1)}, ${scoreToFill(0)}, ${scoreToFill(1)});
        border: 1px solid ${colors.legendBorder};"></div>
      <span>Right</span>
    </div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:6px;">${approxSwatch}<span>Approximate (weaker signals)</span></div>
    <div style="margin-top:4px;display:flex;align-items:center;gap:6px;">${unknownSwatch}<span>No data</span></div>
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid ${colors.legendBorder};opacity:0.9;">
      Updated ${updatedAt.slice(0, 10)} &middot;
      <a href="${METHODOLOGY_URL}" target="_blank" rel="noopener"
         style="color:${colors.legendText};pointer-events:auto;">Methodology</a>
    </div>
  `;
  root.appendChild(legend);
}

function renderTooltip(root: HTMLElement, theme: Theme) {
  const colors = THEME_COLORS[theme];
  const tip = document.createElement("div");
  tip.style.position = "absolute";
  tip.style.pointerEvents = "none";
  tip.style.padding = "8px 10px";
  tip.style.background = colors.tooltipBackground;
  tip.style.color = colors.tooltipText;
  tip.style.borderRadius = "8px";
  tip.style.font = "12px system-ui, sans-serif";
  tip.style.display = "none";
  root.appendChild(tip);
  return tip;
}

function positionTooltip(tip: HTMLDivElement, x: number, y: number) {
  tip.style.left = `${x + 12}px`;
  tip.style.top = `${y + 12}px`;
}

function scoreToBias(score: number): string {
  if (score <= -0.7) return "Far Left";
  if (score <= -0.3) return "Left";
  if (score <= -0.1) return "Center-Left";
  if (score <= 0.1) return "Center";
  if (score <= 0.3) return "Center-Right";
  if (score <= 0.7) return "Right";
  return "Far Right";
}

function extractPartyName(explanation: string): string {
  // Extract party name from "Party Name (method)" format
  const match = explanation.match(/^(.+?)\s*\(/);
  return match ? match[1] : explanation;
}

function extractMethod(explanation: string): string | null {
  // Extract method from the trailing "(...)" of "Party Name (method)"
  const match = explanation.match(/\(([^()]*)\)\s*$/);
  if (!match) return null;
  return METHOD_LABELS[match[1]] || match[1];
}

function statusChip(statusKey: string | undefined): string {
  const status = STATUS_META[statusKey ?? "unknown"] || STATUS_META.unknown;
  return `<span style="font-size:10px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:${status.color};border:1px solid ${status.color};border-radius:4px;padding:1px 5px;margin-left:8px;vertical-align:1px;">${status.label}</span>`;
}

const TOOLTIP_FOOTER_STYLE =
  "margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.25);opacity:0.75;font-size:11px;line-height:1.5;";

function tooltipHtml(countryName: string, entry: LeaningEntry | undefined, updatedAt: string): string {
  const header = `<div style="font-weight:600;margin-bottom:6px;font-size:14px;">${countryName}${statusChip(entry?.status)}</div>`;

  let body: string;
  if (entry && typeof entry.score === "number") {
    const partyName = entry.explanation ? extractPartyName(entry.explanation) : "Unknown party";
    body = `
      <div style="margin-bottom:3px;"><strong>Governing party:</strong> ${partyName}</div>
      <div><strong>Political leaning:</strong> ${scoreToBias(entry.score)}</div>`;
  } else {
    body = `<div style="opacity:0.85;">${entry?.explanation || "No political data available"}</div>`;
  }

  const strategyLabel = entry?.strategy ? STRATEGY_LABELS[entry.strategy] || entry.strategy : null;
  const method = entry?.explanation ? extractMethod(entry.explanation) : null;
  const provenance: string[] = [];
  if (strategyLabel) {
    provenance.push(`Source: ${strategyLabel}${method ? ` &middot; ${method}` : ""}`);
  } else if (method) {
    provenance.push(`Source: ${method}`);
  }
  provenance.push(`Wikidata snapshot: ${updatedAt.slice(0, 10)}`);

  const footer = `<div style="${TOOLTIP_FOOTER_STYLE}">${provenance.join("<br/>")}</div>`;
  return header + body + footer;
}

function snapshotTooltipHtml(
  countryName: string,
  c: CompactEntry | undefined,
  snap: HistorySnapshot
): string {
  const header = `<div style="font-weight:600;margin-bottom:6px;font-size:14px;">${countryName}${statusChip(c?.[1])}</div>`;
  const body = c
    ? `
      <div style="margin-bottom:3px;"><strong>Governing party:</strong> ${c[2]}</div>
      <div><strong>Political leaning:</strong> ${scoreToBias(c[0])}</div>`
    : `<div style="opacity:0.85;">No data for this snapshot</div>`;
  const sourceLine =
    snap.source === "backfill"
      ? "reconstructed from Wikidata office-holder records"
      : "weekly Wikidata snapshot";
  const footer = `<div style="${TOOLTIP_FOOTER_STYLE}">Snapshot: ${snap.date} &middot; ${sourceLine}</div>`;
  return header + body + footer;
}

type Change = {
  iso3: string;
  kind: "moved" | "new" | "lost";
  from?: CompactEntry;
  to?: CompactEntry;
  delta: number;
};

// Score or governing-party changes count; status flips alone (e.g. ok→approx
// between a backfilled and a live snapshot) are method artifacts, not swings
function computeChanges(prev: HistorySnapshot, cur: HistorySnapshot): Change[] {
  const changes: Change[] = [];
  const keys = new Set([...Object.keys(prev.countries), ...Object.keys(cur.countries)]);
  for (const iso3 of keys) {
    const from = prev.countries[iso3];
    const to = cur.countries[iso3];
    if (from && to) {
      const delta = to[0] - from[0];
      if (Math.abs(delta) > 0.001 || from[2] !== to[2]) {
        changes.push({ iso3, kind: "moved", from, to, delta });
      }
    } else if (to) {
      changes.push({ iso3, kind: "new", to, delta: 0 });
    } else if (from) {
      changes.push({ iso3, kind: "lost", from, delta: 0 });
    }
  }
  const rank = { moved: 0, new: 1, lost: 2 };
  return changes.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      Math.abs(b.delta) - Math.abs(a.delta) ||
      a.iso3.localeCompare(b.iso3)
  );
}

function renderKofiButton(root: HTMLElement) {
  const link = document.createElement("a");
  link.href = "https://ko-fi.com/B0B61SCHEQ";
  link.target = "_blank";
  link.style.position = "absolute";
  link.style.top = "12px";
  link.style.right = "64px";
  link.style.display = "block";
  link.style.lineHeight = "0";

  const img = document.createElement("img");
  img.src = "https://ko-fi.com/img/githubbutton_sm.svg";
  img.alt = "Support me on Ko-fi";
  img.style.height = "36px";
  img.style.border = "0";
  img.style.borderRadius = "4px";

  link.appendChild(img);
  root.appendChild(link);
}

function renderThemeToggle(root: HTMLElement) {
  const toggle = document.createElement("button");
  toggle.style.position = "absolute";
  toggle.style.top = "12px";
  toggle.style.right = "12px";
  toggle.style.width = "40px";
  toggle.style.height = "40px";
  toggle.style.padding = "0";
  toggle.style.border = "none";
  toggle.style.borderRadius = "50%";
  toggle.style.cursor = "pointer";
  toggle.style.fontSize = "20px";
  toggle.style.display = "flex";
  toggle.style.alignItems = "center";
  toggle.style.justifyContent = "center";
  toggle.style.transition = "all 0.3s ease";
  toggle.setAttribute("aria-label", "Toggle theme");

  const updateAppearance = (theme: Theme) => {
    const colors = THEME_COLORS[theme];
    if (theme === 'light') {
      toggle.innerHTML = "🌙";
      toggle.style.background = colors.toggleBackground;
      toggle.style.color = colors.toggleText;
    } else {
      toggle.innerHTML = "☀️";
      toggle.style.background = colors.toggleBackground;
      toggle.style.color = colors.toggleText;
    }
  };

  updateAppearance(ThemeManager.currentTheme);

  toggle.addEventListener("click", () => {
    ThemeManager.toggle();
  });

  ThemeManager.subscribe((theme) => {
    updateAppearance(theme);
  });

  root.appendChild(toggle);
}

function renderScrubber(
  root: HTMLElement,
  theme: Theme,
  snapshots: HistorySnapshot[]
): { slider: HTMLInputElement; update: (index: number, isLatest: boolean) => void } {
  const colors = THEME_COLORS[theme];
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "50%";
  container.style.transform = "translateX(-50%)";
  container.style.bottom = "12px";
  container.style.padding = "8px 12px";
  container.style.background = colors.legendBackground;
  container.style.borderRadius = "8px";
  container.style.font = "12px system-ui, sans-serif";
  container.style.color = colors.legendText;
  container.style.textAlign = "center";

  const label = document.createElement("div");
  label.style.fontWeight = "600";
  label.style.marginBottom = "4px";

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "8px";

  const minLabel = document.createElement("span");
  minLabel.textContent = snapshots[0].date.slice(0, 4);
  minLabel.style.opacity = "0.7";
  const maxLabel = document.createElement("span");
  maxLabel.textContent = snapshots[snapshots.length - 1].date.slice(0, 4);
  maxLabel.style.opacity = "0.7";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(snapshots.length - 1);
  slider.step = "1";
  slider.style.width = "min(320px, 40vw)";
  slider.style.cursor = "pointer";
  slider.setAttribute("aria-label", "Snapshot timeline");

  row.append(minLabel, slider, maxLabel);
  container.append(label, row);
  root.appendChild(container);

  const update = (index: number, isLatest: boolean) => {
    slider.value = String(index);
    const snap = snapshots[index];
    const suffix = isLatest
      ? " · latest"
      : snap.source === "backfill"
        ? " · reconstructed"
        : "";
    label.textContent = snap.date + suffix;
  };

  return { slider, update };
}

function renderChangePanel(
  root: HTMLElement,
  theme: Theme
): { update: (prevDate: string | null, changes: Change[], names: Map<string, string>) => void } {
  const colors = THEME_COLORS[theme];
  const panel = document.createElement("div");
  panel.style.position = "absolute";
  panel.style.left = "12px";
  panel.style.top = "12px";
  panel.style.maxWidth = "280px";
  panel.style.maxHeight = "45vh";
  panel.style.overflowY = "auto";
  panel.style.padding = "8px 10px";
  panel.style.background = colors.legendBackground;
  panel.style.borderRadius = "8px";
  panel.style.font = "12px system-ui, sans-serif";
  panel.style.color = colors.legendText;
  panel.style.display = "none";
  root.appendChild(panel);

  const MAX_LISTED = 30;

  const update = (prevDate: string | null, changes: Change[], names: Map<string, string>) => {
    if (!prevDate || changes.length === 0) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";

    const rows = changes.slice(0, MAX_LISTED).map((c) => {
      const name = names.get(c.iso3) || c.iso3;
      if (c.kind === "moved") {
        const partyChanged = c.from![2] !== c.to![2];
        const partyLine = partyChanged
          ? `<div style="opacity:0.65;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${c.from![2]} → ${c.to![2]}">${c.from![2]} → ${c.to![2]}</div>`
          : "";
        return `<div style="margin-top:4px;"><strong>${name}</strong> <span style="opacity:0.85;">${scoreToBias(c.from![0])} → ${scoreToBias(c.to![0])}</span>${partyLine}</div>`;
      }
      if (c.kind === "new") {
        return `<div style="margin-top:4px;"><strong>${name}</strong> <span style="opacity:0.85;">newly scored · ${scoreToBias(c.to![0])}</span></div>`;
      }
      return `<div style="margin-top:4px;opacity:0.6;"><strong>${name}</strong> no longer scored</div>`;
    });

    const more =
      changes.length > MAX_LISTED
        ? `<div style="margin-top:4px;opacity:0.6;">+${changes.length - MAX_LISTED} more</div>`
        : "";

    panel.innerHTML =
      `<div style="font-weight:600;margin-bottom:2px;">Changed since ${prevDate} (${changes.length})</div>` +
      rows.join("") +
      more;
  };

  return { update };
}

function draw(
  root: HTMLElement,
  topo: TopologyLike,
  leanings: LeaningsFile,
  history: HistoryFile | null,
  theme: Theme
) {
  const width = root.clientWidth;
  const height = root.clientHeight;

  const svg = d3
    .select(root)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block");

  const colors = THEME_COLORS[theme];

  svg.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", colors.mapBackground);

  const defs = svg.append("defs");
  // approx: 45° stripes in the background color, overlaid on the score fill
  defs.append("pattern")
    .attr("id", "approx-hatch")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6)
    .attr("height", 6)
    .attr("patternTransform", "rotate(45)")
    .append("rect")
    .attr("width", 2.2)
    .attr("height", 6)
    .attr("fill", colors.hatchStripe);
  // unknown: cross-hatch over neutral gray — texture, not just color, so it can't
  // be read as a score
  const unknownPattern = defs.append("pattern")
    .attr("id", "unknown-hatch")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 7)
    .attr("height", 7);
  unknownPattern.append("rect")
    .attr("width", 7)
    .attr("height", 7)
    .attr("fill", colors.unknownFill);
  unknownPattern.append("path")
    .attr("d", "M0,0 L7,7 M7,0 L0,7")
    .attr("stroke", colors.unknownHatch)
    .attr("stroke-width", 1);

  const g = svg.append("g");

  const tooltip = renderTooltip(root, theme);

  // Pick the first object if you don't know its name; better: standardize to "countries" in your pipeline.
  const objectKey = topo.objects["countries"] ? "countries" : Object.keys(topo.objects)[0];
  const geo = feature(topo as any, topo.objects[objectKey]) as any;

  const projection = d3.geoNaturalEarth1().fitSize([width, height], geo);
  const path = d3.geoPath(projection);

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 8])
    .on("zoom", (event) => g.attr("transform", event.transform));

  svg.call(zoom as any);

  // Sub-groups fix the paint order across re-joins: countries below,
  // non-interactive overlays above
  const countriesG = g.append("g");
  const approxG = g.append("g");
  const changedG = g.append("g");

  const snapshots = history?.snapshots ?? [];
  const lastIndex = snapshots.length - 1;
  let viewIndex = selectedSnapshotIndex ?? lastIndex;
  if (viewIndex < 0 || viewIndex > lastIndex) viewIndex = lastIndex;

  const isLatestView = () => lastIndex < 0 || viewIndex === lastIndex;

  const nameByIso3 = new Map<string, string>();
  for (const f of geo.features) {
    const iso3 = iso3FromFeature(f);
    const name = f.properties?.name || f.properties?.NAME || f.properties?.ADMIN;
    if (iso3 && name) nameByIso3.set(iso3, name);
  }

  const entryFor = (d: any): LeaningEntry | undefined => {
    const iso3 = iso3FromFeature(d);
    return iso3 ? leanings.countries[iso3] : undefined;
  };
  const compactFor = (d: any): CompactEntry | undefined => {
    const iso3 = iso3FromFeature(d);
    return iso3 ? snapshots[viewIndex]?.countries[iso3] : undefined;
  };

  const fillFor = (d: any): string => {
    if (isLatestView()) {
      const entry = entryFor(d);
      return typeof entry?.score === "number" ? scoreToFill(entry.score) : "url(#unknown-hatch)";
    }
    const c = compactFor(d);
    return c ? scoreToFill(c[0]) : "url(#unknown-hatch)";
  };

  // scored but not solid-confidence → hatch overlay
  const isApprox = (d: any): boolean => {
    if (isLatestView()) {
      const entry = entryFor(d);
      return !!entry && entry.status !== "ok" && typeof entry.score === "number";
    }
    const c = compactFor(d);
    return !!c && c[1] !== "ok";
  };

  countriesG
    .selectAll("path.country")
    .data(geo.features)
    .join("path")
    .attr("class", "country")
    .attr("d", path as any)
    .attr("stroke", colors.countryStroke)
    .attr("stroke-width", 0.5)
    .on("mousemove", (event: MouseEvent, d: any) => {
      tooltip.style.display = "block";
      positionTooltip(tooltip, event.clientX, event.clientY);

      const countryName = d.properties?.name || d.properties?.NAME || d.properties?.ADMIN || iso3FromFeature(d) || "Unknown";
      tooltip.innerHTML = isLatestView()
        ? tooltipHtml(countryName, entryFor(d), leanings.updated_at)
        : snapshotTooltipHtml(countryName, compactFor(d), snapshots[viewIndex]);
    })
    .on("mouseleave", () => {
      tooltip.style.display = "none";
    });

  const panel = renderChangePanel(root, theme);
  const scrubber = snapshots.length >= 2 ? renderScrubber(root, theme, snapshots) : null;

  let currentChanges: Change[] = [];

  const applyView = () => {
    currentChanges =
      viewIndex > 0 ? computeChanges(snapshots[viewIndex - 1], snapshots[viewIndex]) : [];

    countriesG.selectAll("path.country").attr("fill", fillFor as any);

    approxG
      .selectAll("path.approx-overlay")
      .data(geo.features.filter(isApprox))
      .join("path")
      .attr("class", "approx-overlay")
      .attr("d", path as any)
      .attr("fill", "url(#approx-hatch)")
      .attr("stroke", "none")
      .style("pointer-events", "none");

    // countries whose leaning moved (or newly appeared) since the previous
    // snapshot get an outline
    const changedSet = new Set(
      currentChanges.filter((c) => c.kind !== "lost").map((c) => c.iso3)
    );
    changedG
      .selectAll("path.changed-outline")
      .data(geo.features.filter((f: any) => {
        const iso3 = iso3FromFeature(f);
        return iso3 && changedSet.has(iso3);
      }))
      .join("path")
      .attr("class", "changed-outline")
      .attr("d", path as any)
      .attr("fill", "none")
      .attr("stroke", colors.changeOutline)
      .attr("stroke-width", 1.2)
      .style("pointer-events", "none");

    panel.update(
      viewIndex > 0 ? snapshots[viewIndex - 1].date : null,
      currentChanges,
      nameByIso3
    );
    if (scrubber) scrubber.update(viewIndex, isLatestView());
  };

  if (scrubber) {
    scrubber.slider.addEventListener("input", () => {
      viewIndex = parseInt(scrubber.slider.value, 10);
      selectedSnapshotIndex = viewIndex;
      applyView();
    });
  }

  applyView();

  renderLegend(root, theme, leanings.updated_at);
}

function redrawWithTheme(
  root: HTMLElement,
  topo: TopologyLike,
  leanings: LeaningsFile,
  history: HistoryFile | null,
  theme: Theme
) {
  root.innerHTML = '';
  root.style.margin = "0";
  root.style.width = "100vw";
  root.style.height = "100vh";
  root.style.overflow = "hidden";
  draw(root, topo, leanings, history, theme);
  renderKofiButton(root);
  renderThemeToggle(root);
}

(async () => {
  try {
    const root = ensureRoot();
    const { topo, leanings, history } = await loadData();

    const initialTheme = ThemeManager.initialize();
    draw(root, topo, leanings, history, initialTheme);
    renderKofiButton(root);
    renderThemeToggle(root);

    ThemeManager.subscribe((newTheme) => {
      redrawWithTheme(root, topo, leanings, history, newTheme);
    });

  } catch (error) {
    console.error("Failed to load or render map:", error);
    const root = document.getElementById("app");
    if (root) {
      const theme = ThemeManager.currentTheme;
      const colors = THEME_COLORS[theme];
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;background:${colors.mapBackground};color:${colors.legendText};">
          <div style="text-align:center;padding:20px;">
            <h1>Error Loading Map</h1>
            <p>Failed to load map data. Please ensure data files are available.</p>
            <p style="opacity:0.6;font-size:14px;">${error instanceof Error ? error.message : String(error)}</p>
          </div>
        </div>
      `;
    }
  }
})();
