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
};

type LeaningsFile = {
  updated_at: string;
  countries: Record<string, LeaningEntry>;
};

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

async function loadData(): Promise<{ topo: TopologyLike; leanings: LeaningsFile }> {
  const [topo, leanings] = await Promise.all([
    fetch(import.meta.env.BASE_URL + "data/countries.topo.json").then((r) => r.json()),
    fetch(import.meta.env.BASE_URL + "data/leanings.min.json").then((r) => r.json()),
  ]);
  return { topo, leanings };
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

function renderLegend(root: HTMLElement, theme: Theme) {
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
  legend.innerHTML = `
    <div style="margin-bottom:6px;">Leaning</div>
    <div style="display:flex; align-items:center; gap:8px;">
      <span>Left</span>
      <div style="width:140px; height:10px; border-radius:6px;
        background: linear-gradient(90deg, ${scoreToFill(-1)}, ${scoreToFill(0)}, ${scoreToFill(1)});
        border: 1px solid ${colors.legendBorder};"></div>
      <span>Right</span>
    </div>
    <div style="margin-top:6px;">Unknown: <span style="display:inline-block;width:10px;height:10px;background:${colors.unknownFill};border:1px solid ${colors.legendBorder};vertical-align:middle;"></span></div>
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

function draw(root: HTMLElement, topo: TopologyLike, leanings: LeaningsFile, theme: Theme) {
  const width = root.clientWidth;
  const height = root.clientHeight;

  const svg = d3
    .select(root)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block");

  svg.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", THEME_COLORS[theme].mapBackground);

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

  g.selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("d", path as any)
    .attr("fill", (d: any) => {
      const iso3 = iso3FromFeature(d);
      const entry = iso3 ? leanings.countries[iso3] : undefined;
      const score = entry?.score;
      return typeof score === "number" ? scoreToFill(score) : THEME_COLORS[theme].unknownFill;
    })
    .attr("stroke", THEME_COLORS[theme].countryStroke)
    .attr("stroke-width", 0.5)
    .on("mousemove", (event: MouseEvent, d: any) => {
      const iso3 = iso3FromFeature(d);
      const entry = iso3 ? leanings.countries[iso3] : undefined;

      tooltip.style.display = "block";
      positionTooltip(tooltip, event.clientX, event.clientY);

      const name = entry?.name || d.properties?.NAME || d.properties?.ADMIN || iso3 || "Unknown";
      const scoreStr =
        typeof entry?.score === "number" ? entry.score.toFixed(2) : "unknown";
      const status = entry?.status || "unknown";
      const explanation = entry?.explanation || "No details available";

      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;">${name}</div>
        <div>Score: ${scoreStr} (${status})</div>
        <div style="opacity:0.8;margin-top:4px;max-width:300px;">${explanation}</div>
        <div style="opacity:0.6;margin-top:4px;font-size:10px;">Updated: ${leanings.updated_at}</div>
      `;
    })
    .on("mouseleave", () => {
      tooltip.style.display = "none";
    });

  renderLegend(root, theme);
}

function redrawWithTheme(root: HTMLElement, topo: TopologyLike, leanings: LeaningsFile, theme: Theme) {
  root.innerHTML = '';
  root.style.margin = "0";
  root.style.width = "100vw";
  root.style.height = "100vh";
  root.style.overflow = "hidden";
  draw(root, topo, leanings, theme);
  renderThemeToggle(root);
}

(async () => {
  try {
    const root = ensureRoot();
    const { topo, leanings } = await loadData();

    const initialTheme = ThemeManager.initialize();
    draw(root, topo, leanings, initialTheme);
    renderThemeToggle(root);

    ThemeManager.subscribe((newTheme) => {
      redrawWithTheme(root, topo, leanings, newTheme);
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
