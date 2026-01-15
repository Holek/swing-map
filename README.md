# Political Leanings Map

An interactive world map visualizing the political leaning of national governments on a left-right spectrum, powered by open data from Wikidata.

**[View Live Demo](#)** *(Update after deployment)*

## Features

- Interactive world map with pan and zoom
- Countries colored by government political leaning (-1.0 left to +1.0 right)
- Hover tooltips with:
  - Country name
  - Leaning score
  - Governing party/coalition information
  - Data confidence level (ok/approx/unknown)
  - Last updated timestamp
- Automated weekly data updates from Wikidata
- Fully static - no backend, no database, runs on GitHub Pages
- Transparent methodology with manual override capability

## Technology Stack

- **Frontend**: Vite + TypeScript + D3.js
- **Data**: Wikidata SPARQL queries
- **Boundaries**: World Atlas TopoJSON (OSM-derived)
- **Hosting**: GitHub Pages
- **CI/CD**: GitHub Actions

## Local Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/swing-map.git
cd swing-map

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The app will be available at `http://localhost:5173`

## Data Pipeline

### Fetching Latest Data

To update political leaning data from Wikidata:

```bash
npx tsx scripts/fetch_wikidata.ts
```

This will:
1. Query Wikidata SPARQL endpoint for current governments
2. Extract head of government and their party affiliations
3. Compute political leaning scores using alignment/ideology data
4. Generate `data/leanings.yaml` (full data) and `public/data/leanings.min.json` (compact for frontend)

### Automated Updates

The repository includes a GitHub Actions workflow (`.github/workflows/update-data.yml`) that:
- Runs weekly on Mondays at 00:00 UTC
- Can be manually triggered from the Actions tab
- Fetches latest data from Wikidata
- Creates a pull request if changes are detected
- Allows manual review before merging

### Manual Overrides

For edge cases or recent changes not yet in Wikidata, edit `data/overrides.yaml`:

```yaml
countries:
  USA:
    score: 0.6
    status: "ok"
    government:
      parties:
        - name: "Custom Party"
          position_score: 0.6
          weight: 1.0
      explanation: "Manual override explanation"
```

Re-run the data fetch script to merge overrides into the output.

## Methodology

Political leaning scores are computed from Wikidata using:

1. **Head of Government** → **Political Party** → **Political Alignment/Ideology**
2. Conservative mappings for alignment (P1387) and ideology (P1142)
3. Scale: -1.0 (far-left) to +1.0 (far-right), 0 = center
4. Status flags: `ok` (high confidence), `approx` (inferred), `unknown` (no data)

See [docs/methodology.md](docs/methodology.md) for detailed explanation of:
- SPARQL queries used
- Alignment and ideology score mappings
- Edge case handling
- Known limitations

## Project Structure

```
swing-map/
├── public/
│   └── data/
│       ├── countries.topo.json      # World boundaries (TopoJSON)
│       └── leanings.min.json        # Political data (compact JSON)
├── src/
│   └── main.ts                      # Frontend application
├── data/
│   ├── leanings.yaml                # Full political data (YAML)
│   └── overrides.yaml               # Manual overrides
├── scripts/
│   ├── fetch_wikidata.ts            # Data pipeline script
│   └── mappings/
│       ├── alignment.yaml           # Alignment QID → score mapping
│       └── ideology.yaml            # Ideology label → score mapping
├── docs/
│   └── methodology.md               # Detailed methodology
└── .github/workflows/
    ├── deploy.yml                   # GitHub Pages deployment
    └── update-data.yml              # Automated data updates
```

## Deployment

### GitHub Pages Setup

1. Push to GitHub:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/swing-map.git
   git push -u origin main
   ```

2. Enable GitHub Pages:
   - Go to repository Settings → Pages
   - Source: "GitHub Actions"

3. Update `vite.config.ts` with your repo name:
   ```typescript
   export default defineConfig({
     base: "/YOUR_REPO_NAME/",
   });
   ```

4. Push changes - deployment happens automatically via `.github/workflows/deploy.yml`

The site will be available at `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

## Configuration

### Changing Base Path

If deploying to a different path, update `vite.config.ts`:

```typescript
export default defineConfig({
  base: "/your-path/",
});
```

### Changing Update Frequency

Edit `.github/workflows/update-data.yml`:

```yaml
schedule:
  - cron: '0 0 * * 1'  # Weekly on Mondays
  # Change to '0 0 1 * *' for monthly, etc.
```

## Known Limitations

1. **Left-right spectrum is oversimplified**: Political positions are multidimensional; single axis can't capture everything
2. **Western-centric framework**: May not apply well to all political systems globally
3. **Wikidata coverage varies**: Some countries have better data quality than others
4. **Coalition complexity**: Currently uses head of government party only, not full coalition weighting
5. **Temporal lag**: Wikidata updates are volunteer-driven and may lag real-world events

See [docs/methodology.md](docs/methodology.md) for detailed discussion of limitations.

## Future Enhancements

- **Time travel**: Store historical snapshots for temporal visualization
- **Confidence layer**: Visual opacity based on data confidence
- **Coalition weighting**: Proper multi-party coalition handling with seat shares
- **Search functionality**: Find countries by name
- **Additional dimensions**: Authoritarian-libertarian axis
- **Direct Wikidata links**: Clickable provenance in tooltips

## Contributing

Contributions welcome! Areas of interest:

1. **Data quality improvements**: Better SPARQL queries, more robust party detection
2. **UI enhancements**: Search, filters, better tooltips
3. **Methodology refinements**: Improved scoring algorithms
4. **Documentation**: Translations, examples, use cases

Please open an issue to discuss major changes before submitting PRs.

## License

MIT License - see LICENSE file for details

## Data Sources

- **Political data**: [Wikidata](https://www.wikidata.org/) (CC0 1.0 Universal)
- **Country boundaries**: [World Atlas](https://github.com/topojson/world-atlas) (ISC License, derived from OpenStreetMap)

## Acknowledgments

- Wikidata community for maintaining open political data
- OpenStreetMap contributors for boundary data
- D3.js and TopoJSON for excellent mapping libraries

## Disclaimer

This project is for educational and informational purposes. Political positions are complex and multifaceted; this visualization is a simplified approximation. Scores reflect stated party positions in Wikidata, not policy outcomes or public opinion.

---

Built with [Vite](https://vitejs.dev/) + [D3.js](https://d3js.org/) + [Wikidata](https://www.wikidata.org/)
