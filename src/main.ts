import * as d3 from "d3";
import { feature } from "topojson-client";

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

const UNKNOWN_FILL = "#999"; // keep distinct; your gradient fills are computed

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

function renderLegend(root: HTMLElement) {
  const legend = document.createElement("div");
  legend.style.position = "absolute";
  legend.style.left = "12px";
  legend.style.bottom = "12px";
  legend.style.padding = "8px 10px";
  legend.style.background = "rgba(255,255,255,0.9)";
  legend.style.borderRadius = "8px";
  legend.style.font = "12px system-ui, sans-serif";
  legend.style.pointerEvents = "none";
  legend.innerHTML = `
    <div style="margin-bottom:6px;">Leaning</div>
    <div style="display:flex; align-items:center; gap:8px;">
      <span>Left</span>
      <div style="width:140px; height:10px; border-radius:6px;
        background: linear-gradient(90deg, ${scoreToFill(-1)}, ${scoreToFill(0)}, ${scoreToFill(1)});
        border: 1px solid rgba(0,0,0,0.15);"></div>
      <span>Right</span>
    </div>
    <div style="margin-top:6px;">Unknown: <span style="display:inline-block;width:10px;height:10px;background:${UNKNOWN_FILL};border:1px solid rgba(0,0,0,0.15);vertical-align:middle;"></span></div>
  `;
  root.appendChild(legend);
}

function renderTooltip(root: HTMLElement) {
  const tip = document.createElement("div");
  tip.style.position = "absolute";
  tip.style.pointerEvents = "none";
  tip.style.padding = "8px 10px";
  tip.style.background = "rgba(0,0,0,0.75)";
  tip.style.color = "white";
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

function draw(root: HTMLElement, topo: TopologyLike, leanings: LeaningsFile) {
  const width = root.clientWidth;
  const height = root.clientHeight;

  const svg = d3
    .select(root)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block");

  const g = svg.append("g");

  const tooltip = renderTooltip(root);

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
      return typeof score === "number" ? scoreToFill(score) : UNKNOWN_FILL;
    })
    .attr("stroke", "rgba(0,0,0,0.35)")
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

  renderLegend(root);
}

(async () => {
  try {
    const root = ensureRoot();
    const { topo, leanings } = await loadData();
    draw(root, topo, leanings);
  } catch (error) {
    console.error("Failed to load or render map:", error);
    const root = document.getElementById("app");
    if (root) {
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;">
          <div style="text-align:center;padding:20px;">
            <h1>Error Loading Map</h1>
            <p>Failed to load map data. Please ensure data files are available.</p>
            <p style="color:#666;font-size:14px;">${error instanceof Error ? error.message : String(error)}</p>
          </div>
        </div>
      `;
    }
  }
})();
