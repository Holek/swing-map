# Contributing to Political Leanings Map

Thank you for considering contributing to this project! Here are some guidelines to help you get started.

## Code of Conduct

Be respectful, constructive, and professional. This is an educational project with inherent political subject matter - please keep discussions focused on data quality and technical improvements.

## How to Contribute

### Reporting Issues

- Check if the issue already exists before creating a new one
- Provide clear reproduction steps for bugs
- Include browser/OS information for frontend issues
- For data quality issues, provide:
  - Country ISO3 code
  - Expected vs. actual score
  - Wikidata source links if available

### Suggesting Enhancements

- Open an issue describing the enhancement
- Explain the use case and value
- Consider implementation complexity vs. benefit
- Be open to discussion about approach

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Test locally: `npm run build` and `npm run dev`
5. Commit with clear messages
6. Push to your fork
7. Open a pull request with:
   - Clear description of changes
   - Reference to related issue (if any)
   - Screenshots for UI changes
   - Explanation of testing performed

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/swing-map.git
cd swing-map

# Install dependencies
npm install

# Run dev server
npm run dev

# Test data pipeline
npm run fetch-data

# Build for production
npm run build
```

## Areas for Contribution

### 1. Data Quality

**Priority: High**

- Improve SPARQL queries to better detect coalitions
- Add seat-share weighting for coalition governments
- Handle edge cases (presidential systems, recent elections, etc.)
- Enhance alignment/ideology mappings

**Skills needed**: SPARQL, political science knowledge, Wikidata editing

### 2. Frontend Improvements

**Priority: Medium**

- Add country search functionality
- Improve mobile responsiveness
- Add keyboard navigation
- Enhance accessibility (ARIA labels, screen readers)
- Add loading states and error handling

**Skills needed**: TypeScript, D3.js, CSS, accessibility

### 3. Visualization Features

**Priority: Medium**

- Time travel: show historical data with timeline slider
- Confidence layer: visual opacity based on data status
- Alternative map projections
- Export functionality (PNG, CSV)
- Comparison mode (side-by-side time periods)

**Skills needed**: TypeScript, D3.js, data visualization

### 4. Data Pipeline

**Priority: Low-Medium**

- Automated boundary updates (new OSM extracts)
- ISO code reconciliation improvements
- Data validation and quality checks
- Generate join report (boundaries vs. leaning data)

**Skills needed**: TypeScript/Node.js, GIS, data processing

### 5. Documentation

**Priority: Ongoing**

- Methodology improvements
- Translation to other languages
- Use case examples
- Video tutorials
- API documentation (if we add one)

**Skills needed**: Technical writing, political science

## Coding Standards

- **TypeScript**: Use strict mode, avoid `any` where possible
- **Formatting**: Project uses default TypeScript/Prettier conventions
- **Naming**: Use descriptive variable names, prefer clarity over brevity
- **Comments**: Explain *why*, not *what* (code should be self-documenting)
- **Commits**: Use conventional commits format when possible
  - `feat: add search functionality`
  - `fix: correct Germany coalition scoring`
  - `docs: update methodology for ideology mapping`

## Testing

Currently, the project has minimal automated testing. Contributions to add:
- Unit tests for scoring functions
- Integration tests for data pipeline
- E2E tests for map rendering
- Visual regression tests

...would be very welcome!

## Data Updates

The project uses automated weekly data updates via GitHub Actions. When contributing data-related changes:

1. Test locally first: `npm run fetch-data`
2. Review generated `data/leanings.yaml` for sanity
3. Check `public/data/leanings.min.json` is valid JSON
4. Consider whether overrides in `data/overrides.yaml` are needed

## Methodology Changes

Changes to the scoring methodology should:

1. Be discussed in an issue first
2. Update `docs/methodology.md` with rationale
3. Update mapping files (`scripts/mappings/*.yaml`)
4. Consider backward compatibility (or document breaking changes)
5. Re-generate all data and commit changes

## Questions?

- Open an issue with the "question" label
- Tag relevant maintainers
- Be patient - this is a volunteer project

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
