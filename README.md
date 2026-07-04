# FPV Tools

Browser-based utilities for Betaflight configuration and FPV drone setup. All tools run entirely in your browser — no account, no server-side processing, no data collection.

## Tools

### 🔀 CLI Merge
**Path:** `./cli-merge/`

Compare two Betaflight CLI dumps side-by-side and generate a merged output. Useful for:
- Merging settings from two different configurations
- Comparing tune changes across revisions
- Extracting specific sections from full dumps

Inputs accept pasted text, a file picker, or drag-and-drop from your desktop. The tool follows an **A = base / B = import** convention, detects the Betaflight version in each dump's header, and validates the merged output (unknown keys, duplicates, malformed lines, missing `save`) using A's firmware version as the target.

### 📈 Rate Profile Comparison
**Path:** `./rate-profile/`

Compare two Betaflight Actual Rates profiles with real-time visualization. Features:
- **Dual profile editor** — adjust roll, pitch, yaw, throttle on two profiles simultaneously
- **Throttle limit** — Off/Scale/Clip mode plus a 25-100% limit slider, matching Betaflight's `throttle_limit_*` settings
- **Live graphs** — see rate curves and throttle response update instantly
- **Collapsible graph panels** — hide individual graphs; the state is remembered between visits
- **Overlay or side-by-side view** — choose how you compare
- **Profile history** — save, name, and load profiles from browser localStorage
- **CLI import/export** — paste Betaflight dumps to load settings; copy CLI commands back
- **Visibility toggles** — focus on specific profiles or axes
- **Mobile-responsive** — works on tablet and phone

## Getting Started

1. **Open fpv-tools in your browser:** https://cori.github.io/fpv-tools/
2. **Pick a tool** from the hub
3. **Use it** — everything happens in your browser

## Development

### Adding a New Tool

1. Create a new directory: `your-tool/`
2. Include `index.html` as the entry point (can reference `your-tool/src/` modules if needed)
3. Add a card to the hub in the main `index.html`
4. Commit and push — GitHub Pages will deploy automatically

### Tech Stack

- **Vanilla HTML/CSS/JS** — no frameworks, no build step
- **ES6 modules** — for clean code organization
- **HTML5 Canvas** — for graphs and visualizations
- **localStorage** — for client-side data persistence
- **Mobile-responsive CSS** — flexbox/grid, media queries

### Style Guide

- Dark theme (GitHub-inspired colors)
- Orange accent color (`#e07b39`) for key UI elements
- Card-based layout for tools
- Monospace fonts for technical content (CLI, values)

### Testing

Some tools include unit tests. Run with:
```bash
npm test
```

## Architecture

```
fpv-tools/
├── index.html              # Hub page with tool links
├── styles.css              # Shared theme (optional per-tool overrides OK)
├── cli-merge/
│   └── index.html          # CLI Merge tool
├── rate-profile/
│   ├── index.html          # Rate Profile tool
│   ├── styles.css          # Tool-specific styles
│   └── src/
│       ├── app.js          # Main controller
│       ├── rate-calculator.js
│       ├── cli-parser.js
│       ├── graph-renderer.js
│       └── profile-manager.js
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Pages auto-deploy on push
```

## License

MIT
