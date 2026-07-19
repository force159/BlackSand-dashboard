# CLAUDE.md — BlackSand Executive Leasing Dashboard

> **Purpose of this file.** This is the permanent engineering and design memory for the BlackSand
> leasing dashboard. It documents the architecture, design philosophy, coding standards, constraints,
> and future direction of the project so that **any future Claude session (or engineer) can continue
> development with minimal additional explanation**. Read this file in full before making changes.
>
> This is **not** a generic README. It is the source of truth for *how* and *why* this dashboard is built.

> **⚠️ THIS PROJECT IS VERSION 2 (the 3D-centrepiece experiment).** The production Version 1 lives
> elsewhere and must not be recreated here. In V2, the occupancy donut has been replaced by a **Three.js
> 3D occupancy centrepiece**, the layout is the **"Central Spine"** frame, the KPIs are redistributed, and
> the whole canvas is **proportionally scaled** to any 16:9 display. Sections 1–20 below describe the
> shared foundations; **[Section 21](#21-version-2--3d-centrepiece-redesign) documents everything V2
> changed** and overrides any V1-specific detail (e.g. the "Occupancy donut" in §8). Read §21 first.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Design Philosophy](#2-design-philosophy)
3. [Brand Guidelines](#3-brand-guidelines)
4. [Technology Stack](#4-technology-stack)
5. [Project Structure](#5-project-structure)
6. [Dashboard Architecture](#6-dashboard-architecture)
7. [Data Model](#7-data-model)
8. [Component Documentation](#8-component-documentation)
9. [Three.js Architecture](#9-threejs-architecture)
10. [Chart.js Standards](#10-chartjs-standards)
11. [Styling System](#11-styling-system)
12. [Animation Philosophy](#12-animation-philosophy)
13. [Performance Goals](#13-performance-goals)
14. [TV Optimisation](#14-tv-optimisation)
15. [Accessibility](#15-accessibility)
16. [Future Roadmap](#16-future-roadmap)
17. [Critical System Rules (Do Not Break)](#17-critical-system-rules-do-not-break)
18. [Coding Standards](#18-coding-standards)
19. [AI Contribution Guidelines](#19-ai-contribution-guidelines)
20. [Project Vision](#20-project-vision)

---

## 1. PROJECT OVERVIEW

### What this is
A single-screen, **executive commercial real estate leasing dashboard for BlackSand**. It presents the
leasing performance of a property portfolio — occupancy, leased area, KPIs, leasing velocity, trend
indicators, top tenants, and a searchable tenant directory — on one always-on display, per property project.

### Who it is for
- **Primary audience:** BlackSand executives and leasing/asset managers viewing the dashboard on **large
  office displays / 4K TVs** at a distance, typically as an always-on "situation board."
- **Secondary audience:** internal stakeholders reviewing the same view on desktop.

The dashboard is designed to be **glanceable** — the most important numbers must be legible across a room,
with zero interaction required.

### Why it exists
To give leadership an at-a-glance, high-confidence read on portfolio leasing health, in a form that looks
and feels like premium enterprise software befitting a luxury commercial real estate brand.

### Current project scope
- **Front-end only.** No backend, no database, no build step. It runs by opening one HTML file.
- All data is currently **hardcoded inline** in the dashboard file, structured to be swapped for a live feed.
- Two projects are modelled today: **Business Address** (default) and **Town Center**.
- The codebase is explicitly **"Monday.com-ready"**: mock values (lease dates, performance deltas) are
  isolated so they can be replaced by a real Monday.com integration without touching the render layer.

---

## 2. DESIGN PHILOSOPHY

This dashboard is **not** a futuristic demo. It is an executive tool for a luxury commercial real estate company.

### It must always feel
- **Premium** — considered, expensive, quiet confidence.
- **Architectural** — structured, gridded, deliberate.
- **Executive** — serious, trustworthy, boardroom-appropriate.
- **Understated** — nothing shouts; the data leads.
- **Engineered** — precise spacing, aligned baselines, tabular numerals.
- **Minimal** — only what serves the reader.
- **High-end commercial real estate** — think a private bank or a top-tier property fund, not a startup.

### It must always avoid
- Cyberpunk / gaming UI
- Crypto-dashboard aesthetics
- Excessive glassmorphism
- Neon glow
- Flashy or distracting animation
- The "AI-generated" look (rainbow gradients, random glows, gratuitous 3D)
- Clutter and visual noise

### The single overriding rule
> **Readability and data clarity always come before visual effects.**

If a visual effect competes with the data for attention, the effect loses. 3D and motion are permitted
**only where they improve hierarchy or communicate meaning**, never as decoration.

---

## 3. BRAND GUIDELINES

The BlackSand identity is implemented today as CSS custom properties in the `:root` of
`Project Dashboard.html`. New components must inherit these tokens rather than introduce new values.

### Typography
- **Typeface:** `Hanken Grotesk` (Google Fonts, weights 300–900), with `Arial, system-ui, -apple-system, sans-serif` fallbacks.
- **Numerals:** `font-variant-numeric: tabular-nums` on every metric so digits align and don't jump.
- **Case & tracking:** section labels and KPI labels are **UPPERCASE** with wide `letter-spacing` (1–2px);
  large values are tight (`letter-spacing: -0.5px`).
- **Weights:** 600 for values and headings, 500 for body, 700 reserved for active/emphasis states.

### Colour palette (canonical tokens)

> **⚠️ Palette direction (current).** The dashboard is **charcoal / graphite neutrals + a restrained,
> muted PURPLE accent** — deliberately warm-neutral, **NOT blue**. Every dark has `R ≥ B` and the greys
> carry a faint purple undertone, so the interface reads as graphite with a premium purple accent rather
> than a cool blue dashboard. **Teal (Pantone 317 C `#afdfe1`) has been retired as the working highlight**
> — purple now leads. Do **not** reintroduce teal or Tailwind-slate blues (`#94a3b8` / `#64748b` / `#1f2a3a`
> etc.). The reference is the official site (blacksand.sa): charcoal with a muted-purple accent.

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#0d0c10` | Charcoal — primary background (neutral, faint purple) |
| `--surface` | `#17151b` | Graphite card / panel surface |
| `--surface-h` | `#1e1c24` | Hover surface |
| `--border` | `#2b2833` | Graphite grid line / card border |
| `--hairline` | `#201e27` | Internal section separator |
| `--accent` | `#8764AB` | **Brand purple (Pantone 265 C)** — the primary accent; brand marks/diamond + the Offices bar |
| `--accent-hi` | `#b9a6d9` | **Light muted lilac** — the single data-highlight ink (Overall Leased %, KPIs, progress, positive trend, active tab, 3D leased arc) |
| `--accent-lo` | `rgba(135,100,171,0.08)` | Faint purple wash |
| `--accent-md` | `rgba(135,100,171,0.28)` | Purple border tint |
| `--grey` | `#7C868E` | Pantone 430 C (neutral) |
| `--grey-lo` | `#B2B5B9` | Pantone 4274 C |
| `--coral` | `#EA6753` | Pantone 7416 C — warnings / vacancy / negative trend only |
| `--white` / `--white-70` / `--white-50` / `--white-30` | `#fff` / `#d8d6dc` / `#9a969f` / `#6f6b75` | Text hierarchy (bright → muted), warm-neutral greys — **not** slate blue |

**Colour discipline (important):**
- **Purple is the single highlight family for data.** The light lilac `--accent-hi` (`#b9a6d9`) carries
  Overall Leased %, KPI emphasis, progress fills, positive trends, the active tab, and the 3D leased arc;
  the medium brand purple `--accent` (`#8764AB`) is the brand mark / diamond and the "Offices" bar. Two
  tones of one purple family — never a second accent hue.
- **Most of the interface stays neutral** (charcoal / graphite / grey). Purple is the *accent*, applied only
  to key data — not everywhere. Keep the neutral bulk dominant.
- **No blue.** No teal, no ice-blue, no Tailwind-slate greys, no blue-black surfaces or blue-tinted shadows.
  Shadows are neutral black only.
- **Coral (`--coral`) means negative/vacant** — never decorative.
- Do **not** introduce a rainbow. Categorical breakdowns use a single-family **purple→graphite** ramp
  (`TYPE_COLORS = ['#a98fc9','#8a7ba0','#6f677e','#585462','#47444e','#3a383f']`): a purple lead fading to
  neutral graphite — not "all purple".

### Spacing
- Outer dashboard padding `24px 32px 20px` (tightened at ≤1400px).
- Inter-card gaps `12–16px`; grid gaps consistent within a row.
- Card header padding `18px 22px 14px`; card body `16px 22px 20px`.
- Spacing is intentionally tight and gridded — an architectural, not airy, rhythm.

### Hierarchy
Header → Project tabs → Main. Within Main, the left "insights" column carries the numeric story
(property → occupancy → KPIs → velocity → trends → breakdowns → top tenants), and the right column is the
tenant directory. Size, weight, and the purple highlight encode importance.

### Corner radius
- `--radius: 8px` (cards, panels), `--radius-sm: 6px` (inputs, small chips). "Sharper corporate borders" —
  not pill-rounded. Keep radii in this range.

### Shadow philosophy
Cards read as **thin panels lifted ~2–3mm off the background** — not floating glass. The treatment is a
barely-there vertical surface gradient + a soft directional drop shadow (stronger below) + inset
top-highlight / lower-edge hairlines. **No glow. No colored shadows. No motion on hover** — hover only
firms the border and deepens the shadow slightly (TV-safe). Secondary cards use a slightly lighter elevation.

### Icon style
Inline **SVG line icons**, `stroke-width ~1.8`, `stroke: currentColor`, rounded caps/joins, ~18px in a 30px
**thin-ruled** tile (transparent fill + `1px solid var(--hairline)` border — an engineered/architectural
marker, not a filled grey blob). Monochrome, muted (`--white-50`). Keep all new icons in this exact line
style — no filled/duotone/emoji icons.

### Visual consistency
Every new element should be indistinguishable in language from what exists: same tokens, same card
treatment, same type scale, same icon style. When in doubt, copy an existing component's structure.

---

## 4. TECHNOLOGY STACK

Deliberately minimal. No framework, no bundler, no dependencies to install.

| Technology | Version / Source | Why it's used |
|------------|------------------|---------------|
| **HTML5** | single file | One self-contained document is trivial to deploy on a display PC and impossible to "break the build." |
| **CSS3** | inline `<style>` | Custom properties + grid/flex give a precise, token-driven architectural layout with zero tooling. |
| **Vanilla JavaScript (ES2015+)** | inline `<script>` (classic) | No framework overhead; fast load, full control, nothing to keep patched. All logic is plain functions over a data array. |
| **Chart.js** | `4.4.7` (jsDelivr CDN, UMD) | Lightweight, dependency-free charting for the doughnut + two mini bar charts. Good defaults, easy theming, in-place `.update()`. |
| **Three.js** | `0.170.0` (jsDelivr CDN, **ESM** `three.module.min.js`) | Renders the subtle 3D tenant medallions where 3D genuinely aids hierarchy. ESM build is bridged to `window.THREE`. |
| **Google Fonts** | Hanken Grotesk | Brand typeface. |
| **VS Code Live Server** | dev only (`.vscode/settings.json`) | Zero-config local static server with auto-reload during development. Not a runtime dependency. |

**CDN note:** Chart.js and Three.js load from CDNs, so the charts and 3D medallions require internet on the
display machine. Everything else works offline. All CDN-dependent features degrade gracefully (see §8/§9).

---

## 5. PROJECT STRUCTURE

```
test backup 3d/
├── Project Dashboard.html      ← THE LIVE APPLICATION (self-contained: HTML + CSS + JS, ~2,996 lines)
├── page-3.svg                  ← Official BlackSand header logo (flat SVG, framed to its content)
├── logos/
│   ├── al-tamimi.png           ← Tenant logo (Al Tamimi / tamimi markets) — used by a medallion
│   └── tharwah_logo.png        ← Tenant logo (Al Tharwah Co.) — used by a medallion
├── server/
│   └── server.js               ← OPTIONAL Express host (Method 2) — serves the same standalone file over HTTP
├── scripts/
│   └── check-project.js        ← Project integrity check (`npm run check`; Node built-ins only)
├── package.json                ← Scripts (start / dev / check) + the single dependency (express)
├── .env.example                ← Copy → .env for HOST/PORT (+ future Monday creds); .env is gitignored
├── .gitignore                  ← node_modules/, .env(.*), logs
├── README.md                   ← How to run BOTH methods (standalone + Express) + kiosk mode
├── archive/
│   └── legacy-v1/              ← Obsolete V1 prototype, archived (NOT loaded by the live dashboard)
│       ├── script.js           ←   V1 vanilla-JS logic (targets an obsolete DOM / index.html)
│       ├── styles.css          ←   V1 styling
│       ├── README.md           ←   V1 documentation ("open index.html")
│       └── ARCHIVE_NOTE.md      ←   Why these are archived; do not edit expecting live changes
├── CLAUDE.md                   ← This document
└── .vscode/
    └── settings.json           ← Live Server workspace config (dev only)
```

**Two run modes, one frontend.** `Project Dashboard.html` is the **reference implementation** — opening it
directly (`file://`) still works with zero server. The `server/` + `package.json` layer is an **optional**
Express host (`npm install && npm start` → `http://localhost:3000`) that serves the *same* file unchanged
for local/LAN (TV) access and future Monday.com work; see §22.3. Removing `server/` leaves the standalone
dashboard fully working.

### File responsibilities

- **`Project Dashboard.html`** — the entire live product. All markup, all CSS (one inline `<style>` in
  `<head>`), and all JavaScript (one inline `<script>` before `</body>`) live here (~2,996 lines). This is
  the **only** file that renders the dashboard. **Edit this file to change the dashboard.**

- **`page-3.svg`** — the official BlackSand lockup (grey→purple ribbon + diamond + "Blacksand" wordmark).
  Rendered **flat** and directly via a single `<img class="brand-logo" src="page-3.svg">` in the header —
  no Three.js, no extrusion, no motion. Its `viewBox` was tightened to the artwork bounds so it fills the
  header cleanly (artwork paths unchanged). If a new official logo is exported, replace this file.

- **`logos/`** — tenant logo assets. A tenant object may carry a `logo` path; the 3D medallion loads it onto
  the coin face, falling back to initials if it can't load. Add new tenant logos here.

- **`archive/legacy-v1/`** — the original **V1 prototype** (`script.js`, `styles.css`, `README.md`),
  archived for historical reference with an `ARCHIVE_NOTE.md`. It is **not linked or executed** by the live
  dashboard and targets an obsolete DOM (`#live-clock`, `#tenant-body`, `.table-scroll`, `#occupancy-chart`,
  a non-existent `index.html`). **Do not edit anything in `archive/` expecting the dashboard to change** —
  the live HTML is the sole source of truth.

- **Future assets / data** — new tenant logos go in `logos/`. When a live data layer arrives, the inline
  `projects[]` array (and mock `performanceSummary`) is the swap point; a future `data/` module or fetch
  layer would replace those literals (see §7 and §16).

---

## 6. DASHBOARD ARCHITECTURE

### Overall layout
```
body (100vh, overflow: hidden — the page itself NEVER scrolls)
└─ .dashboard            grid-template-rows: auto (header) / auto (tabs) / 1fr (main)
   ├─ .header            logo · title/project name · presentation badge · last-updated · clock
   ├─ .project-tabs      one .project-tab button per project (built from data)
   └─ .main              grid-template-columns: minmax(0,1.6fr) [insights] · minmax(340px,1fr) [tenants]
      ├─ .insights-col   (flex column)
      │   ├─ .top-row          Retail prop-card · Office prop-card · Occupancy donut
      │   ├─ .kpi-grid         4× KPI cards (Total GLA, Overall Leased, Vacant, Tenants)
      │   ├─ .velocity-grid    3× velocity cards (Retail, Office, Overall)
      │   ├─ .perf-summary     3× trend indicators (JS-populated)
      │   ├─ .insight-row      Leased Area bar chart · Occupancy Breakdown bar chart
      │   ├─ .top-tenants      3× tenant plaques w/ 3D medallions (JS-populated)
      │   └─ .bottom-bar       brand diamond · "Value Perfected" · address
      └─ .right-col      Tenant Directory card: search + Retail table + Offices table
```

### Component hierarchy
Two card tiers share one visual language:
- **Primary `.card`** — donut, KPIs, tenant directory.
- **Secondary cards** (`.velocity-card`, `.perf-summary`, `.leased-area-card`, `.type-breakdown-card`) —
  same treatment, slightly lighter elevation.

Repeated sub-components: `.card-header` (icon tile + `h2`), `.prop-card`, `.kpi`, `.tenant-plaque`,
`.tenant-table`, `.progress-bar`/`.progress-fill`.

### Information hierarchy
Left column tells the numeric story top-to-bottom (headline occupancy → KPIs → momentum → composition →
who). Right column is the detailed roster. The donut's centre label and the "Overall Leased" KPI are the
two focal points, both in the purple highlight.

### How projects switch
- Fully **data-driven** from the `projects[]` array. `renderTabs()` builds one tab per project, so adding a
  project object automatically adds a tab — no markup change.
- `switchProject(index)` highlights the tab instantly, fades `.main` out (`.is-switching` → `opacity:0`,
  300ms), swaps `currentIndex`, calls `renderProject()`, then fades back in via `requestAnimationFrame`.
- **No page reload. Charts are updated in place, never recreated.**

### How components communicate
There is no framework state. The contract is:
- `projects[]` is the data source; `currentIndex` is the global "which project is showing" pointer.
- `renderProject(p)` is the **single orchestrator** — it recomputes metrics and pushes values into every
  component (header, property cards, KPIs, donut, velocity, both mini charts, tenant tables, top tenants).
- Everything else (search, idle paging, refresh) reads `currentIndex` and calls the same render functions.

### Rendering flow (on load — see the INIT block)
1. `assignMockLeaseDates()` — fill any missing `leaseDate` deterministically (Monday.com-ready).
2. `renderTabs()` — build the project selector.
3. `renderProject(projects[currentIndex])` — initial paint of Business Address.
4. `renderPerformanceSummary()` — trend ribbon (mock data).
5. Charts (`doughnut`, `leasedAreaChart`, `typeBreakdownChart`) are constructed once.
6. Three.js visuals mount when ready: `initThreeVisuals()` runs immediately if `THREE` exists, else on the
   `three-ready` event. It (re-)mounts the top-tenant medallions.
7. Clock starts (`updateClock` every 1s); `simulateRefresh` every 30s; idle timer armed via `onUserActivity()`.

---

## 7. DATA MODEL

All data is inline in `Project Dashboard.html`. Metric functions are **pure** (project in → numbers out).

### Project object
```js
{
  project: 'Business Address',          // display name + tab label
  address: '1200 Business Boulevard…',  // shown in the bottom bar
  retail:  { label, gla, leasedPct?, tenants:[…] },   // "Retail" / "Commercial"
  office:  { label, gla, leasedPct?, tenants:[…] },   // "Offices"
}
```
- `gla` — gross leasable area of the building (m²), **includes vacant space**. `null` ⇒ fall back to summed
  tenant area.
- `leasedPct` — optional fraction `0–1`. **If present, it drives leased area** (`gla × leasedPct`); if absent,
  leased area is the **sum of tenant `area`**.

**Two data modes (critical to understand):**
- **Business Address** — no `leasedPct`; leased area is derived by **summing tenant lease areas** (tenants
  are the source of truth).
- **Town Center** — provides explicit `leasedPct` per category; **the tenant list is displayed as-is and
  does NOT drive the headline KPIs** (pending the official Town Center leased-area list).

### Tenant object
```js
{ name, type, area, leaseDate?, logo? }
```
- `name` — display name. **Duplicate names are intentional** — each entry is one lease; the same tenant can
  hold several leases. They are grouped by name only at display time (Top Tenants) and summed.
- `type` — category label (e.g. `Restaurant`, `Retail`, `Offices`, `F&B`, `GYM`, `Super Market`). Drives the
  Occupancy Breakdown chart and the tenant table's type pill.
- `area` — leased area in m² (may be fractional).
- `leaseDate` — ISO `YYYY-MM-DD` (same shape as Monday.com). Drives leasing velocity. Missing dates are
  filled once by `mockLeaseDate()` (deterministic hash of name/category) so results are stable across reloads.
  **Real lease dates are respected as-is and never overwritten.**
- `logo` — optional path (e.g. `logos/al-tamimi.png`) shown on the tenant's 3D medallion; carried through
  name-grouping in Top Tenants.

### Derived metrics
- `computeMetrics(p)` → `{ retailGLA, officeGLA, retailLeased, officeLeased, retailPct, officePct, totalGLA,
  totalLeased, totalVacant, overallLeasedPct, totalTenants }`. **This is the numeric core** — every KPI,
  bar, and the donut depend on it.
- `computeVelocity(p)` → `{ retail, office, overall }` m²/day, using `leasedAreaInWindow()` over a
  90-day window (`VELOCITY_WINDOW_DAYS`) ÷ 90.
- `leasedAreaByCategory(p)` → labels + leased m² per category (mirrors the occupancy model so numbers agree).
- `leasedAreaByType(p)` → leased m² grouped by tenant `type`, sorted largest-first (Occupancy Breakdown).
- `computeTopTenants(p)` → top 3 tenants by summed area after grouping by name (carries a logo through).

### Performance summary (trend ribbon)
```js
const performanceSummary = {
  occupancyChange: { value: 2.3, unit: '%',  period: 'Compared with last month' },
  velocityChange:  { value: 14,  unit: '%',  period: 'Compared with last quarter' },
  newLeasing:      { value: 420, unit: ' m²',period: 'New leased area this month' },
};
```
**Mock, period-over-period deltas.** To go live, replace the numeric `value`s with figures derived from
Monday.com history (e.g. a `getPerformanceSummary()` that diffs current vs prior period). The render layer
(`formatChange`, `arrowSVG`, `renderPerformanceSummary`) needs no change.

### Charts / KPIs / occupancy / velocity / logos
Covered above and in §8/§10. All are computed from `projects[]`; nothing is hardcoded in the DOM except
placeholder text that JS overwrites on first paint.

### Future data integration
The intended path: replace the inline `projects[]` and `performanceSummary` literals with data fetched from
**Monday.com** (boards → projects, items → tenants with real `leaseDate`s). Because every component reads
through the pure metric functions, wiring a real source should not require touching render or styling code.

---

## 8. COMPONENT DOCUMENTATION

For each component: **purpose · inputs · outputs · dependencies · styling · rendering · future.**

### Header (`.header`)
- **Purpose:** brand presence, current project name, live clock, last-updated stamp, presentation badge.
- **Inputs:** `p.project` (project name), system clock. **Outputs:** `#projectName`, `#currentDate`,
  `#currentTime`, `#lastUpdated`, `#presentationBadge`.
- **Dependencies:** `updateClock()` (1s), `stampLastUpdated()`, CSS logo depth-stack.
- **Styling:** flex row; title 24px/600; project name lilac, uppercase, tracked.
- **Rendering:** clock ticks every second; badge appears only in idle presentation mode.
- **Future:** could show data-source/connection status once live.

### Project Tabs (`.project-tabs` / `.project-tab`)
- **Purpose:** switch between property projects. **Inputs:** `projects[]`, `currentIndex`.
- **Outputs:** active tab highlight + a `switchProject()` call. **Dependencies:** `renderTabs()`,
  `updateActiveTab()`, `switchProject()`.
- **Styling:** text buttons with a lilac underline on `.active`; no chrome.
- **Rendering:** rebuilt from data; one tab per project automatically.
- **Future:** grouping/scrolling if many projects; keyboard arrow navigation.

### Retail card / Office card (`.prop-card`)
- **Purpose:** per-category GLA + leased % + progress bar. **Inputs:** `computeMetrics(p)`.
- **Outputs:** `#retailGLA`/`#officeGLA`, `#retailPct`/`#officePct`, `#retailBar`/`#officeBar` widths.
- **Dependencies:** `renderProject()`; CSS width transition animates the fill.
- **Styling:** type-badge label, large tabular GLA, 4px lilac progress bar.
- **Rendering:** value set, then bar width set on next frame so the CSS transition runs.
- **Future:** target vs actual, trend arrow per category.

### Occupancy donut (`.occupancy-card` + `#doughnutChart`)
- **Purpose:** leased vs vacant at a glance with a centred % label. **Inputs:** `totalLeased`, `totalVacant`.
- **Outputs:** Chart.js doughnut + `#chartCentrePct`. **Dependencies:** Chart.js.
- **Styling:** fixed 116px box (never overflows), lilac leased arc / graphite vacant, 72% cutout, HTML
  centre label overlaid.
- **Rendering:** created once; `renderProject()` updates the dataset and calls `.update()`.
- **Future:** per-category donuts; hover-to-detail is already wired via tooltip.

### KPI cards (`.kpi-grid`)
- **Purpose:** the four headline numbers — Total GLA, Overall Leased %, Vacant Area, Tenants.
- **Inputs:** `computeMetrics(p)`. **Outputs:** `#kpiTotalGLA`, `#kpiLeased` (lilac), `#kpiVacant`, `#kpiTenants`.
- **Dependencies:** `renderProject()`. **Styling:** label above value; value 25px/600 tabular.
- **Rendering:** plain text/HTML injection. **Future:** optional sparkline or delta chip per KPI.

### Velocity cards (`.velocity-grid`)
- **Purpose:** leasing momentum (m²/day, 3-month avg) for Retail, Office, Overall.
- **Inputs:** `computeVelocity(p)`. **Outputs:** `#retailVelocity`, `#officeVelocity`, `#overallVelocity`,
  and a dynamic `#retailVelLabel` (uses the category label, e.g. "Commercial Velocity").
- **Dependencies:** tenant `leaseDate`s. **Styling:** Overall card accented lilac (`.is-overall`).
- **Rendering:** text injection. **Future:** window length could become configurable; show trend vs prior window.

### Performance Summary ribbon (`.perf-summary` / `#perfSummary`)
- **Purpose:** three period-over-period trend indicators with a directional glyph.
- **Inputs:** `performanceSummary` (mock). **Outputs:** three `.perf-item`s.
- **Dependencies:** `formatChange()`, `arrowSVG()`, `renderPerformanceSummary()`.
- **Styling:** sign-based colour — up = lilac (purple), down = coral, flat = grey. Triangle/rect SVG glyphs.
- **Rendering:** `innerHTML` from the data array. **Future:** derive from real Monday.com history.

### Leased Area chart (`.leased-area-card` + `#leasedAreaChart`)
- **Purpose:** leased m² by category. **Inputs:** `leasedAreaByCategory(p)`.
- **Dependencies:** Chart.js. **Styling:** horizontal bars, lilac (retail/commercial) + brand purple (offices).
- **Rendering:** created once, updated in place. **Future:** add prior-period ghost bars.

### Occupancy Breakdown chart (`.type-breakdown-card` + `#typeBreakdownChart`)
- **Purpose:** leased m² grouped by tenant `type`, largest-first. **Inputs:** `leasedAreaByType(p)`.
- **Dependencies:** Chart.js, `TYPE_COLORS` ramp. **Styling:** horizontal bars, single-family purple→graphite ramp.
- **Rendering:** created once; labels/data/colours updated per project. **Future:** click-to-filter the table.

### Top Tenants (`.top-tenants-grid` / `#topTenantsGrid`)
- **Purpose:** spotlight the three largest tenants by leased area, with a 3D medallion (logo or initials).
- **Inputs:** `computeTopTenants(p)`. **Outputs:** three `.tenant-plaque`s each with a Three.js medallion.
- **Dependencies:** Three.js (`createMedallion`), `disposeMedallions()`, `tenantInitials()`.
- **Styling:** plaque with rank number, medallion, name, area (lilac). **Note:** plaques currently use
  `backdrop-filter` glass + a float animation — flagged for review against the design philosophy (§2/§12).
- **Rendering:** disposes old medallions, rebuilds plaques, mounts one medallion each (flat initials if no WebGL).
- **Future:** reduce glass/motion; add YoY growth or lease-count per tenant.

### Tenant Directory (`.tenant-card`, `#retailTable`, `#officeTable`)
- **Purpose:** full, searchable roster split into Retail and Offices. **Inputs:** `p.retail.tenants`,
  `p.office.tenants`, search query.
- **Outputs:** two tables via `renderTenantTable()`; "No matching tenants" row when empty.
- **Dependencies:** `renderTenants()`, `tenantMatches()`, `#tenantSearch`.
- **Styling:** sticky headers, type pills, tabular right-aligned area, custom thin scrollbar; its `.card-body`
  is the **only** scroll container on the page.
- **Rendering:** filtered re-render on input and on project switch. **Future:** column sort; virtualisation
  for very long lists.

### Footer / bottom bar (`.bottom-bar`)
- **Purpose:** brand device + tagline ("Value **Perfected**") + current project address.
- **Inputs:** `p.address` → `#addressText`. **Styling:** purple diamond, tracked uppercase tagline.
- **Future:** could carry a data-freshness note or legal line.

---

## 9. THREE.JS ARCHITECTURE

Three.js is used **sparingly and only where 3D improves hierarchy** — currently the Top-Tenant medallions.
It is loaded as an **ESM module** and bridged to classic script:

```html
<script type="module">
  import * as THREE from '…three@0.170.0/build/three.module.min.js';
  window.THREE = THREE;
  window.dispatchEvent(new Event('three-ready'));
</script>
```
The classic init code waits for `three-ready` (or uses `THREE` immediately if already present).

### Tenant medallion — `createMedallion(size, initials, logo)`
- **Scene:** a `THREE.Scene` per medallion.
- **Camera:** `PerspectiveCamera(32, 1, 0.1, 100)` at `z ≈ 5.2`.
- **Renderer:** `WebGLRenderer({ alpha:true, antialias:true })`, `setPixelRatio(min(dpr, 2))` (caps retina cost).
- **Lighting:** neutral ambient (`0x928e97`) + white key `DirectionalLight` + lilac rim (`0xb9a6d9`) — matches the brand.
- **Geometry/materials:** an extruded, beveled coin (`ExtrudeGeometry`, `MeshStandardMaterial`, dark
  graphite metal) + a lilac `TorusGeometry` edge ring. The face is a `CircleGeometry` textured from a canvas of the
  tenant **initials** (`CanvasTexture`), or the tenant **logo** via `TextureLoader` when present.
- **Fallbacks (must preserve):** logo load failure keeps initials; a render error from an unusable
  (e.g. cross-origin/local) logo texture **reverts to initials once** and keeps rendering; no WebGL at all →
  flat text initials (`el.textContent`).
- **Animation:** a gentle `sin`-driven ±~28° tilt via `requestAnimationFrame`; **pauses when
  `document.hidden`** to save GPU.
- **Lifecycle:** every medallion is tracked in the `medallions[]` array; `disposeMedallions()` is called
  **before each re-render** and disposes geometries, materials, textures, and the renderer (and
  `forceContextLoss()`), preventing WebGL context leaks across project switches.

### Header logo (`initThreeLogo()`) — currently dormant
A full 3D extrusion of the BlackSand mark from its SVG paths exists (`initThreeLogo()`) but is **not called**
in the live flow — the header instead uses a **CSS layered depth-stack** of the PNG. Keep `initThreeLogo()`
as a reference/option; if re-enabled, it must remain subtle and low-cost.

### Future expansion (keep it lightweight)
Any new Three.js must: reuse the "subtle, brand-lit, pauses when hidden, disposes cleanly" pattern; cap
pixel ratio; avoid heavy geometry; and only exist where it clarifies hierarchy (e.g. a possible 3D occupancy
massing model — see Roadmap). **Never** add spinning/glowing decoration.

---

## 10. CHART.JS STANDARDS

All three charts share one visual grammar so they read as a system.

- **Colour usage:** light lilac (`#b9a6d9`) is the primary data colour; vacant/negative is graphite
  (`#2b2833` / `#322e3a`) or coral; the Leased-Area chart pairs lilac (retail/commercial) with the brand
  purple `#8764AB` (offices); the type breakdown uses the `TYPE_COLORS` single-family **purple→graphite**
  ramp (`['#a98fc9','#8a7ba0','#6f677e','#585462','#47444e','#3a383f']`). No rainbows, no blue/teal. Bar
  borders are surface-coloured so segments read as inset.
- **Spacing:** compact bars (`barThickness` 14–18), tight layout padding, thin/removed gridlines
  (`rgba(255,255,255,0.05)` on x, none on y).
- **Font rules:** always `family: 'Hanken Grotesk'`; muted neutral tick labels (`#847f8c` / `#d8d6dc`), 11–13px,
  weight 500–600; thousands shown as `k` on axes.
- **Tooltips:** dark (`rgba(12,16,23,0.96)`), 6px radius, Hanken Grotesk, values formatted with `toLocaleString()` + `m²`.
- **Responsive behaviour:** `responsive:true` + `maintainAspectRatio:false`, sized by the **CSS box**
  (the donut is locked to a 116px square so it never overflows on any screen). Charts are created **once**
  and updated via `.update()` — never recreated on project switch.
- **Executive readability:** legends are custom HTML (or hidden) rather than Chart.js defaults; animation is
  brief and purposeful (donut ~1200ms on first load, bars ~600ms).
- **Future chart additions:** must adopt the same palette, fonts, tooltip style, compact spacing, and the
  create-once/update-in-place pattern. Prefer horizontal bars and doughnuts (calm, executive) over busy line
  clutter unless showing a genuine time series.

---

## 11. STYLING SYSTEM

### Shared cards
`.card` is the base treatment (surface gradient + border + layered shadow + inset hairlines). Secondary
cards (`.velocity-card`, `.perf-summary`, `.leased-area-card`, `.type-breakdown-card`) override only the
shadow to a lighter elevation. **New panels should start from `.card`** and add a purpose class for layout only.

### Spacing & grid
CSS Grid drives the page skeleton (`.dashboard`, `.main`, `.top-row`, `.kpi-grid`, `.velocity-grid`,
`.insight-row`, `.top-tenants-grid`) and flexbox drives column stacking. Gaps are 12–16px and consistent per
row. Respect the existing rhythm; don't introduce ad-hoc margins.

### Shadows, gradients, depth, borders
- Depth = **subtle drop shadow + inset top-highlight/lower-edge lines**, never glow.
- Gradients are ≤3–4% white/black over the surface token — barely perceptible.
- Borders use `--border`; internal separators use `--hairline`.
- The goal is "thin lifted panel," not glass. Only the (flagged) top-tenant plaques use `backdrop-filter`.

### Typography & hover
- Type scale and weights per §3. Hover is **border + shadow only** (no transform/motion) for TV safety.
  The one exception (plaque lift/tilt) is flagged for review.

### How to create a new card (recipe)
1. Add `<div class="card [purpose-class]">` with a `.card-header` (SVG line icon in a 30px tile + uppercase `h2`).
2. Put content in a `.card-body` (or a purpose body class with the standard padding).
3. Use only `:root` tokens for colour/spacing/radius; the purple highlight (`--accent-hi`) for the single accent, tabular numerals for figures.
4. If it charts, follow §10; if it needs JS data, push values inside `renderProject()` so it updates on
   project switch. Add an entrance via `.animate-in .delay-N` if appropriate.
5. Do **not** add new colours, glows, or motion.

### Component reuse
Prefer existing helpers/classes: `renderTenantTable()` (parameterised by table id), `formatChange()` +
`arrowSVG()`, `createMedallion()`, `TYPE_COLORS`, `.progress-bar/.progress-fill`, the `.card-header` pattern.

---

## 12. ANIMATION PHILOSOPHY

> **Only important elements may animate. Everything else stays still.** On an always-on executive display,
> perpetual motion is fatiguing and cheapens the product.

**Sanctioned motion (purposeful, brief, or subtle):**
- **Entrance** — one-shot `fadeInUp` with small staggered delays (`.animate-in .delay-1..5`) on first paint.
- **Chart loading** — brief Chart.js reveal (donut ~1.2s, bars ~0.6s).
- **Progress bars** — smooth width fill on data change (a value transition, not idle motion).
- **Project switch** — a single ~300ms cross-fade of `.main`.
- **Number/value updates** — value swaps are instant/clean; a subtle count-up is acceptable if added tastefully.
- **BlackSand logo & Top-Tenant medallions** — gentle, slow 3D where 3D aids hierarchy; medallions pause when
  the tab is hidden.

**Discouraged / under review:**
- Continuous idle float/tilt on the header logo and plaques, and plaque glassmorphism — these lean toward the
  "flashy/AI-generated" look the brief rejects. Prefer reducing over extending them.

**Never add:** neon pulses, bounce, parallax scroll effects, looping spinners as decoration, or motion that
competes with reading the data.

---

## 13. PERFORMANCE GOALS

- **Fast load:** one HTML file + two CDN libs. No bundler, no hydration. Should paint quickly on a modest
  office PC.
- **Minimal JavaScript:** plain functions over a data array; avoid adding heavy dependencies.
- **Efficient rendering:** charts are **created once and updated in place**; DOM is written only through the
  render functions; avoid gratuitous `innerHTML` thrash.
- **One renderer per concern:** each medallion has its own small WebGL renderer, but they are **disposed on
  every re-render** (`disposeMedallions()`), and pixel ratio is capped at 2. Do not leak WebGL contexts
  (browsers cap ~16) — always dispose before re-mounting.
- **No unnecessary DOM updates:** `simulateRefresh` (30s) currently re-renders only the tenant tables; don't
  add per-second DOM churn beyond the clock.
- **60 FPS target:** animations are `transform`/`opacity`-based and 3D pauses when hidden, to hold 60 FPS on
  office hardware. Keep it that way — profile before adding any new continuous animation.

---

## 14. TV OPTIMISATION

The primary target is a **large always-on office display**, viewed from a distance.

- **Resolutions:** must look correct at **1920×1080** and **3840×2160 (4K)**, plus desktop.
- **No page scroll:** `body { height:100vh; overflow:hidden }`. The **only** scrollable region is the Tenant
  Directory body. The whole executive summary must fit on screen without scrolling.
- **Always-visible KPIs:** occupancy, Overall Leased %, Total GLA, Vacant, Tenants, velocity, and trends are
  always on screen — never behind a scroll or tab.
- **Text size & viewing distance:** large values (22–32px) carry across a room; labels are small but high-
  contrast and tracked. When adding content, keep headline figures large; never shrink KPIs to fit more in.
- **Contrast:** bright values on a near-black surface; the lilac highlight has strong contrast. Avoid mid-grey
  text for anything that must be read from afar.
- **Idle presentation mode:** after 10 min idle, the tenant list auto-pages and a "Presentation Mode" badge
  shows — designed for unattended TV display (see §17).
- **Responsive tuning:** a `@media (max-width:1400px)` block tightens padding and value sizes. Any new layout
  must not break the single-screen fit at 1080p or 4K.

---

## 15. ACCESSIBILITY

Current state and intended direction:
- **Contrast:** high-contrast values on dark surfaces; the purple/coral/grey roles are chosen for legibility.
  Maintain WCAG-reasonable contrast for any new text — don't rely on faint greys for essential data.
- **Readability:** large type, tabular numerals, generous tracking on labels.
- **Colour usage:** trend direction is reinforced with a **glyph** (▲/▼/▬), not colour alone — keep this
  pattern so meaning survives colour-blindness.
- **Images:** the header mark has `alt`/`aria-hidden` handling and an SVG fallback; icons are decorative SVG.
- **Future keyboard support:** project tabs and search are focusable; add full keyboard tab-navigation and
  visible focus rings, and arrow-key project switching.
- **Future screen-reader considerations:** add ARIA roles/labels to charts (e.g. a visually-hidden data
  summary), landmark roles for header/main/nav, and `aria-live` for the "Last Updated" stamp.

---

## 16. FUTURE ROADMAP

> Expandable. Add items as they're planned; keep them grouped.

**Data & integration**
- **Monday.com integration** — replace inline `projects[]` + `performanceSummary` with live boards/items.
- **Real leasing data** — real `leaseDate`s (velocity becomes real), real Town Center leased areas (retire
  the `leasedPct`-only mode there).
- **Historical trends / monthly trends** — time-series of occupancy and velocity.
- **Lease expiry timeline** — upcoming expiries and renewal risk.
- **Tenant analytics** — tenure, growth, concentration risk per tenant.

**Product surface**
- **Additional KPIs** — e.g. WALT (weighted average lease term), rent/m², collection rate.
- **Additional buildings/projects** — the tab system already scales; validate layout with many projects.
- **3D occupancy visualisation** — a lightweight massing model of a building shaded by occupancy (only if it
  clarifies hierarchy; must follow §9 constraints).

**Design & platform**
- **Future branding improvements** — refine per updated BlackSand guidelines.
- **Reduce flagged effects** — soften plaque glass/motion toward the understated standard.
- **Legacy V1 code** — ✅ **done:** `script.js` / `styles.css` / `README.md` were moved to
  `archive/legacy-v1/` (with an `ARCHIVE_NOTE.md`). They are out of the live tree; delete permanently only if
  you're sure the V1 prototype is no longer wanted.
- **Local serving** — the single file can be served as-is (Live Server today). A future **local Express**
  static server (`express.static`) is the intended next step for a proper local deployment — no build step,
  no framework migration.
- **Accessibility** — the keyboard/screen-reader items in §15.

---

## 17. CRITICAL SYSTEM RULES (Do Not Break)

These behaviours are load-bearing. A future session must **never** accidentally break them. Verify each still
works after any change that could touch it.

- **KPI calculations (`computeMetrics`)** — the null-`gla` fallback and the `leasedPct`-vs-summed-tenants
  duality drive every number. Breaking it silently corrupts all KPIs, bars, and the donut.
- **Project switching** — data-driven tabs, `currentIndex`, `switchProject()` fade, and `renderProject()` as
  the single render path. Don't write component DOM outside this path or the views desync.
- **Chart rendering** — charts are created once and updated in place. Never recreate a Chart on switch
  (leaks canvases/animations). Keep the donut's fixed-box sizing.
- **Tenant search** — `#tenantSearch` → `tenantMatches()` → `renderTenants()`; query must survive project
  switches and refreshes; keep the empty-state row.
- **Idle tenant paging** — after `IDLE_TIMEOUT` (10 min), only the tenant list pages every `PAGE_INTERVAL`
  (20s); projects never auto-switch; the `suppressScrollDetection` flag must keep the auto-scroll from
  cancelling itself; real interaction stops paging and rearms the timer.
- **Top Tenant rendering + medallion lifecycle** — always `disposeMedallions()` before re-render; keep the
  logo→initials and no-WebGL fallbacks. Leaking WebGL contexts breaks plaques after a few switches.
- **Logo renderer / 3D bridge** — the `window.THREE` + `three-ready` handshake and the header logo's
  PNG-depth-stack + SVG fallback. Breaking the bridge kills all 3D silently.
- **Layout responsiveness & TV optimisation** — single-screen fit at 1080p and 4K; `body` never scrolls; only
  the tenant list scrolls; KPIs always visible.
- **Shared styling** — the `:root` tokens and `.card` system. Don't fork colours/spacing or introduce new
  primitives that diverge from the design language.
- **Graceful fallbacks** — logo `onerror` chain, Chart.js/Three.js absence guards (`if (doughnut)`, WebGL
  checks). Keep the dashboard functional when a CDN fails.

---

## 18. CODING STANDARDS

- **Reusable components first** — extend existing helpers/classes before writing new ones; parameterise like
  `renderTenantTable(tableId, tenants, q)`.
- **Clean vanilla JavaScript** — small, pure, single-purpose functions; keep metric logic pure (data in →
  values out) and side-effecting render functions separate.
- **Consistent naming** — `render*` for DOM writers, `compute*`/`leasedArea*` for pure metrics, `*Timer`/
  `*Interval` for timing, camelCase throughout; DOM ids match their component.
- **Minimal duplication** — one source of truth (`projects[]`, `computeMetrics`); don't recompute inline.
- **Modular functions** — one responsibility each; wire new data through `renderProject()` so project switch
  keeps working.
- **Shared styling** — tokens only; new cards start from `.card`; no inline styles except the JS-driven
  progress-bar width and existing patterns.
- **Comment the "why"** — match the existing high-signal comment style (e.g. the Monday.com-ready notes).
- **Do not introduce technical debt** — no new dependencies, build steps, or frameworks without a clear reason;
  don't add to the dead `script.js`/`styles.css`; prefer fixing the live file cleanly.

---

## 19. AI CONTRIBUTION GUIDELINES

For future Claude sessions specifically.

**Before changing anything:**
- **Read this file and the live `Project Dashboard.html` first.** Understand the architecture and the two
  data modes. Do not assume; confirm in code.
- **Remember the dead-code trap:** the V1 prototype (`script.js` / `styles.css` / `README.md`) now lives in
  `archive/legacy-v1/` and does **not** affect the live dashboard. Editing anything under `archive/` is
  almost always a mistake — all live changes go in `Project Dashboard.html`.

**When making changes:**
- **Preserve existing functionality** — re-verify the §17 critical rules after edits.
- **Prefer extending over replacing** — reuse components and tokens; avoid unnecessary rewrites.
- **Avoid visual inconsistency** — every change must match the design language (§2/§3/§11). No new colours,
  glows, motion, or icon styles.
- **Maintain executive quality** — data clarity over effect; understated over flashy; suitable for a luxury
  real estate brand.
- **Keep 3D and motion honest** — only where they improve hierarchy; lightweight; dispose/clean up.
- **Confirm single-screen TV fit** at 1080p and 4K; don't introduce page scroll or shrink KPIs.
- **Ask before large structural changes** (splitting the file into modules, deleting the dead trio, changing
  the data source) — these are worth a quick confirmation from the user.

**After making changes:** sanity-check the render flow (load, switch projects, search, idle paging) and note
anything you couldn't verify.

---

## 20. PROJECT VISION

The long-term goal is to build **one of the highest-quality executive leasing dashboards in commercial real
estate** — a tool BlackSand leadership trusts at a glance and is proud to display.

It should feel like **enterprise software crafted by a professional front-end team** — precise, understated,
architectural, and quietly premium — **never** like an AI-generated prototype. Every pixel, number, and
motion should be intentional and in service of clarity. When a future contributor is unsure, the correct
instinct is always: **make it clearer, calmer, and more considered — not flashier.**

---

## 21. VERSION 2 — 3D CENTREPIECE REDESIGN

This project is **Version 2**: the experimental redesign that makes a 3D occupancy model the signature
visual. Everything below reflects the *current* state of `Project Dashboard.html` and **overrides** any
V1-specific description earlier in this document (notably the "Occupancy donut" in §8, which no longer exists).

### 21.1 Layout — the "Central Spine"
The old two-column layout is replaced by a symmetric three-column frame built around the centrepiece.
`.main` is a CSS Grid with `grid-template-areas`:
```
"retail    stage    offices"     ← asset KPI cards flank the top of the stage
"leftrail  stage    rightrail"   ← stage spans rows 1–2 (dominant); rails flank it
"tenants   tenants  directory"   ← operational band
```
- **Centre `stage`** (spans the top two rows, widest column): the 3D occupancy hero + the **Portfolio
  Statistics** ribbon anchored directly beneath it.
- **`retail` / `offices`**: the two asset cards (reused `.prop-card`s) — primary category KPIs, top corners.
- **`leftrail`**: leasing performance — one consolidated **Leasing Velocity** panel + the Performance
  Summary trend ribbon (restyled as a compact vertical list).
- **`rightrail`**: the two supporting charts (Occupancy Breakdown + Leased Area), grouped beside the model.
- **`tenants` / `directory`**: Top Tenants (medallions) + the Tenant Directory.
- The address bar moved out of the column into its own `.dashboard` grid row (`auto auto 1fr auto`).

### 21.2 KPI redistribution (intentional, three tiers)
- **Overall Leased %** → the **hero label inside the ring** (`#occPct`, e.g. "47.7% / LEASED").
- **Total GLA · Leased Area · Vacant Area · Tenants** → the **Portfolio Statistics ribbon** (`#portfolioStats`,
  ids `#statTotalGLA/#statLeased/#statVacant/#statTenants`) — one unit under the hero, not four equal cards.
  It is styled as a **shallow architectural plinth** that visually mounts the 3D model: a single restrained
  `transform: translateY(-10px) perspective(900px) rotateX(3deg)` on the whole `.portfolio-stats` (never the
  individual `.pstat` cells), a `::before` extrusion layer (`z-index:-1`, `translateY(4px)`, `#0a0f16`) for
  ~4px of thickness, a top-to-bottom surface gradient over `--surface`, and inset top-light / dark-lower-edge
  box-shadow. Cells stay flat and transparent (the ribbon gradient shows through); separators darken toward
  the bottom via a `border-image` gradient. The `translateY` is transform-only, so it pulls the ribbon toward
  the model base **without** changing flex layout or the occupancy canvas — the 3D model's size is unaffected.
  No glass/glow/independent-card motion; TV-safe hover changes only the shadow.
- **Retail / Offices** → the two flanking asset cards (unchanged ids `#retailGLA/#retailPct/#retailBar` etc.).
- The four-card `.kpi-grid` and the three-card `.velocity-grid` were removed; velocity is now one
  `.velocity-panel` card with three rows (`#retailVelocity/#officeVelocity/#overallVelocity`, Overall in lilac).

### 21.3 The occupancy centrepiece (`createOccupancyRing(container)`)
The signature Three.js element. **One** renderer / scene / camera. Replaces the Chart.js doughnut.
- **Sizing (do not regress):** the ring and contact shadow live inside a single
  `occupancyModelGroup` with a **fixed** `scale.setScalar(0.82)` (~18% smaller than raw geometry, for
  breathing room). This scale is a **constant** — never computed from container/window/renderer size.
  Resize the whole composition by adjusting only this one value (0.80–0.85).
- **Refresh-stable size (the fix for the "grows after refresh" bug):** the canvas *display* size is owned
  entirely by CSS (`.occupancy-canvas { position:absolute; inset:0; width/height:100% }`). The renderer is
  called with `setSize(w, h, false)` (updateStyle:false) so it only sets the drawing **buffer**, never the
  displayed size. Previously the canvas had no CSS size, so its display fell back to the buffer attributes
  (`w × devicePixelRatio` ≈ 2×) — a size that varied with whatever `container.clientHeight` was measured at
  init, differing between cold load and warm refresh. With CSS owning display size, the model is identical
  on every load. A `ResizeObserver` on the container keeps the buffer matched to the box; it updates **only**
  renderer size + `camera.aspect` + `updateProjectionMatrix()` — never model scale, camera or geometry.
- **Fixed camera:** `PerspectiveCamera(fov 35)` at a fixed position/distance; only aspect changes on resize.
  (A tiny sinusoidal x/y camera drift is part of the approved restrained motion; z/distance never change,
  so it does not affect size.)
- **Ring:** an **extruded, beveled annulus** split into a **leased arc** (lilac `#b9a6d9`) and a **vacant arc**
  (graphite `#322e3a`) via `ExtrudeGeometry` of `Shape` sectors; `fullAnnulusGeo()` handles the 0% / 100% edge cases.
  `buildArcs(frac)` rebuilds the two arcs and **disposes** the previous geometry (no leaks on project switch).
- **Pedestal: REMOVED.** The old three-stacked-`CylinderGeometry` museum-plinth was deleted — from the raised
  camera its dark top disc read as a black oval "pedestal." The ring now floats freely above the particle-wave.
- **Shadow:** a cheap **radial-gradient sprite** plane (no shadow maps) — now a ~5% whisper contact shadow only.
- **Underside bounce:** a soft low-intensity purple `PointLight` beneath the ring simulates the wave field
  reflecting onto the lower rims/bevel (not a glow); intensity/position/colour drift slowly.
- **Lighting:** soft studio — neutral ambient + white key + lilac rim + fill (matches the medallion language).
- **Centre label:** a crisp **HTML overlay** (`.stage-label`), not rendered into the canvas → razor-sharp at 4K.
- **Motion:** gentle float + a tiny camera drift only; **never spins**; pauses on `document.hidden`.
- **Mounting:** `initOccupancyCentrepiece()` runs from `initThreeVisuals()` on `three-ready`; it adds
  `.has-3d` to the stage (which hides the CSS fallback) and paints the current project's value.
- **Fallback:** a **CSS conic-gradient ring** (`.stage-fallback`, driven by `--leased-turn`) shows until/unless
  the 3D mounts, so the occupancy % is always visible even with no WebGL/Three. `renderProject` calls
  `occupancy.update(fraction)` and always sets `#occPct` + `--leased-turn`.

### 21.4 Proportional TV scaling (no media queries) — NATIVE rem, not transform
> **⚠️ Updated:** the whole-dashboard `transform: scale(var(--fit))` was **removed** because scaling a
> rasterised layer softened all text at non-1:1 fits. The design is now authored in **`rem`** and scaled
> **natively** by setting the root font-size — text/charts/vectors render at true device resolution.

The dashboard is authored against a **1920×1080 reference** (`.dashboard { width:120rem; height:67.5rem; }`,
where 1rem = 16px at the reference), centred via `body` flexbox:
- `fitDashboard()` sets `document.documentElement.style.fontSize = 16 × min(innerWidth/1920, innerHeight/1080)`
  on load (and again on `document.fonts.ready`) and on **genuine** resizes. Every rem-based length then scales
  uniformly and crisply. **Do not** reintroduce a `transform: scale` on `.dashboard` or any text-bearing parent.
- **Browser-zoom safe:** Ctrl +/-/0 also fire `resize` and shrink/grow the CSS viewport, so re-fitting on
  every resize would cancel the zoom (the "zoom does nothing" bug). Browser zoom changes
  `window.devicePixelRatio`, a window drag does not — so `onWindowResize()` **skips re-fitting when dpr
  changed** (zoom) and only re-fits on real resizes. Fitting runs on load + real resize only, **never** in a
  render/animation loop. Do not re-add a blind `resize → fitDashboard`, and never set `user-scalable=no` /
  `maximum-scale`, or `preventDefault` on Ctrl+wheel/keydown.
- Result: 1080p, 1440p and 4K render the **identical, balanced composition** — larger and crisper, never
  reflowed, no 4K voids — and the user can still zoom the browser normally. The old `@media` breakpoints were
  removed. The 3D renderer caps pixel ratio at 2, so it stays sharp when the canvas is scaled up. (Browser
  zoom does not change the occupancy stage's CSS-pixel box, so the ResizeObserver does not fire and the 3D
  model stays stable while zooming.)

### 21.4b Card depth hierarchy (surrounding panels)
The dashboard has a deliberate, four-level depth order — **do not flatten it or let a panel out-rank the
model**:
1. **3D occupancy model** — strongest (real WebGL depth).
2. **Portfolio Statistics plinth** — medium (CSS `::before` extrusion + directional shadow + a transform-free
   `top` lift; the old `perspective`/`rotateX` was removed so its numbers render flat & crisp).
3. **Surrounding `.card`s** — light CSS depth only (no transforms).
4. **Chart canvases + table contents** — flat and data-first.

The surrounding cards get their depth from the **shared `.card`** treatment only (never per-component
styling): a faint vertical surface gradient over `--surface`, an inset top-edge highlight (light from above),
a darker inset lower edge, a `rgba(124,134,142,0.18)` border, and a soft neutral drop shadow (~2–3px lift).
**No** `rotate*`/`perspective`/`translateZ`/tilt, **no** coloured/glow shadow, **no** motion — so all text and
charts stay crisp. Two tiers, scoped by existing classes (no new modifier classes needed):
- **Primary** = base `.card` → `.prop-card` (Retail/Offices) + `.tenant-card` (Directory).
- **Secondary** = a lighter drop shadow scoped to `.velocity-card, .perf-summary, .leased-area-card,
  .type-breakdown-card`, so the analytics panels stay subordinate.
Hover is TV-safe: clearer border + slightly deeper shadow + faint top light — **never** translate/scale/tilt.
Chart canvases, table rows/cells, tabs, the footer, and individual velocity/perf rows stay flat (depth lives
on the outer card only).

### 21.4c Header brand lockup — flat SVG (`page-3.svg`)
> **⚠️ Superseded.** The previous Three.js brand-lockup renderer (`initBrandLockup()`), its canvas/
> fallback markup, and the earlier CSS `.logo-depth-stack` PNG stack and `initThreeLogo()` have **all been
> removed.** The header now renders the **official uploaded SVG directly and flat.**

- **Markup:** `<h1 class="brand-logo-wrap"><img class="brand-logo" src="page-3.svg" alt="Blacksand"></h1>`.
  The SVG already contains the wordmark, so there is **no separate "Blacksand" text** beside it. The active
  project name remains a separate HTML element (`#projectName`) beneath the logo, so project switching still
  updates it.
- **Styling:** completely flat — `.brand-logo { height: 4.375rem; width: auto; }` (~25% larger than the old
  lockup); **no** Three.js, extrusion, glow, drop-shadow, rotation, float, perspective, or animated lighting.
  Left-aligned; the header flexbox vertically centres it.
- **Framing:** `page-3.svg` is exported on a padded 1080×1080 artboard, so its `viewBox` was tightened to the
  artwork bounds (`viewBox="213 445 663 187"`) — artwork paths unchanged, nothing cropped/distorted — so the
  lockup fills its box instead of appearing tiny in empty space.
- **Robustness:** as a plain `<img>` it renders crisply at any DPR and works over `file://` too (none of the
  old WebGL cross-origin texture limitation). If WebGL/Three fails elsewhere, the header is unaffected.
- No `blacksand_mark_primary.png` is used anymore (that file has been removed from the project). Tenant
  medallions (§9) are still Three.js. (This supersedes the obsolete §9 "Header logo" and §8 "depth-stack"
  descriptions.)

### 21.4d Premium finish pass (depth / lighting / material realism)
A calibrated "≈40% more premium" polish — more depth, lighting realism and material quality, **without**
more animation, glow, saturation, or size. Levers used (all restrained, executive):
- **Cards:** deeper, better-defined drop shadows + crisper inset top-edge light + thicker dark lower edge +
  a slightly richer surface gradient and border (`.card` and the secondary tier), with **heavier/smoother**
  easing (`0.35s cubic-bezier(0.22,1,0.36,1)`) — never faster. Charts inherit this via their card containers;
  chart canvases/data stay flat.
- **Occupancy model (hero):** a shared dark **studio environment map** (`makeStudioEnvironment(renderer)` —
  PMREM of a dark vertical gradient) gives subtle IBL reflections; the leased/vacant arcs became
  `MeshPhysicalMaterial` with light **clearcoat** + `envMapIntensity`; the contact shadow was later reduced
  to a ~5% whisper (pedestal removed — see §21.3). Size, camera, and animation are otherwise unchanged.
- **Medallions:** coin + ring → `MeshPhysicalMaterial` with clearcoat + env reflections; slightly stronger
  CSS contact shadow. No extra animation.
- **Header lockup:** N/A — the 3D lockup was replaced by the flat `page-3.svg` `<img>` (§21.4c).
- **Portfolio Statistics plinth:** deeper shadow + a thicker `::before` extrusion → more dimensional and
  better integrated with the model.
- **Micro-animation:** the project-switch cross-fade is heavier (`0.45s`), with the swap timing bumped to
  match (450ms) so content lands fully faded. The env is intentionally DARK, so reflections add realism
  without brightening/glowing. `makeStudioEnvironment` returns null on failure (materials still render).

### 21.5 Reused verbatim (do not rebuild)
Project switching (`switchProject`/`renderProject`/`currentIndex`), tenant search, idle auto-paging, the two
Chart.js charts, Performance Summary, **Top Tenant 3D medallions** (kept as secondary premium accents), the
`three-ready` bridge (now serving the occupancy centrepiece, particle-wave, and medallions — the header is a
flat SVG), and all metric functions are unchanged in logic — only repositioned/restyled.

### 21.6 Resilience added
The two Chart.js constructors are now guarded (`typeof Chart === 'undefined' ? null : new Chart(...)`), so a
CDN failure no longer throws at top level. Verified: with the CDN blocked, KPIs, velocity, tenant tables and
the scaling still render, and the occupancy stage shows its CSS fallback ring (satisfies §17).

### 21.7 Validated
Headless Edge at 1920×1080 and 3840×2160: correct data, `has-3d` centrepiece mount, project switch to Town
Center (23,982 m² / 51.0% / 56 tenants) recomputes the ring, no page scroll, and graceful CDN-down degradation.

---

## 22. URL PROJECT SELECTION, PROTOTYPE LIMITATIONS & LOCAL SERVING

### 22.1 URL-based project selection (`?project=slug`)
A project can be opened directly via a query param, e.g. `?project=business-address` or `?project=town-center`.
- **Slugs are DERIVED, not hardcoded** — `projectSlug(name)` lowercases, trims, and collapses any run of
  non-alphanumerics (spaces, underscores, punctuation) to a single hyphen, then strips edge hyphens. So
  "Business Address" → `business-address`, "Town Center" → `town-center`; **new projects work automatically**.
- **Matching** is case-insensitive and tolerant (whitespace/underscores/extra separators normalise).
- **On load** `applyProjectFromURL()` runs **before** `renderTabs()`/`renderProject()`, so the requested
  project is selected before the first paint — **no flash** of the wrong project. Missing or invalid values
  **fall back to the default** (index 0, Business Address); parsing is wrapped in try/catch.
- **On tab click** `switchProject()` calls `updateURLForProject()` → `history.replaceState` with the canonical
  slug: the URL reflects the current project **without a reload and without adding history entries** (chosen
  for an idle-TV dashboard), and **unrelated query params are preserved**. No `localStorage`.
- `file://` note: `replaceState` may be blocked at a `null` origin; it's wrapped in try/catch, so the UI still
  switches — the URL simply isn't rewritten. On Live Server (http) it works.

### 22.2 Prototype limitations (intentionally preserved — resolve at Monday.com integration)
These are **known mock/prototype behaviours**, kept as-is until real data is wired. Do **not** "fix" them ad hoc:
- **`performanceSummary`** (Overall Occupancy +2.3%, Leasing Velocity +14%, New Leasing +420 m²) is a single
  global mock, rendered once at init and **not per project** — the trend ribbon shows the same values for both.
- **"Last Updated"** advances every 30 s via `simulateRefresh()` (which only re-renders the tenant table) —
  it reflects wall-clock time, **not a real data fetch**.
- **`assignMockLeaseDates()`** fills any tenant without a `leaseDate` with a deterministic mock date, so
  **leasing velocity** (esp. Town Center, whose tenants have no authored dates) is computed from invented dates.
- **Tenant count** = number of **lease rows** (`retail.tenants.length + office.tenants.length`), not unique
  companies (duplicate names are separate leases by design).
- **Town Center** headline KPIs use explicit `leasedPct`, while its tenant directory / Occupancy-Breakdown
  chart / Top-Tenants derive from a separate tenant list, and `buildings[]` is a **third** hardcoded dataset —
  these three sources are not reconciled (Business Address does reconcile). This mismatch is **left as-is**.
When Monday.com arrives, replace the inline `projects[]`, `performanceSummary`, lease dates, and `buildings[]`
literals with fetched data behind the existing pure metric functions (§7) — the render layer shouldn't change.

### 22.3 Local serving — optional Express host (implemented)
Two run modes, one unchanged frontend:
- **Standalone (reference):** open `Project Dashboard.html` directly. No server, no install.
- **Express (optional):** `npm install && npm start` → `http://localhost:3000` (`HOST=0.0.0.0`, `PORT=3000`;
  `npm run dev` uses `node --watch`). `server/server.js` is a **minimal** Express app that only:
  `GET /` → sends `Project Dashboard.html`; `GET /health` → `{status,service,timestamp}`; and serves the two
  assets the page needs (`/page-3.svg`, `/logos/…`). There is **no root static mount**, so `server/`,
  `archive/`, `package.json`, `CLAUDE.md`, `.env`, `.git` are **not exposed**. `?project=<slug>` is honoured
  client-side, so `…/?project=town-center` works identically to standalone. **No build step, no bundler, no
  framework, no backend logic** yet. Only dependency: `express`.

Removing `server/` leaves the standalone dashboard fully working — the two modes are visually identical
(the only difference is that over HTTP the Town Center tenant-medallion logos load, whereas `file://` falls
back to initials by design — a browser security limitation, not an Express fault).

**Why Express exists now (beyond LAN hosting):** it is the home for the future **Monday.com** API token,
which must never sit in frontend JS. That token will live in a gitignored `.env` (`.env.example` documents
the vars); the server will fetch board data and hand safe values to the dashboard behind the existing pure
metric functions (§7). Database, auth, Docker, PM2, cloud all remain out of scope.

### 22.4 npm commands, server hardening & Windows/TV deployment
- **npm scripts:** `npm start` (→ `node server/server.js`), `npm run dev` (→ `node --watch server/server.js`),
  `npm run check` (→ `node scripts/check-project.js`, pure Node built-ins, runs before `npm install`).
- **Server hardening** (in `server/server.js`, no frontend impact): HTML served `Cache-Control: no-cache`
  (a kiosk refresh always gets the latest); `/health` is `no-store`; assets (`page-3.svg`, `/logos`) get a
  modest `max-age=3600`; an explicit catch-all **404** so private paths return cleanly; **graceful shutdown**
  on `SIGINT`/`SIGTERM` (`server.close`). Binds `0.0.0.0:3000` and prints Local/LAN/BA/TC/Health URLs.
- **HTTP / offline requirement:** the dashboard still pulls **Google Fonts + Three.js + Chart.js from CDNs**,
  so it is **not fully offline**; without internet it stays readable (KPIs/tables/scaling) and the 3D/charts
  fall back. Self-hosting those libs is a future option (not done — would change the frontend's `<script>`/
  `<link>` tags).
- **Deployment runbook** — see `README.md` for the full Windows/TV guide: finding the host IPv4 (`ipconfig` /
  the server banner), the Windows Firewall prompt (allow **Private**, never disable), a **stable IP** (DHCP
  reservation / static), **Edge kiosk** commands (`msedge --kiosk "http://<ip>:3000/?project=<slug>"
  --edge-kiosk-type=fullscreen`), **manual** auto-start (Startup folder **or** Task Scheduler) via the example
  `scripts/start-dashboard.bat` (server → wait → kiosk; portable `%~dp0..` path; edit-me placeholders; not
  auto-installed), the update procedure, and troubleshooting. **No** PM2/NSSM/service/firewall automation.
- **`Project Dashboard.html` is unchanged** by all deployment work (~2,996 lines). Prototype data limitations
  remain exactly as documented in §22.2 (resolve at Monday.com integration).

---

## 23. BACKEND — SQLITE FOUNDATION (PHASE 1)

> **Status: Phase 1 implemented.** This section documents the **database foundation only**. It adds no
> Monday.com code, no dashboard API, and **no seed data** — every business table is created **empty** by
> design. The frontend is unchanged and still uses its embedded `projects[]`. Later phases (seed → API →
> frontend-reads-API → Monday sync → snapshots) build on this foundation.

### 23.1 Technology & principles
- **`better-sqlite3`** (the project's second and only new runtime dependency alongside `express`). Chosen for
  its **synchronous** API, speed, real transactions, and prepared statements — ideal for a single local
  process. **No ORM** (no Sequelize/Prisma/TypeORM/Knex). SQLite is embedded — **no separate DB server**.
- **One Node process = one writer.** The connection is a module-level singleton; do not run multiple
  processes against one DB file.
- **CommonJS** throughout (matches the existing `server.js`/`scripts`).

### 23.2 Files (responsibilities kept separate — no "one giant module")
```
server/
├── config/database-config.js   Resolve SQLITE_DB_PATH → absolute path (root-relative), mkdir parent.
│                                NO SQL, NO connection — path/config only.
└── db/
    ├── connection.js            Lifecycle: initializeDatabase() / getDatabase() / closeDatabase().
    │                            Opens ONE better-sqlite3 handle, applies + verifies pragmas. Opening is a
    │                            controlled action, never a side effect of import. No silent reopen.
    ├── schema.js                Pure DATA: initial DDL (migration 001) + expected tables/columns/indexes
    │                            for validation + SCHEMA_VERSION. No I/O.
    ├── migrations.js            Ordered, versioned migration runner using a schema_migrations table.
    │                            Each migration runs in a transaction; recorded only on success; re-runs
    │                            are safe. Forward-only (no destructive rollback in v1).
    └── database-health.js       Read-only validateSchema() + getDatabaseHealth() (compact, path-free,
                                 safe for /ready) + getRowCounts(). Never writes, never migrates.
scripts/
├── migrate.js                   `npm run db:migrate` — create/upgrade + validate. The ONLY writer of schema.
└── check-database.js            `npm run db:check` — validate schema + pragmas, read-only (never migrates).
data/
├── .gitkeep                     Tracked (keeps the dir in the repo).
└── dashboard.db                 GENERATED, gitignored (+ -wal/-shm sidecars, data/backups/).
```

### 23.3 Database path (`SQLITE_DB_PATH`)
- Default `data/dashboard.db`. Relative paths resolve from the **project root** (via `path.resolve(__dirname,
  '..','..')`), not the terminal CWD; absolute paths pass through; the parent dir is created if missing.
- **Never placed under a served directory.** The Express host routes only `/`, `/health`, `/ready`,
  `/page-3.svg`, `/logos` — `data/` has no route, so `GET /data/dashboard.db` returns **404** (verified).
- The resolved absolute path may appear in **operator-facing CLI/startup FATAL output** (it's the key
  diagnostic there) but is **never** exposed in an HTTP response. `/ready` returns only a status + schema
  version.

### 23.4 Reliability pragmas (applied + verified on every open)
`foreign_keys = ON` (relational integrity) · `journal_mode = WAL` (readers proceed during a write) ·
`synchronous = NORMAL` (right durability/perf balance for a re-syncable local cache) · `busy_timeout = 5000`
(wait, don't instantly fail, on a brief lock). `foreign_keys` and `WAL` are hard-verified after being set —
startup aborts if either did not take. `unsafeMode` is never used.

### 23.5 Migration system
- `schema_migrations(version INTEGER PK, name TEXT, applied_at TEXT)` tracks applied migrations.
- `MIGRATIONS[]` is an ordered list; version 1 = `001_initial_schema`. Pending migrations run in a
  transaction and are recorded only on success; already-applied versions are skipped. **Re-running is safe**
  (no duplicate tables/rows — verified). Versions are monotonic; never edit a shipped migration — add a new
  one. Future residential fields arrive as **additive** migrations (the project-centric schema generalises
  without a rebuild). Migrations run **automatically on server startup** and via `npm run db:migrate`.

### 23.6 Initial schema (all tables EMPTY in Phase 1)
Created in FK-safe order: `schema_migrations` → `projects` → `property_categories` → `buildings` → `leases`
→ `building_departments` → `sync_runs` → `dashboard_snapshots`, then indexes.
- **Timestamps:** ISO-8601 UTC TEXT (`new Date().toISOString()`) everywhere. **Areas:** REAL m².
- **`external_id`** (nullable) is the stable external key for future Monday items; a **partial UNIQUE index**
  enforces uniqueness only when non-null (so many NULL seed rows are allowed).
- **`leases.tenant_name` is deliberately NOT unique** — duplicate names are real (one tenant, many leases).
- Business rules (valid category codes, occupancy source, etc.) are **not** hard-coded into the DB — the
  category/building `code` and `occupancy_source` are open TEXT; validation (a later phase) owns those rules.
- **CHECK constraints** guard hard invariants only: non-negative areas, `is_active IN (0,1)`,
  `building_departments.leased_area <= total_area`, `explicit_leased_pct` NULL-or-0..1,
  `dashboard_snapshots.occupancy_pct` 0..1. **FKs** use `ON DELETE CASCADE` (children of a project) or
  `SET NULL` (lease→category/building). All verified to enforce at runtime.

### 23.7 Server integration & endpoints
- `server.js` **initialises + migrates the DB before `app.listen`**; on failure it logs a clear,
  stack-free, secret-free FATAL message and **exits non-zero** (never serves on an invalid DB). SQLite is
  closed in the existing single graceful-shutdown handler (no duplicate handlers).
- **`GET /health`** — liveness (unchanged; independent of DB/Monday).
- **`GET /ready`** — readiness: `200` `{status:'ready', database:'ready', schemaVersion, timestamp}` when the
  DB is open with a current valid schema, else `503`. Exposes **no** path/table/pragma/env details.

### 23.8 Phase 1 limitations / deferred
No Monday client, mapping, sync service, scheduler, stale-while-revalidate, manual-sync endpoint, dashboard
API, or historical snapshots. **No seed data** (business tables are empty; the current frontend `projects[]`
is NOT copied into SQLite yet — that is Phase 2). No destructive DB-reset script. These are intentional and
belong to later phases documented in the backend plan.

---

## 24. BACKEND — DATABASE SEED (PHASE 2)

> **Status: Phase 2 implemented.** Migrates the current embedded prototype data into
> SQLite through a safe, repeatable **development seed**. Proves the relational schema
> can represent the current dashboard before the frontend reads an API (Phase 3). NO
> Monday.com, NO dashboard API, NO frontend change, NO historical snapshots.

### 24.1 Terminology
- **seed data** — controlled initial data for development/migration.
- **bootstrap data** — the current frontend prototype values, transcribed to prove the backend.
- **`source = 'seed'`** — every current-state row this phase writes. Future live rows will be `source = 'monday'`.
- **current-state tables** — projects, property_categories, buildings, leases, building_departments.
- **prototype inconsistency** — an existing mismatch preserved verbatim, never silently "fixed".
- The seed is explicitly **bootstrap/demo data, not verified production truth**.

### 24.2 Schema change (migration 002)
`002_add_source_record_keys` adds **`leases.source_record_key TEXT`** + a partial
UNIQUE index `uidx_leases_source_record_key ON leases(source, source_record_key)
WHERE source_record_key IS NOT NULL`. Rationale: duplicate tenant names and
duplicate-looking rows are legitimate, so a lease's identity is a deterministic
seed-only key (e.g. `seed:lease:business-address:retail:001`) — **never** the tenant
name and **never** a fabricated Monday id (`external_id` stays null for seed rows).
Projects/categories/buildings/departments use natural keys (slug; (project,code);
(project,name); (building,code)) — no extra column needed. Migration 001 was NOT
edited; SCHEMA_VERSION is now 2.

### 24.3 Files (separation of concerns — no giant module)
```
server/seed/
├── current-dashboard-data.js   Reviewed explicit bootstrap values (DATA ONLY; no SQL/HTTP/Monday).
├── normalize-seed-data.js      Canonicalize: slugs, codes, strings, dates, source keys, mock dates,
│                               building totals. Reproduces prototype rules; adds no new business rule.
├── validate-seed-data.js       Whole-dataset validation → ERROR / WARNING / INFO (read-only fs for logos).
├── data-version.js             Deterministic SHA-256 over canonical business data (Node crypto; no dep).
└── seed-database.js            Coordinator: normalize → validate → ONE atomic transaction → sync_run.
server/db/repositories/         projects / categories / buildings / leases / building-departments / sync-runs
                                — parameterized SQL only; no parsing, no Monday, no KPI math.
scripts/                        seed-database · inspect-seed-data · check-seeded-database · compare-seed-to-frontend
tests/seed/                     normalize · data-version · validate · seed-database (node:test)
```

### 24.4 Normalization rules
Slug = frontend `projectSlug` (lowercase, non-alnum→hyphen, trim). Category code =
lowercase/trim/hyphen (`retail`, `office`). Strings trimmed; tenant spelling/casing
preserved. Areas parsed as finite numbers, **precision preserved** (rounded only for
display). Percentages stored as **fractions 0..1** (never 40 vs 0.40 confusion —
validation flags >1). Lease dates `YYYY-MM-DD`; created/updated ISO-8601 UTC.

### 24.5 Mock lease dates (Option C — deterministic)
The live frontend fills Town Center's missing dates via a hash-of-name whose absolute
value depends on `new Date()` (not reproducible across days). The seed reproduces the
same deterministic `daysAgo` offset against a **fixed anchor** (`mockDateAnchor`,
`2026-07-15`), so `npm run db:seed` is deterministic — running twice yields the same
dates and the same `dataVersion`. These 56 leases are flagged `mockDate: true` and are
**prototype-derived, never real lease dates**. Business Address's real authored dates
are used as-is.

### 24.6 Validation severity
- **ERROR** (blocks seeding): malformed/invalid data, unresolved project/category
  reference, negative area, duplicate source key, `leased_area > total_area`, invalid
  percentage (>1 / <0), missing tenant name, non-canonical occupancy source, project
  with no categories.
- **WARNING** (reported, non-blocking): Town Center explicit-vs-lease-derived mismatch,
  mock dates, duplicate tenant names, missing logo (frontend falls back to initials).
- **INFO**: counts, provenance, null future Monday ids, unused snapshot tables.
Seeding fails if ANY error exists; warnings are printed and recorded but do not block.

### 24.7 dataVersion
Canonical **SHA-256** (Node `crypto`) over normalized business data only — slugs,
names, addresses, category code/label/total/occupancySource/explicitPct, lease
key/name/type/area/date/logo, building name/code/total, department code/label/totals.
**Excludes** DB ids, timestamps, execution time, warnings, and non-semantic order
(projects sorted by slug, categories by code, buildings by name, leases by
sourceRecordKey, departments by code). Same data → same hash; any business-value
change → new hash. Stored on the successful seed `sync_run`.

### 24.8 Atomicity, idempotency & write strategy
Whole seed runs in **one transaction**; any DB error rolls back (previous state
preserved — the dashboard never sees a half-seeded dataset), and a best-effort
`status='failed'` `sync_run` is recorded outside the transaction. Strategy: upsert
projects/categories/buildings by natural key (stable ids) + delete-obsolete scoped to
seed rows; delete-then-insert departments per building; **delete all `source='seed'`
leases per project, then insert fresh** with `source_record_key`. **Only `source='seed'`
rows are ever touched — `source='monday'` is never affected** (verified by test).
Re-running never duplicates rows and reproduces the same `dataVersion`.

### 24.9 last_data_change_at policy
First successful seed sets `last_data_change_at` to completion time. An **identical**
reseed records a new successful `sync_run` but **reuses** the prior
`last_data_change_at` (a repeated identical seed is not a data change). A **changed**
seed produces a new `dataVersion` and advances `last_data_change_at`.

### 24.10 Preserved prototype inconsistencies (NOT fixed)
Tenant count = **lease-row** count (duplicates are separate leases, never merged).
Business Address occupancy derives from **summed tenant areas**; Town Center headline
uses **explicit `leasedPct`** while its tenant list / buildings are separate datasets
that do not reconcile (office explicit ≈6,301 m² vs lease-sum ≈5,272 m² → WARNING).
`performanceSummary` is a **global mock left in the frontend**, intentionally NOT
seeded (snapshot-derived trends replace it later). Seeded figures reconcile with the
current dashboard: Business Address overall **47.7%**, Town Center **23,982 m² /
51.0% / 56 tenants**.

### 24.11 Security / Git
Seed scripts are CLI-only; seed/db/scripts are never statically served; the DB file
is not HTTP-accessible; all SQL is parameterized; logo paths are validated to stay
within the project root; no secrets in seed data. `.gitignore` also excludes
`data/test-*`. The generated dev database is never committed; seed source, migrations,
validation, tests and docs ARE committed.

### 24.12 Phase 2 limitations / deferred to Phase 3+
No Monday client/mapping/sync/scheduler/stale-while-revalidate, no dashboard API
(`/api/dashboard`), no frontend SQLite reads, no snapshots/real trends. The frontend
still renders entirely from its embedded `projects[]`. Next phase builds the
SQLite-backed Express API and points the frontend at it.

---

## 25. BACKEND — READ-ONLY DASHBOARD API (PHASE 3)

> **Status: Phase 3 implemented.** A read-only, SQLite-backed JSON API. No Monday, no
> writes, no scheduling. It is the live data source the frontend reads in Phase 4.

### 25.1 Endpoints
- `GET /api/dashboard` → `{ data: { projects: [...] }, meta: {...} }`. Projects are in
  the **frontend-compatible shape** (`project`, `slug`, `address`, `retail`, `office`,
  `buildings`) PLUS a backend `metrics` block (canonical, mirrors the frontend
  `computeMetrics` exactly). `meta` = `{ apiVersion, source:'sqlite', checkedAt,
  dataVersion, lastSuccessfulSync, lastDataChange, projectCount }`.
- `GET /api/dashboard/projects/:slug` → single project (404 unknown).
- `GET /api/sync/status` → seed/sync provenance (`status`, `lastSuccessfulSync`,
  `lastAttemptedSync`, `lastDataChange`, `dataVersion`, counts, `syncInProgress:false`).

### 25.2 Layering
`server/services/dashboard-service.js` (reads repos, assembles payload + metrics + meta;
reproduces prototype business rules verbatim — leasedPct-or-lease-sum, tenant count =
lease rows, Town Center NOT reconciled) → `server/routes/{dashboard,sync}-routes.js`
(thin; `Cache-Control: no-store`; safe generic errors — never a stack/path/SQL) →
mounted at `/api` in `server.js`. `checkedAt` is the moment the response is built (a
fresh SQLite read). Meta timestamps come from the latest successful `sync_run`.

### 25.3 No-data & errors
Empty/unseeded DB → controlled **503** `{ error:'no-data', meta:{…} }` with **no
fabricated projects**. Unexpected errors → **500** with a generic message. No secret or
DB path ever appears in a response.

### 25.4 Server refactor & validation
`server.js` now exports `{ app, startServer }` and auto-starts only under
`require.main === module`, so `api:check`/tests drive the same app in-process on an
ephemeral port. `npm run api:check` (contract + headers + no-secret checks) and
`npm run test:api` (routes incl. no-data) validate it. `npm start` behaviour is
unchanged.

---

## 26. FRONTEND — LIVE DATA INTEGRATION (PHASE 4)

> **Status: Phase 4 implemented.** The server-hosted dashboard reads `/api/dashboard`
> as its live source and polls every five minutes; the standalone HTML remains an
> explicit demo. Visual design, Chart.js, Three.js, scaling, tenant search and idle
> paging are unchanged. Monday remains deferred.

### 26.1 Mode detection & state
`isDemoMode()`: `file://` (or `?mode=demo`) → **demo**; otherwise **live**. A single
`dashboardState` holds `mode` (`demo|loading|live|degraded|error`), `meta`,
`currentDataVersion`, `currentProjectSlug`, `lastSuccessfulResponse`, `lastCheckedAt`,
`requestInProgress`, `consecutiveFailures`, `pollTimer`, `retryTimer`. There is **no
silent live→demo fallback**: a live API failure shows degraded/error, never demo data.

### 26.2 API client (inline, isolated section)
Kept inline (smallest diff; standalone file:// safe). Functions: `fetchDashboardData`
(same-origin `GET /api/dashboard`, `cache:'no-store'`, `AbortController` 10s timeout),
`validateDashboardResponse`, `adaptApiProjectToFrontendProject` (centralized field
mapping — currently near-identity since the API already returns the frontend shape),
`applyDashboardPayload`, `pollOnce`, `start/stopDashboardPolling`,
`handleDashboardRequestFailure`, `setConnectionState`, `setLastChecked`. Fetch logic is
never mixed into chart/Three.js code.

### 26.3 Polling, request lock, visibility
Interval is exactly **5 min** in production (`5*60*1000`); a dev override
(`window.__DASHBOARD_TEST_POLL_INTERVAL_MS__` or `?pollMs=` over http, clamped ≥1s) is
gated and ignored under file://. A boolean `requestInProgress` lock skips overlapping
polls (released in `finally`). One `pollTimer` only (cleared before re-creating; cleared
on `beforeunload`). Hidden tabs skip scheduled polls; returning visible triggers one
immediate check if the last success is older than the interval.

### 26.4 dataVersion / Last Checked / lastDataChange
Re-render happens on initial load or when `meta.dataVersion` changes; an unchanged poll
updates only metadata + Last Checked (no render, no chart recreation, no Three.js
re-init, no medallion rebuild, search/paging preserved). **Last Checked** is set ONLY
from a successful read's `meta.checkedAt` (never a timer, never "now − 5 min"); a failed
poll does not advance it. `lastDataChange`/`lastSuccessfulSync` are kept in state (not
shown in the top bar) and never set by the frontend. The old simulated 30-second
refresh timer is **disabled** (`simulateRefresh`/`stampLastUpdated` are dormant); the
wall clock still ticks independently.

### 26.5 States
- **loading**: server-hosted, awaiting first response — restrained "Loading…" in the
  refresh bar; data visuals (occupancy ring, medallions) deferred until data arrives;
  no embedded values shown as live.
- **live**: latest read succeeded; SQLite data shown; Last Checked = `checkedAt`.
- **degraded**: had data, a later poll failed — keep last view, subtle indicator (title
  tooltip + `data-conn`), Last Checked frozen, keep retrying.
- **error**: never loaded — controlled "Data unavailable" + capped-backoff retry
  (30s → ×2 → 5min).
- **demo**: embedded data, no network, no polling.
Connection status is reflected design-safely (existing refresh-bar text + tooltip +
`data-conn` on `#refreshBar`) — no new banners, colours, or layout; no visible badge was
added (deferred) to avoid altering the approved design.

### 26.6 Render lifecycle reuse
Data application calls the existing `renderTabs` + `renderProject` (which update both
Chart.js charts in place, call `occupancy.update`, re-render tenants/buildings, and
rebuild medallions) — charts/Three.js are created once and updated, never recreated per
poll. The particle-wave is data-independent and mounts once in all modes; occupancy +
medallions mount only after data (`__dashboardDataRendered` gate). `projects` became
`let` so the API payload can replace it; URL selection resolves the requested slug
against API projects (safe default if absent/invalid) and preserves it across data
changes.

### 26.7 Chart lifecycle & scaling fix (Phase 4 acceptance)
The two Chart.js mini charts are created **lazily on the first `renderProject`** —
i.e. AFTER `fitDashboard()` has scaled the root font-size AND after real (live or demo)
data exists — via `createLeasedAreaChart()` / `createTypeBreakdownChart()` (guarded, one
instance each). This fixes two regressions: (a) charts were previously built at module
load against the unscaled 1920px layout → **oversized/clipped**; (b) in live mode they
showed **embedded `projects[0]` data as if live** (and lingered if the API was slow/
failing). `resizeDashboardCharts()` snaps both instances to the rem-scaled container
after each render (via `requestAnimationFrame`), on genuine window resizes, and after
`document.fonts.ready` — instances are reused (`.resize()`/`.update()`), never recreated,
so there is no leak or duplicate. No canvas CSS overrides were added. In live mode no
render (and thus no chart) occurs until valid adapted API data arrives, so nothing
embedded is ever shown as live.

### 26.8 Live-mode empty-DB fix (auto-seed) & favicon
Runtime investigation (headless Edge + CDP) of the reported "live URL broken" showed
the frontend was **correct**: with data it renders fully (both tabs, real Last Checked,
occupancy, velocity, tenants). The failure was that `/api/dashboard` returned **503**
because the server's DB was **empty** → the frontend correctly entered the `error`
state ("Data unavailable", no tabs, dashes) and the retail/office cards showed only
static HTML placeholders. Root cause = **no data**, not a render bug.

Fix: `startServer()` now **auto-seeds the bootstrap data when the DB is empty**
(zero projects) right after migrations — idempotent, `source='seed'`, non-fatal on
failure, and never overwrites existing data (a future Monday sync replaces it). So a
plain `npm start` serves live data immediately. Also added `GET /favicon.ico → 204`
to remove the browser's incidental favicon 404 from the console.

Verified in real headless Edge on a FRESH empty DB: server auto-seeds (117 records),
`/api/dashboard` 200, **zero console errors/exceptions**, `mode:'live'`, 2 tabs
(Business Address + Town Center), Last Checked from `meta.checkedAt`, occupancy,
velocity, tenant directory (7/9 for BA, 16/40 for TC), and building/top-tenant data all
render; demo (`file://`) still renders with zero errors and no API call.

### 26.9 Known Phase 4 limitations / deferred to Phase 5
Compatibility-first: the frontend still runs its own `computeMetrics` for rendering
(backend `metrics` are provided and match; consolidating to a single source of truth is
Phase 5). No richer visible connection badge (kept design-safe). Monday client/mapping/
scheduler/stale-while-revalidate remain deferred.

---

## 27. PHASE 5 — STABILIZATION, API CONTRACT FREEZE & PHASE 6 PREREQUISITES

> **Status: Phase 5 complete.** The SQLite-backed dashboard (Phases 1–4) is validated
> end-to-end as one system and frozen for Monday mapping. No Monday code was added.

### 27.1 What Phase 5 verified (runtime evidence, not just static)
DB pragmas (FK on, WAL, synchronous NORMAL, busy_timeout 5000) + `foreign_key_check`
= 0 violations + 0 orphans + 0 duplicate migrations; migrations idempotent on a temp DB;
seed idempotent (identical reseed → same `dataVersion`, reused `last_data_change_at`;
changed fixture → new `dataVersion`, advanced `last_data_change_at`; removal affects only
`source='seed'`; `source='monday'` rows untouched); API read-only (10 reads → zero row
changes); `checkedAt` advances per read while `dataVersion`/`lastDataChange` stay stable;
metrics reconcile (BA 47.7% / 16 tenants, TC 51.0% / 56 tenants, all finite, % in range,
TC explicit `leasedPct` preserved); every private path (`/data`, `/server`, `/scripts`,
`/.env`, `/package.json`, `/CLAUDE.md`, `/.git`, `/archive`) → 404, allowed assets → 200;
headless-Edge live + demo render with zero console errors. `npm run verify` runs all
8 stages (5 checks + 3 test suites) cross-platform and stops on the first failure.

### 27.2 Phase 5 stabilization changes (small, scoped)
- `npm run verify` + `scripts/verify-phase-5.js` (non-destructive consolidated check).
- Unknown `/api/*` now returns a **JSON 404** (`{error:'not-found'}`) instead of text.
- Startup banner **classifies IPv4 addresses**: `LAN (private)` (192.168/10/172.16-31)
  vs `Other (VPN/virtual)` with the interface name, and recommends the private-LAN
  address for TV/kiosk URLs (VPN addresses kept but labelled, not removed).
- The `?pollMs` fast-poll dev override is now **gated to localhost/127.0.0.1 only**
  (never over the LAN/public host, never under file://) — a TV/kiosk cannot set a fast
  rate. Automated tests use `window.__DASHBOARD_TEST_POLL_INTERVAL_MS__`. Production
  default is exactly `5 * 60 * 1000`.
- `check-project.js` extended with Phase 5 invariants (now 102 checks).

### 27.3 FROZEN API CONTRACT (preserved by Phases 6–8)
Monday integration replaces the *source* behind this contract, not the contract itself.

`GET /api/dashboard` → `{ data, meta }`:
- **`data.projects[]`** — each: `slug` (stable), `project` (display name), `address`,
  `retail` & `office` `{ label, gla, leasedPct?, tenants[] }`, `buildings[]`
  `{ id, departments:{<code>:{label,leased,total}} }`, `metrics` (canonical).
  `tenants[]` items: `{ name, type, area, leaseDate?, logo? }`.
- **`meta`** — `source` (`'sqlite'`; bootstrap), `dataVersion` (stable hash),
  `checkedAt` (this read's time → drives "Last Checked"), `lastSuccessfulSync`,
  `lastDataChange`, `apiVersion` (1), `projectCount`.

`GET /api/sync/status` → `{ data:{ status, source, lastSuccessfulSync, lastAttemptedSync,
lastDataChange, dataVersion, recordCount, warningCount, syncInProgress:false }, meta }`.

Field stability:
- **Stable (frozen):** all `data.projects[]` fields above; `meta.dataVersion`,
  `checkedAt`, `lastSuccessfulSync`, `lastDataChange`, `source`.
- **Temporary/bootstrap:** `source='sqlite'` reflects seed data until Monday;
  `meta.lastDataChange`/`lastSuccessfulSync` derive from the seed `sync_run` today.
- **Optional / may extend at Monday:** `metrics` sub-fields may gain values;
  `syncInProgress` becomes meaningful; per-project trend/`performanceSummary` blocks may
  be added. Additions are **additive** — no field renames or removals.
- **Never exposed:** DB ids beyond `slug`, `source_record_key`, DB path, SQL, stack
  traces, env values, tokens.

### 27.4 Invariants (do not break in Phase 6+)
Tenant count = **lease-row** count (duplicates are separate leases, never merged).
Business Address occupancy = summed tenant areas; Town Center = explicit `leasedPct`
(retail 0.40 / office 0.69) with its tenant list a separate, **unreconciled** dataset
(the office explicit≈6,301 m² vs lease-sum≈5,272 m² mismatch is a preserved WARNING).
`performanceSummary` stays a global frontend mock (not yet per-project). One Node
process owns the DB. One poll timer, one retry timer; charts/Three.js created once and
updated in place; "Last Checked" only from a successful read's `checkedAt`.

### 27.5 PHASE 6 PREREQUISITES (information required from the user)
Monday code is NOT added yet. Before Phase 6 mapping begins, the user must provide:
- Monday account access + an API token (stored privately in `.env`, never committed);
- board ID(s); group IDs (if used); item / subitem structure;
- column IDs for: tenant name, category, area, total GLA, explicit occupancy %
  (if used), lease date, building, status, logo/image;
- project mapping (which board(s) → Business Address / Town Center);
- active/inactive (archived) status rules;
- **business decisions:** confirm tenant-count = lease rows; authoritative occupancy
  source per project; Town Center reconciliation decision; lease-date meaning
  (signed/commencement/handover); unknown-category behaviour.
These map onto the frozen contract without a frontend rewrite (§27.3).

---

## 28. MONDAY.COM INTEGRATION FOUNDATION (PHASE 6 — OFFLINE, NO CREDENTIALS)

> **Status: Phase 6 complete.** The COMPLETE Monday integration framework exists and is
> fully unit-tested OFFLINE. No token, no board IDs, NO network request is made. Sync is
> disabled by default and the client's transport is disabled. Phase 7 only needs to:
> (1) paste the API token into `.env`, (2) fill board/column IDs in
> `config/monday-mapping.json`, (3) set `MONDAY_SYNC_ENABLED=true` + inject a real
> fetch transport. No architectural work remains.

### 28.1 Layer (server/monday/)
`config.js` (all settings from `.env` + mapping file; nothing hardcoded; token never
on the public object) · `errors.js` (typed: Configuration/Authentication/Timeout/
RateLimit/Network/SchemaMismatch/Validation/Transform/Persistence/NetworkDisabled) ·
`logger.js` (structured, level-gated, **redacts secrets**) · `graphql.js` (query
builders; values only via GraphQL variables — no string concat) · `client.js`
(reusable client with retries/backoff+jitter/timeout/rate-limit/pagination; **transport
is injected and defaults to `disabledTransport` → no network in Phase 6**) ·
`adapters.js` (column-type coercers: text/long_text/numbers/status/dropdown/date/
timeline/people/checkbox/mirror/formula/relation/board_relation/files/location + safe
unknown-type fallback) · `mapper.js` (raw Monday items → canonical, via mapping +
adapters; the ONLY place with Monday knowledge) · `schema.js` (canonical model +
raw-shape checks) · `validator.js` (ERROR/WARNING/INFO; any ERROR rejects the whole
sync) · `transformer.js` (canonical → the exact nested repository model the seed uses)
· `diff-engine.js` (insert/update/delete/unchanged by external_id + content hash;
unchanged rows never rewritten) · `persistence.js` (atomic transactional writes,
source='monday', keyed by external_id; soft-delete missing; **isolated from
source='seed'**; rollback-all on error) · `sync-engine.js` (pipeline: download → map →
validate → transform → compare → persist → metadata → log → notify) · `index.js`
(barrel + `getMondayHealth`).

### 28.2 Configuration (all from `.env`; nothing hardcoded)
`MONDAY_API_KEY` (secret; Phase 7), `MONDAY_API_URL`/`MONDAY_API_VERSION`,
`MONDAY_MAPPING_FILE`, `MONDAY_WORKSPACE_ID`, `MONDAY_SYNC_ENABLED` (default **false**),
`MONDAY_DRY_RUN` (default true), `MONDAY_POLL_INTERVAL_MS` (hourly), request timeout,
retry count/base, rate-limit/min, max pages, batch size, `MONDAY_LOG_LEVEL`,
`MONDAY_ENV`. Board→column→canonical mapping lives in `config/monday-mapping.json`
(gitignored; copy `config/monday-mapping.example.json`, which uses `<...>` placeholders,
never real IDs). Column `id` must be the stable Monday COLUMN ID (never the title).

### 28.3 Canonical model = existing repository model
Monday data flows raw → mapper → canonical → transformer → **the identical nested
project model the seed produces** → repositories → SQLite → `/api/dashboard`. No
renderer ever sees a Monday object; no renderer contains mapping logic; all mapping
happens before persistence. The **API contract and frontend do not change** — Monday
just becomes another `source` behind the frozen contract. Monday leases persist with
`source='monday'` and `external_id` = the Monday item id (their stable identity;
`source_record_key` stays null). Metadata (`dataVersion`, `lastDataChange`) follows the
same policy as the seed, so `/api/dashboard`/`/api/sync/status` behave identically.

### 28.4 Offline guarantees (Phase 6)
`runSync()` short-circuits to `{status:'skipped'}` when not configured OR sync disabled
(the defaults) — before any download. The client's default transport throws
`NetworkDisabledError`. Tests exercise retry/backoff/rate-limit/pagination and the whole
pipeline by INJECTING an in-memory transport / `rawByBoard` fixtures — zero network.
`/ready` gained a `monday` block of BOOLEANS ONLY (syncEnabled, configValid,
environmentLoaded, repositoryAvailable, sqliteWritable, mondayConfigured, dryRun) — never
a token, board id, or path.

### 28.5 Tests / checks
`npm run test:monday` (27 tests: config, adapters, mapper, validator, transformer,
diff, client resilience, persistence incl. rollback + seed-isolation, sync pipeline
incl. skip/dry-run/reject, health). Wired into `npm run verify`. `check-project.js`
adds Phase 6 invariants (modules present, sync off by default, transport disabled, no
hardcoded token/IDs, mapping gitignored, /ready monday block). Backend/API/frontend
from Phases 1–5 are unchanged; the dashboard still reads SQLite exactly as before.

### 28.6 Phase 7 prerequisites (still required from the user)
API token (→ `.env` `MONDAY_API_KEY`), board IDs + column IDs (→
`config/monday-mapping.json`), project→board mapping, active/inactive rules, and the
business decisions from §27.5 (tenant-count, authoritative occupancy, Town Center
reconciliation, lease-date meaning, unknown-category behaviour). Phase 7 also injects a
real fetch-based transport into `MondayClient` and sets `MONDAY_SYNC_ENABLED=true`.

---

## 29. MONDAY PRODUCTION HARDENING (PRE-PHASE-7) — SOURCE OWNERSHIP & SAFETY

> **Status: hardening complete (still offline, no credentials, no production write).**
> Fixes the source-cutover, safety, status, GLA and dataVersion risks so a real token +
> mapping can be connected safely in Phase 7. Migration 003 (`current_data_source` +
> richer `sync_runs`) was added; migrations 001/002 were NOT edited.

### 29.1 Source ownership & cutover (the core fix)
`projects.current_data_source` ('seed' | 'monday' | 'manual-import', default 'seed') is
the AUTHORITATIVE source the dashboard reads, distinct from a row's provenance `source`.
The dashboard service selects leases `WHERE source = current_data_source` — so seed and
Monday leases NEVER count together. A successful Monday sync writes Monday rows and, in
the SAME transaction, sets `current_data_source='monday'` (the cutover). Seed leases are
PRESERVED (never deleted), so seed fallback stays recoverable
(`setCurrentDataSource(db, id, 'seed')` — dev/emergency only, no public endpoint). v1
source policy: **leases** are source-partitioned + cut over; **project/category** rows
are shared and updated in place (GLA never null/0 over a valid value); **buildings/
departments** stay MANUAL/seed (`buildingSource:'manual'`) and Monday never touches them
(lease `buildingRef` is diagnostic, not persisted to `building_id` in v1).

### 29.2 Total-GLA safety
Category total GLA must have an EXPLICIT source: a config constant (`totalArea`, finite
≥0, zero allowed) OR `totalAreaSource:'preserve-existing'`. It is NEVER defaulted to 0.
The validator rejects a missing/negative GLA before any write; persistence preserves the
stored value on `preserve-existing` and never overwrites a valid total with null/0.

### 29.3 Canonical status + active rules (`server/monday/status.js`)
Monday labels → canonical statuses (active/future/terminated/cancelled/expired/draft/
unknown) via the board `statusMap`. Only `active` counts as current-state → `is_active=1`;
all others → `is_active=0`. **Unknown status is a validation ERROR — never silently
active.** Status is stored and drives inclusion centrally (not scattered). `is_active`
and canonical status are in the change-hash + dataVersion, so a status change updates the
dashboard and the version.

### 29.4 Last-known-good safety (`server/monday/safety.js`)
Per-board `safety` (or env defaults): `allowEmpty` (default false), `minAcceptedRecords`,
`maxRecordDropPercent` (default 50). An empty board that previously had data, too few
rows, or a >N% collapse REJECTS the sync (data preserved, a `rejected` sync_run recorded)
— unless an explicit override or `allowEmpty`. The first cutover (prevSource seed/none)
skips the drop rule (a legitimate difference), keeping only empty/min guards.

### 29.5 Required boards + complete-fetch gate
Enabled+required boards must be present in the fetch, and every board fetch must have
`complete=true` (pagination reached the end, dedupes by item id, rejects a repeated
cursor). A missing required board or an INCOMPLETE fetch REJECTS the sync — records are
never deactivated from a partial page. Disabled boards (`enabled:false`) are ignored.

### 29.6 Atomic persistence & diff
All writes for one sync are ONE `better-sqlite3` transaction (commit-all / rollback-all;
network happens before the transaction). The diff engine keys on the stable Monday item
id (`external_id`), handling duplicate names, category/area/date/status changes, and
absences; a no-change sync (candidate dataVersion == current) writes nothing and records
`no_change` (preserving `lastDataChange`). Deactivation only happens after a complete,
valid full-board fetch.

### 29.7 Production fetch transport (`server/monday/transport.js`)
Real HTTPS POST via built-in `fetch` + `AbortController`, token from env only, never
logged, GraphQL-error/HTTP-status/auth/rate-limit classified by the client (retries with
backoff+jitter; no retry on auth). It is NOT auto-wired: the client still defaults to the
disabled transport, and the server never injects it at startup. It is used only by the
explicit read-only CLIs and (Phase 7) the gated manual sync. Fail-closed without a token.

### 29.8 Tooling (all read-only / offline; no production write)
`npm run monday:mapping:check` (production; rejects placeholders) / `:check:draft`
(offline, warns) · `monday:inspect-board -- <id>` (metadata: groups/columns/types) ·
`monday:inspect-sample -- <id> [n]` (tiny redacted sample) · `monday:dry-run` (full
pipeline, live-read-only if creds else offline fixture; ZERO writes) ·
`monday:mapping:validate-live` (column-id drift vs live boards) · `monday:sync` (gated —
refuses production writes until Phase 7) · `monday:ready` (final production gate; fails
"Monday token not configured" now). `/api/sync/status` now includes safe per-project
`currentSource`; `/ready` includes Monday booleans.

### 29.9 Tests / verify
Monday tests: 44 (36 offline unit/rules + 8 seed→Monday cutover integration, temp DBs).
`npm run verify` runs 12 offline stages (db/seed/api/static checks + all test suites +
mapping draft check + dry-run) — no token, no network, no destructive writes. Windows:
all commands run via `node`/`npm.cmd` cross-platform; the DB-backed Monday tests were
executed on the Windows dev machine.

### 29.10 Phase 7 prerequisites (unchanged intent; now gated by `monday:ready`)
Real API token (→ `.env`), board + column IDs (→ `config/monday-mapping.json`), status
labels, per-category total-GLA source, and the business decisions from §27.5. Then:
inject the real transport, set `MONDAY_SYNC_ENABLED=true`, pass `monday:mapping:check` +
`monday:mapping:validate-live` + `monday:ready`, and run the (still CLI-only) gated sync.

---

## 30. MONDAY.COM ENABLED (PHASE 7) — LIVE, READ-ONLY-AGAINST-MONDAY

> **Status: Phase 7 enabled and verified against the two live boards.** The existing
> Monday layer was configured and completed (no rebuild). Monday access is read-only
> (no mutations); SQLite is written atomically with source cutover. Auto-sync stays OFF
> by default — a real sync is a gated, CLI-only, `--confirm` action.

### 30.1 Environment loading & token variable
`.env` is loaded at startup by `server/config/load-env.js` (zero-dependency, CommonJS)
— required as the first line of `server.js` and every `scripts/monday/*` CLI. It never
overrides already-set env vars (external/CI injection wins) and is a no-op if `.env` is
absent. Canonical token var is **`MONDAY_API_KEY`**; `MONDAY_API_TOKEN` is a deprecated
alias (`config.js` falls back to it and emits a one-time, value-free warning). The token
is read from env only, never on the config object (non-enumerable), never logged/echoed.

### 30.2 Board mapping (`config/monday-mapping.json`, gitignored)
Real board IDs live in the mapping JSON (NOT env): Town Center `5091991928`, Business
Address `5094617763`. Both boards share the same schema, discovered via the read-only
`monday:inspect-board`/`inspect-sample` tools:
- **Category comes from the item GROUP**, not a column → `categorySource:'group'` +
  `groupMap:{ topics:'retail', group_title:'office' }` (new, backward-compatible mapper
  feature; the GraphQL item selection now includes `group { id title }`).
- Columns: tenant `text_mm0p473d`, type `dropdown_mm0pbwg3`, area/GLA `numeric_mm0pevnb`,
  lease date `date_mm0pp64x` (Lease Start), status `status`.
- **statusMap:** `Leased`→active, `Vacant`→terminated. Vacant units are stored
  `is_active=0` and excluded from tenants/occupancy (the item's unit-code name provides a
  non-empty fallback so validation passes; only active leases require a tenant name).
- Category GLA is **config-sourced** (TC 14850/9132, BA 1892/11267 m²);
  `occupancySource:'leases'` → occupancy computed from real leased units.
- `buildingSource:'manual'` (buildings/departments remain seed; Monday never touches
  them; lease `buildingRef` is not persisted in v1 and is excluded from the change-hash).

### 30.3 Verified live behaviour
`monday:mapping:check` (production) OK; `monday:mapping:validate-live` OK (all 5 columns
resolve on both boards). Live dry-run: TC 129 items (72 active), BA 40 items (18 active),
0 validation warnings, zero writes. Real sync: **+169 inserted, atomic CUTOVER → monday**
for both projects; seed leases PRESERVED (72, recoverable); a second sync = `no_change`
(no duplicate writes). `/api/dashboard` now serves Monday data (BA 18 tenants / 46.6%
overall; TC 72 tenants / 69.5% overall); `/api/sync/status` shows both projects
`currentSource:'monday'` + `lastSuccessfulSync`. No secret is exposed anywhere.

### 30.4 Occupancy-source note (business confirmation still recommended)
Town Center's seed used an explicit `leasedPct` (0.40/0.69); the live Monday source now
computes occupancy from real leased units (`occupancySource:'leases'`) against the
config GLA. This replaces the mock percentage with real data (not a silent
reconciliation). Confirm the authoritative GLA/occupancy basis per project with the
business before relying on the exact percentages.

### 30.5 Running a sync (CLI-only, gated)
`npm run monday:inspect-board -- <id>` / `monday:inspect-sample -- <id> [n]` (read-only
metadata/sample) → `npm run monday:mapping:check` → `monday:mapping:validate-live` →
`npm run monday:dry-run` (offline; set `MONDAY_DRYRUN_LIVE=true` for live read-only) →
real write: `MONDAY_SYNC_ENABLED=true MONDAY_DRY_RUN=false npm run monday:sync -- --confirm`.
The server itself never auto-syncs (no scheduler; `MONDAY_SYNC_ENABLED` default false),
so `/api/dashboard` serves the last committed SQLite data. There is no LAN write route.

---

## 31. PHASE 8 — LIVE DASHBOARD DATA COMPLETION & VALIDATION

> **Status: Phase 8 complete.** No backend rebuild, no second client/server/DB/API. This
> phase audited every data-driven element for a hidden dependency on embedded/mock values
> in LIVE mode, fixed the ones found, hardened live-data safety, and preserved the
> frontend appearance exactly (no colours/fonts/layout/Three.js/chart-style changes). All
> changes are in `Project Dashboard.html` + tests; the backend/API were already correct.

### 31.1 Live vs demo (unchanged contract)
`isDemoMode()`: `file://` (or `?mode=demo`) → **demo** (embedded `projects[]`, no network,
mock Performance Summary retained). Otherwise → **live**: same-origin `GET /api/dashboard`,
5-min polling, dataVersion-gated re-render, `Last Checked` from `meta.checkedAt`, and the
degraded/error/loading states. There is **no** silent live→demo fallback; embedded values
are never shown as live (live defers all data rendering to the first API success).

### 31.2 Fixes made (frontend-only, minimal, visually preserving)
1. **Top Tenants — safe DOM + normalized identity.** `renderTopTenants` no longer
   string-interpolates the untrusted Monday tenant name/logo into `innerHTML` (was an XSS
   vector); it builds the identical markup via `createElement`/`textContent`/`setAttribute`.
   `computeTopTenants` now groups by the SAME `normalizeTenantName` the directory uses
   (NFKC + trim + whitespace-collapse + case-fold), carrying a clean display name — so
   `"Al  Tamimi"` and `"Al Tamimi"` rank as one organisation (no fuzzy matching). Raw
   arrays are never mutated.
2. **Performance Summary — DEMO-ONLY mock.** In live mode `renderPerformanceSummary`
   renders a safe "unavailable" state (neutral glyph + `—` + "Awaiting historical data")
   using the existing `.perf-item` structure — no banner, no new colours/layout. The mock
   deltas remain only in demo mode. Real deltas need historical snapshots (Phase 9).
3. **Occupancy-breakdown by type — "Unspecified".** `leasedAreaByType` maps blank/missing
   tenant `type` to `"Unspecified"` (never folded into a real type or the retail/office
   asset group), with a finite-area guard.
4. **NaN safety.** `sumAreas` skips non-finite areas so a single malformed value can never
   turn a KPI/chart into `NaN`. (The directory keeps its stricter `parseTenantArea`.)

### 31.3 Calculation rules (authoritative)
Backend `dashboard-service.computeMetrics` and the frontend `computeMetrics` mirror each
other and reconcile (BA 46.6%, TC 69.5%). The frontend renders from its own recompute; the
API also returns a canonical `metrics` block (same values) — consolidating to one source is
a future step (they agree today).
- **leased area** = Σ valid active lease areas in the authoritative source for that
  project/category (or `gla × leasedPct` when a category supplies an explicit fraction —
  currently none do in live Monday).
- **vacant area** = `max(totalGLA − totalLeased, 0)` (clamped ≥ 0; a leased > GLA situation
  is surfaced as >100% category %, not hidden, and the backend validator warns on it).
- **leased %** = `leased / GLA × 100`; **overall %** = `Σleased / ΣGLA × 100` (zero-GLA →
  0, never divide-by-zero / NaN).
- **GLA** is authoritative from config (`config/monday-mapping.json` `categories[].totalArea`
  — BA 1892/11267, TC 14850/9132), never derived from the tenant list in live mode.
- **Leasing velocity** = m² whose **lease date falls in the last 90 days ÷ 90** (m²/day),
  per category. The date field is Monday **"Lease Start"** (`date_mm0pp64x`). **Live mode
  uses only real Monday dates** — `assignMockLeaseDates()` is demo-only; live leases with no
  date are simply excluded (never mock-filled), and future dates fall outside the window.
- **Tenants KPI** = **lease-row count** (active leases in the authoritative source;
  duplicates are separate leases) — a preserved invariant, unchanged.
- **Top Tenants** = top 3 by summed area after **normalized-name** grouping across both
  categories (see 31.2). **Tenant Directory** = one row per normalized name within a
  project+category, areas summed, retail/office and the two projects never combined.

### 31.4 Live-data coverage
| Element | Live source | Live? | Notes |
|---|---|---|---|
| Project name / address / tabs | API | ✅ | textContent (safe) |
| Retail/Office GLA, %, bars | API (config GLA + Monday leases) | ✅ | |
| Occupancy ring + % + CSS fallback | API | ✅ | matches API `metrics` |
| Portfolio stats (GLA/leased/vacant/tenants) | API | ✅ | tenants = lease rows |
| Leased-area & type-breakdown charts | API | ✅ | type blank → "Unspecified" |
| Tenant Directory (+ search) | API | ✅ | normalized aggregation, safe DOM |
| Top Tenants | API | ✅ | normalized identity, safe DOM |
| Leasing velocity | API (Monday "Lease Start") | ✅* | *TC: 39/72 leases lack a date → excluded (not fabricated); real but partial |
| Last Checked / connection state | API `meta.checkedAt` | ✅ | |
| **Performance Summary** | — | ❌ **pending** | needs historical snapshots; demo-only mock, live shows "unavailable" |
| **Building occupancy** | SQLite **manual/seed** | ❌ **pending** | `buildingSource:'manual'` — Monday has no building mapping; panel kept + marked pending (persisted manual data, not fabricated). Requires a business decision on a Monday building/group/column mapping. |

### 31.5 Consistency report (live, dataVersion `bc4580…`)
- **Business Address:** Retail GLA 1892 · Office GLA 11267 · Total 13159 m²; Retail leased
  742.23 · Office leased 5387.45 · Total leased 6129.68; Vacant 7029.32; **overall 46.6%**;
  18 lease rows / **7 unique tenants**; directory rows 4 retail + 3 office; top tenant
  **Malath 4,596.91 m²** (Offices; 0 in Retail); 7 buildings (manual). Invalid area 0 ·
  missing date 0 · future dates 12 · blank type 0 · unknown status 0.
- **Town Center:** Retail GLA 14850 · Office GLA 9132 · Total 23982 m²; Retail leased 9803 ·
  Office leased 6853.01 · Total leased 16656.01; Vacant 7325.99; **overall 69.5%**; 72 lease
  rows / **24 unique tenants**; directory rows 15 retail + 9 office; top tenant **Al Tharwah
  Insurance Company**; 7 buildings (manual). Invalid area 0 · **missing date 39** · future
  dates 12 · **blank type 39** (→ "Unspecified") · unknown status 0.

### 31.6 Pending / deferred (not fabricated)
- **Performance Summary** deltas and any month/quarter trends — need **historical
  snapshots** (the `dashboard_snapshots` table exists but is unused). Phase 9.
- **Building occupancy** — needs a Monday building/group mapping (do not guess from tenant
  names). Business decision.
- **Velocity date semantics** — confirm "Lease Start" is the intended velocity date
  (vs contract-start/handover) with the business.
- **Single source of truth** — frontend still recomputes metrics (they match the API
  `metrics`); consolidation deferred.
- Device/TV performance optimization (particle/pixel-ratio/quality) → **Phase 8.5**;
  visual polish → **Phase 9**.

### 31.7 Tests
`tests/frontend/phase8-live-data.test.js` (11 tests: Top Tenants identity + XSS-safe DOM,
type "Unspecified", metrics NaN/zero-GLA/vacancy/decimal safety, Performance Summary
live-unavailable vs demo-mock) — wired into `npm run verify` (`test:frontend` now 42).
Backend contract + no-secret checks (`api:check`, `test:api`) and source-partition /
cutover tests (`test:monday`, integration) are unchanged and still green. **Troubleshooting:**
stale server HTML → the server `sendFile`s `Project Dashboard.html` with `no-cache`, so a
hard refresh always gets the latest; stale data → re-run the gated `monday:sync` (§30.5);
never commit `.env`.

---

## 32. PHASE 8 (BUILDINGS) — LIVE UNIT→BUILDING ALLOCATION

> **Status: complete.** "Portfolio Occupancy by Building" is now LIVE for both projects,
> derived from current Monday unit codes via an authoritative, project-specific mapping.
> No backend rebuild, no second API, no frontend/design change (buildings still arrive via
> `/api/dashboard` in the same shape; the frontend renderer is untouched). Demo (file://)
> keeps its embedded manual buildings.

### 32.1 What changed & where
- **`leases.unit_code`** (migration **004**, additive/nullable) persists the Monday item
  name (the unit code, e.g. `(A-GF-R01)` / `C04` / `D101`). Captured in `mapper.js`,
  carried through `transformer.js`, hashed in `diff-engine.js` (`LEASE_HASH_FIELDS`, so a
  unit-code change bumps `dataVersion`), written by `persistence.js`. Seed rows leave it
  NULL. `SCHEMA_VERSION` → 4.
- **`server/buildings/building-mapping.js`** — the SINGLE source of truth:
  `normalizeUnitCode` (NFKC, trim, strip one surrounding paren pair, uppercase,
  collapse ws), `parseTownCenterBuilding` (first letter **A–G → Building 1–7**),
  `BUSINESS_ADDRESS_UNIT_TO_BUILDING` (explicit lookup) + `BUSINESS_ADDRESS_EXCLUDED`
  (`C06`/`C07`), `expectedCategoryForUnit` (report-only).
- **`server/buildings/building-allocation.js`** — `allocateBuildings(slug, leases)` →
  `{ buildings, diagnostics }`. total GLA = Σ valid GLA of included units (any status);
  leased = active-status units; vacant = total−leased; occupancy = leased/total×100
  (0 when total 0). Dedup by `externalId`; dept keys `retail`/`offices`; TC outputs 1–7,
  BA 1–5. Diagnostics: unassigned, excluded (C06/C07), prefixes, category mismatches,
  duplicate ids, missing/invalid GLA, unknown status, per-building totals.
- **`dashboard-service.js`** — for `current_data_source==='monday'` the payload buildings
  come from `allocateBuildings` (using ALL Monday leases: vacant units count toward total);
  for `seed` it keeps the manual `buildings`/`building_departments` tables (demo/seed).

### 32.2 Authoritative rules (do not change without a new truth guide)
- **Town Center:** the first unit-code letter `A–G` = Building `1–7`. Category comes from
  the Monday **group** (never inferred from GF/FF/SF). Trailing notes / `Outdoor` suffixes
  do not affect detection.
- **Business Address:** an **explicit lookup table** (Excel truth guide) — never a
  last-digit/pattern fallback. Buildings **1–5 only**. **C06/C07 are intentionally
  excluded** from building allocation (their raw lease records are PRESERVED — not deleted
  or archived — and still count in every other dashboard calc). An unknown code stays
  unassigned + reported.
- **Category is Monday-authoritative for allocation.** A truth-guide-vs-Monday category
  mismatch is REPORTED (never moved by inferring from the code) and the unit is still
  allocated to its Monday department so the building total stays complete.

### 32.3 Live validation (dataVersion `86441bbea561`)
- **Town Center:** 129 units inspected, 129 valid GLA, 129 assigned, **0 unassigned**,
  0 excluded, prefixes A–G (20/6/6/25/25/24/23), 0 category-mismatch / 0 duplicate /
  0 missing-GLA / 0 unknown-status. **Buildings 1–7.** (e.g. B1 8626/7808/90.5%,
  B7 3364.42/2376/70.6%.)
- **Business Address:** 40 units inspected, **38 valid+assigned**, **C06 & C07 excluded**,
  0 unassigned, 0 duplicate / 0 missing-GLA / 0 unknown-status, **1 category mismatch:
  `S01`** (truth guide Retail, Monday Offices → allocated to Offices per Monday-authoritative
  rule, reported for resolution in Monday). **Buildings 1–5 only** (no 6/7). (e.g.
  B1 4824.41/3565.96/73.9%, B5 506.88/183.45/36.2%.)

### 32.4 Notes
- Live vs demo: live buildings from allocation; demo keeps embedded 7-building data.
- Persistence never writes Monday-sourced building rows (`buildingSource:'manual'`); the
  manual tables are untouched — allocation happens at read time in the serializer.
- Tests: `tests/buildings/building-allocation.test.js` (42) + `building-integration.test.js`
  (6) → `npm run verify` stage `test:buildings`. **Open item:** resolve `S01`'s category on
  the Monday board (Retail vs Offices) — a data decision, not a code fix.

---

## 33. PHASE 8.5 — ADAPTIVE PERFORMANCE / OLD-TV COMPATIBILITY / STABILITY

> **Status: complete.** A centralized quality controller lets the SAME server URL adapt
> its visual cost to the device: capable machines get the full experience; weak
> computers / old Smart TVs automatically get a lighter version that keeps ALL live data,
> cards, KPIs, charts, tenant directory, building occupancy, search, polling and layout.
> No data/calculation/mapping/API/layout change. No new deps. Frontend-only.

### 33.1 Modes (`data-quality` on <html>)
- **full** — today's exact look: particle-wave 220×130 (28,600 pts, PR≤1.5, AA on),
  occupancy WebGL (PR≤2), 3 WebGL tenant medallions, chart anim 600ms, panel float on.
- **reduced** — visually similar, lighter: particle-wave 132×78 (10,296 pts, PR≤1.0, AA
  off), occupancy WebGL (PR≤1.25), medallions rendered as flat DOM (logo image or
  initials — same size/content, no per-medallion WebGL), chart anim 250ms, panel float
  off. WebGL contexts 5→2.
- **static** — no continuous WebGL: particle-wave **not** initialized (the CSS ground
  gradient shows), occupancy uses the existing **CSS conic-ring fallback** (accurate %),
  medallions flat DOM, chart anim 0ms, panel float off. WebGL contexts → **0**. All data,
  cards, tabs, clock, Last Checked, polling and tenant paging remain fully functional.

Data, layout, card positions, colours, fonts, chart colours and the occupancy meaning are
**identical in every mode** (verified: occupancy %, tenant count, buildings, directory
rows and Top Tenants match byte-for-byte across full/reduced/static).

### 33.2 Resolution (precedence) & controller
`?quality=full|reduced|static` (manual, wins) → fresh `localStorage['dashboard-quality-v1']`
(≤7 days) → **auto**. Auto: no-WebGL→static; `prefers-reduced-motion`→reduced; else start
**reduced** and run a bounded ~1.5s rAF startup probe that upgrades→full when frames are
clearly healthy (median ≤20ms & p95 ≤34ms) or downgrades→static when clearly poor
(median ≥42ms); medium stays reduced. Invalid `?quality` → auto. A requested `full` with no
WebGL degrades to static. One canonical controller (`qualityConfigFor`, `detectQualityCapabilities`,
`resolveInitialQuality`, `applyQualityMode`, `runStartupProbe`, `scheduleRuntimeMonitor`,
`handleContextLoss`); all visual code reads the resolved `QUALITY` config — no scattered
`deviceMemory`/userAgent checks.

### 33.3 Runtime monitor & anti-oscillation
Auto only: a short bounded ~2s frame sample every 60s; on sustained poor (median ≥45ms) it
performs **one** downgrade (full→reduced→static), then waits ≥120s before any further
change and **never auto-upgrades** (no oscillation). Manual modes are sticky (no auto
change). Switching modes never reloads and preserves project, search, data, Last Checked,
and connection state; only the affected visuals rebuild (charts update animation in place).

### 33.4 URL / storage / reset / capabilities / WebGL loss
- Override examples: `?quality=static`, `?project=town-center&quality=reduced` (other params
  preserved). **Remove** the override by deleting `&quality=…`. **Reset** the stored auto
  result: `localStorage.removeItem('dashboard-quality-v1')` (or open `?quality=auto`).
- Capability hints (never sole basis): WebGL/WebGL2 creation, hardwareConcurrency,
  deviceMemory, devicePixelRatio, prefers-reduced-motion, saveData. Missing APIs → start
  conservatively (reduced). No "TV in userAgent" classification. Corrupt/failed localStorage
  is ignored without crashing.
- **WebGL context loss** (`webglcontextlost`) on the wave/occupancy canvases → prevented,
  logged once, and the dashboard falls back to **static** (no reload, no data loss).
- **Dev diagnostics:** `?qualityDebug=1` on **localhost only** shows a tiny overlay
  (mode/reason/caps/particles/canvases/probe fps). No secrets, no data, off in production.

### 33.5 Baseline vs modes (measured, headless Edge `--disable-gpu` = software-GL proxy)
Baseline full mode: 7 canvases / 5 WebGL contexts, ~24 fps median-41ms under software GL.
Per mode (BA): full 7 canvases (5 WebGL, 3 WebGL medallions); reduced 4 canvases (2 WebGL,
DOM medallions); static 3 canvas elements (0 WebGL — unused wave element + 2 Chart.js 2D
canvases). Canvas/renderer count is stable across 20 project switches and 8 quality-mode
cycles (0 exceptions); DOM stable (304) across project switches. Real-GPU FPS was not
benchmarked headlessly (software GL only). **Physical old-TV / TCL testing was NOT
performed** (no device access) — static mode is designed for it but is unverified on
hardware.

### 33.6 Tests / docs
`tests/frontend/quality-controller.test.js` (14: resolution, config, URL+project coexist,
override precedence, localStorage safety/corruption/failure, reduced-motion, capability
fallbacks, no-WebGL→static) → `npm run verify` (`test:frontend` now 56). Data-regression is
covered by the existing Phase 8 suites (unchanged + green). Deferred: on-hardware TV
validation; optional finer FPS-cap in reduced mode.

---

## 34. PHASE 9.1A — HISTORICAL DATABASE & SNAPSHOT ENGINE

> **Status: complete (backend-first foundation).** A manually-executable snapshot engine
> that captures the CURRENT authoritative dashboard state into immutable, per-business-date
> historical tables. **No automatic scheduler**, **no historical UI**, **no history API**
> yet (those are Phase 9.1B). `/api/dashboard`, Monday sync, live/demo behaviour, and all
> existing tests are unchanged.

### 34.1 Architecture (dependency flow)
`dashboard-service` (live calc, authoritative) → `snapshot-builder` (pure) → `snapshot-validator`
→ `history-repository` (transactional persist + audit) → `capture-orchestrator` → `scripts/history-snapshot.js` (CLI).
The live dashboard does NOT depend on the history layer. Modules live under `server/history/`
(`constants`, `riyadh-date`, `live-metrics`, `eligibility`, `snapshot-builder`,
`snapshot-validator`, `history-repository`, `capture-orchestrator`).

### 34.2 Tables (migration 005, additive; schema v5)
`historical_snapshot_runs` (audit of every attempt) → `historical_project_snapshots`
(parent, **UNIQUE(project_key, business_date)**) → `historical_building_snapshots`
(**UNIQUE(project_snapshot_id, building_key)**, FK CASCADE) + `historical_tenant_snapshots`
(**UNIQUE(project_snapshot_id, tenant_key)**, FK CASCADE). FKs enforced (WAL, busy_timeout
5000 inherited). Percentages stored **0–100** (matches `metrics.*Pct`); areas REAL m²
rounded to 2 dp; dates/timestamps ISO-8601 TEXT; booleans INTEGER 0/1. CHECK constraints
guard hard invariants only (non-negative areas/counts/occupancy, non-empty project key);
business bounds (occupancy 0..100, leased≤GLA) are enforced by the validator, not the DB.

### 34.3 Riyadh business date
`server/history/riyadh-date.js` derives the civil date in **Asia/Riyadh** (UTC+3, no DST)
via `Intl` — never a UTC slice, never server-local. `captureContext(now)` →
`{ capturedAtUtc, businessDate (YYYY-MM-DD), timezone }`. Tested around midnight, year
boundary, and leap day with fixed clocks.

### 34.4 Source eligibility (blocks demo/seed history)
Only a project with `current_data_source === 'monday'` **and** a `meta.dataVersion` is
eligible. Seed/bootstrap (`'seed'`) and any missing/invalid source are INELIGIBLE — never
stored as production history. Dry-run may inspect ineligible data but reports
`eligible:false` and never writes.

### 34.5 Metric definitions (reuse live logic — no second formula)
- Project totals/occupancy come verbatim from the live `metrics` (dashboard `computeMetrics`,
  0–100). Vacant = `max(GLA − leased, 0)`.
- **Buildings** reuse the shared `allocateProjectBuildings` (same code path as
  `/api/dashboard`; a test asserts no drift). Town Center A–G → Building 1–7; Business
  Address explicit lookup; **C06/C07 excluded from building allocation only** — their lease
  records are preserved and still counted in project totals/unit counts.
- **Tenant aggregation** mirrors the live Tenant Directory / Top-Tenants: group by the same
  `normalizeTenantName` (NFKC+trim+collapse+casefold) across both categories, sum valid
  areas, rank by area desc, tie-break normalized name asc (sequential ordinal; top-3/5/10
  flags). `tenant_count_raw` = active lease rows (live invariant); `tenant_count_aggregated`
  = unique normalized tenants.
- **Leasing velocity** = active leases whose Lease Start falls in the rolling 90-day window
  ending at the capture instant, inclusive of both ends and today. Stored as 90-day TOTALS
  (`leasing_velocity_area_90d`, `leasing_velocity_lease_count_90d`); daily rate = total ÷ 90.
- Unavailable/untrustworthy metrics are stored NULL, never faked. `calculation_version`
  = `historical-calculations-v1`, `schema_version` = 1.

### 34.6 Validation / duplicate / immutability
Validator blocks (ERROR) missing keys, negative areas, occupancy outside 0–100, leased
materially > GLA, duplicate building/tenant keys, non-finite values, bad source, invalid
timestamps/dates; WARNINGs (unassigned units, excluded C06/C07, zero-area building, empty
categories) are recorded and allow persistence. Duplicate = one snapshot per project per
Riyadh date, enforced by the UNIQUE constraint (final race guard) → clean
`duplicate_skipped` (no overwrite, `INSERT OR REPLACE` never used). Snapshots are
**immutable** — never updated/refreshed after a later sync. All rows for one snapshot are
one atomic transaction (child failure → full rollback, no partial parent); each project
snapshot is independently atomic (one failure never destroys another's snapshot).

### 34.7 Manual CLI (§17) — no server, no scheduler, no Monday sync
```
npm run history:snapshot:dry-run                         # dry-run all projects (no writes)
node scripts/history-snapshot.js --project town-center --dry-run
npm run history:snapshot                                 # write all eligible projects
node scripts/history-snapshot.js --project business-address
node scripts/history-snapshot.js --list                  # recent snapshots + runs (read-only)
  flags: --json (machine output), --debug (full dry-run payload)
```
Exit codes: **0** = completed (incl. duplicate skips / ineligible / dry-run); **1** =
validation failure, unexpected failure, or invalid argument. The CLI opens the DB, runs
migrations (idempotent), captures, prints a concise/JSON report, closes the DB, and exits —
it never starts Express, polling, or a sync. Write-mode attempts are audited in
`historical_snapshot_runs`; dry-runs are logged only (not persisted).

### 34.8 Error codes
`SOURCE_INELIGIBLE`, `PROJECT_NOT_FOUND`, `SNAPSHOT_VALIDATION_FAILED`,
`SNAPSHOT_DUPLICATE`, `SNAPSHOT_PERSISTENCE_FAILED`, `MIGRATION_FAILED`, `DATABASE_BUSY`,
`INVALID_CLI_ARGUMENT`.

### 34.9 Security / operations
No token/secret is ever stored in history tables, CLI output, or logs (verified); all SQL
uses bound parameters; tenant names are data, never SQL; no public snapshot-write endpoint;
no arbitrary business-date override in production (`forceBusinessDate` is test-only). **Back
up `data/dashboard.db` before running migrations.** Capture is fast (~20 ms both projects;
~3 ms one) and adds nothing to `/api/dashboard`.

### 34.10 Tests & limitations
`npm run test:history` (31: timezone, migration, builder/validator/persistence/orchestrator
incl. rollback + concurrent-duplicate + demo-ineligible, CLI) — wired into `npm run verify`.
**Current limitations (by design):** no scheduler, no history read API, no historical UI, no
trend/period-over-period calculations, no backfill of prior dates (first snapshot = today
only). **Next: Phase 9.1B** — automatic scheduler + historical read APIs.

---

## 35. PHASE 9.1B — AUTOMATION, RECOVERY, POST-SYNC & HISTORICAL READ APIs

> **Status: complete.** Turns the 9.1A manual foundation into an automated daily collector
> + read-only historical APIs. Reuses the 9.1A orchestrator/builder/validator/repository
> as the single source of truth — the automation layer decides WHEN, 9.1A decides HOW.
> `/api/dashboard`, Monday sync, live/demo, quality modes and all prior tests are unchanged.

### 35.1 Conservative data-integrity rule (critical)
The live source is a single CURRENT dataset with no per-date historical states, so automation
can only legitimately snapshot the **current Riyadh business date**. Recovery = "catch up
TODAY if the scheduled time has passed and today isn't captured." Prior missed days are
**reported unrecoverable, never fabricated** from current data. No backfill, ever.

### 35.2 Architecture (dependency direction preserved)
trigger (scheduler / startup-recovery / post-sync / manual CLI) → shared **runner**
(`snapshot-runner`) → **execution coordinator** (`execution-lock`) → 9.1A
`capture-orchestrator` (owns source eligibility, building/tenant/velocity, validation,
duplicate, audit). New modules under `server/history/automation/` (`automation-config`,
`execution-lock`, `snapshot-runner`, `snapshot-scheduler`, `post-sync`) + `server/history/`
(`query-repository`, `history-routes`). Scheduler never computes metrics, never writes rows
directly, never queries Monday.

### 35.3 Scheduler & Riyadh clock (§4,§5,§6)
One timer for the next **Asia/Riyadh** daily time (`HISTORY_SNAPSHOT_TIME`, default 02:00) —
computed via `riyadh-date.nextScheduledInstant` (Intl offset, no hardcoded +3), never a bare
24h interval; reschedules after every run; a failed job never crashes the server; timer is
`unref`'d and cleared on shutdown. `start()`/`stop()` idempotent (no duplicate timers).
Integrated into `server.js` startup (after migrate/seed) and the existing SIGINT/SIGTERM
graceful-shutdown (scheduler stopped before `server.close`). Snapshot date (Riyadh business
date) and created-at (UTC write instant) are stored as distinct concepts.

### 35.4 Concurrency — defense in depth (§12)
(1) in-process mutex; (2) DB lock `historical_execution_locks` (migration 006) — atomic
acquire via INSERT, owner-checked release, stale takeover only after
`HISTORY_LOCK_TIMEOUT_SECONDS` via a guarded UPDATE; (3) the 9.1A `UNIQUE(project_key,
business_date)` constraint (final guard). A held lock → structured `LOCK_UNAVAILABLE` skip,
never an error. The manual CLI (`history:snapshot`) writes THROUGH the same coordinator, so
manual + scheduled + recovery + post-sync can never overlap.

### 35.5 Post-sync capture (§13)
The gated `monday:sync` CLI, after a CONFIRMED successful sync (`success`/`no_change`,
committed writes), calls `capturePostSync` (trigger `post_sync`) through the coordinator.
**Advisory:** a snapshot failure NEVER makes a successful sync report as failed. Gated by
`HISTORY_POST_SYNC_CAPTURE_ENABLED`. Provenance records the source dataVersion + sync time.

### 35.6 Configuration (`server/history/automation/automation-config.js`, validated at load)
`HISTORY_AUTOMATION_ENABLED` (default true), `HISTORY_SNAPSHOT_TIME` (02:00),
`HISTORY_TIMEZONE` (must be Asia/Riyadh), `HISTORY_STARTUP_RECOVERY_ENABLED` (true),
`HISTORY_RECOVERY_LOOKBACK_DAYS` (1; 0–7), `HISTORY_POST_SYNC_CAPTURE_ENABLED` (true),
`HISTORY_RETRY_ATTEMPTS` (1; 0–2) / `HISTORY_RETRY_DELAY_MS`, `HISTORY_LOCK_TIMEOUT_SECONDS`
(300), `HISTORY_API_DEFAULT_LIMIT` (50) / `HISTORY_API_MAX_LIMIT` (200) /
`HISTORY_API_MAX_DATE_RANGE_DAYS` (400). Malformed values throw at startup (fail fast).

### 35.7 Read-only APIs (GET-only; `{data,meta}` / `{error,message}` envelope)
- `GET /api/history/status` — automation + collection status (safe; no secrets/paths).
- `GET /api/history/dates` — successful snapshot dates (`from`/`to`/`limit`/`offset`/`order`).
- `GET /api/history/snapshots/:date` — project snapshots for a Riyadh date (404 if none; no live fallback).
- `GET /api/history/snapshots/:date/buildings` — building rows (`project`, paging, allowlisted `orderBy`).
- `GET /api/history/snapshots/:date/tenants` — **aggregated tenant-directory** rows (`search`, `project`, paging; `rowType:'aggregated-tenant-directory'`).
- `GET /api/history/runs` — audit runs (`status`/`trigger`/`targetDate`/`from`/`to`, paging; safe fields only).
All GET-only, read the stored snapshots (never the live builder or Monday), prepared
statements, strict validation (400 bad input / 404 valid-but-absent), deterministic
pagination with a stable secondary sort key, and never leak SQL/paths/stack traces/tokens.
There are **no** history write endpoints — the manual CLI remains the only controlled writer.

### 35.8 Trigger provenance
`scheduled_daily`, `startup_recovery`, `post_sync`, `manual_cli`, `retry` (retries record
attempt number). Every attempt is audited in `historical_snapshot_runs` (9.1A).

### 35.9 Tests / limitations
`npm run test:history` (47: timezone, migration incl. lock table, engine, CLI, automation
[Riyadh scheduling, config, lock incl. stale-takeover + in-process mutex, scheduler
lifecycle, recovery, coordinated runner], HTTP API [envelopes, 400/404, pagination,
injection-as-data, no-writes-from-GET]) — wired into `npm run verify`. **Limitations
(by design):** no trends/period-over-period (later phase); no per-date backfill; single-node
scheduler (the DB lock makes multi-process safe, but only one node should schedule).
**Next: Phase 9.2** — historical comparisons/trends + frontend historical views.

---

## 36. PHASE 9.1B CORRECTION PASS — RELIABILITY, FRESHNESS, PROVENANCE, API CONTRACT

> **Status: complete.** Focused reliability/integration corrections on the existing
> 9.1A/9.1B modules (no rewrite, no second system, no Phase 9.2 analytics, frontend
> untouched). All forward-compatible; no new migration was required (reused `metadata_json`
> and the lock's `expires_at_utc`).

### 36.1 Post-sync integration (CP1)
The gated `monday:sync` CLI, after a CONFIRMED successful sync (`success`/`no_change` —
i.e. all boards fetched, live writes committed, sync run successful, data visible), calls
`capturePostSync` (trigger `post_sync`) through the shared coordinator. Advisory: a snapshot
failure never turns a successful sync into a failure. Sync dataVersion is stored as
`sourceSyncRunId` in run provenance. Failed/rejected/partial syncs never trigger capture.

### 36.2 Trigger-aware source freshness (CP2)
`evaluateSourceEligibility` now enforces freshness by trigger: `post_sync` → fresh by
definition; `scheduled_daily`/`startup_recovery`/`retry` → require a successful sync within
`HISTORY_MAX_SOURCE_AGE_MINUTES` (default 1500 ≈ 25h) of the capture instant, else
`SOURCE_STALE` (or `SOURCE_SYNC_MISSING`); `manual_cli`/`manual`/`test` → lenient (staleness
is a warning, not a block). Seed/non-monday sources stay ineligible regardless of trigger.
Decision codes: `SOURCE_FRESH`/`SOURCE_STALE`/`SOURCE_SYNC_MISSING`/`SOURCE_NOT_AUTHORITATIVE`/…

### 36.3 Lock lease renewal (CP3)
`renewDbLock` atomically extends `expires_at_utc` for the CURRENT owner only (owner-checked;
non-owner renewal fails). Captures are SYNCHRONOUS (better-sqlite3), so the lock is held
sub-second and cannot be preempted or stolen mid-capture — renewal is a safety net for any
future async work. Stale takeover still requires the full `HISTORY_LOCK_TIMEOUT_SECONDS`.

### 36.4 Transient-only retries (CP4)
`server/history/errors.js#isRetryableHistoricalError` retries ONLY explicitly transient
failures: SQLite `SQLITE_BUSY`/`SQLITE_LOCKED`/`SQLITE_BUSY_SNAPSHOT`/`SQLITE_PROTOCOL`, or a
`SNAPSHOT_PERSISTENCE_FAILED` whose message is a DB-busy/locked condition. NEVER retried:
validation, duplicate, stale/missing/mismatched source, schema mismatch, config errors,
programmer `TypeError`/`ReferenceError` (fails closed on unknown). Retries preserve the
original trigger + a stable root `correlationId` + attempt number.

### 36.5 Audit provenance + real timestamps (CP5)
Run `started_at_utc`/`completed_at_utc` are the ACTUAL wall-clock start/finish (no longer
the business capture instant); `durationMs` is computed from them. Provenance
(`correlationId`, `originalTrigger`, `durationMs`, `sourceSyncRunId`, per-project
`decisionCode`) is stored in `metadata_json` (no schema change). Secrets are never stored.

### 36.6 Public API contract (CP8)
`server/history/response-mappers.js` maps raw SQLite rows → a stable public shape: camelCase,
parsed JSON columns (malformed JSON → null + `dataIntegrityWarnings`, never leaked), booleans
for 0/1 flags, numbers stay numbers, nullable preserved, internal columns omitted. Status
counts are unambiguous (`successfulProjectSnapshotCount`, `successfulSnapshotDateCount`).
Pagination meta is deliberate (`limit`, `returnedCount`, `hasMore`, `nextOffset`, `total`).

### 36.7 Graceful shutdown with active capture (CP7)
The scheduler exposes `awaitIdle`/`stopAndWait`; `server.js` shutdown stops scheduling then
waits (bounded ~2.5s) for any active capture before closing SQLite, so a snapshot
transaction is never cut off. Repeated shutdown calls are safe.

### 36.8 Tenant identity limitation (CP9)
Monday provides no single stable TENANT identifier (a tenant spans multiple lease item ids),
so historical tenant identity remains the normalized directory name. Each tenant row records
`identityMethod:'normalized-name'`, `identityConfidence:'low'`. **Phase 9.2B must NOT
confidently classify tenant entry/exit/retention/rename/expansion/contraction** without a
stable source identifier or an explicit matching policy.

### 36.9 Config / clean install / tests (CP10)
Supported Node ≥ 20 (developed on v24). `better-sqlite3` is a native module — a clean install
rebuilds it for the host OS; never ship `node_modules`. Clean install + test:
`npm ci && npm run verify`. `test:history` uses an explicit cross-platform file list (no
shell glob). `.gitignore` excludes `node_modules/`, `.env`, `data/*.db`, logs.
`npm run test:history` = the 7 history suites (55 tests). Deferred (documented, not hidden):
first-class audit columns for correlation/attempt (currently in `metadata_json`) and deeper
multi-label recovery classification — both safe to add in a later forward migration.

---

## 37. PHASE 9.2A — HISTORICAL COMPARISON & TREND ENGINE

> **Status: complete.** A read-only comparison / time-series / descriptive-trend engine
> over the immutable 9.1 snapshots. Reusable SERVICES (not route logic); deterministic; no
> second historical DB; velocity is READ (never recomputed); TC/BA/C06-C07 rules preserved
> (building rows are read as stored). No frontend change, no forecasting (that's 9.2B).

### 37.1 Modules (server/history/analytics/)
`metric-registry.js` (the ONLY metric→column allowlist, per level — request metrics never
reach SQL as raw text), `change-math.js` (the one change implementation), `comparison-service.js`
(two-point delta, project + batched building), `series-service.js` (time-series + descriptive
trend summary). Reads go through `query-repository.js` (prepared statements, batched building
comparison = one query, no N+1). Routes in `history-routes.js` are thin and call the services.

### 37.2 Change math (exact, deterministic — never NaN/Infinity)
`absolute = comparison − baseline`. `percent = ((comparison−baseline)/abs(baseline))*100`
when baseline≠0; `0` when baseline==0 && comparison==0; **`null`** when baseline==0 &&
comparison≠0; either side null (missing snapshot / stored NULL) → `{absolute:null, percent:null}`.
`direction` = up/down/flat/unknown.

### 37.3 Metrics
Project: occupancyPercent, totalGla, leasedArea, vacantArea, retail/office occupancy+leased,
tenantCountRaw, tenantCountAggregated, occupied/vacant/totalUnitCount, leasingVelocityArea90d,
leasingVelocityLeaseCount90d. Building: occupancyPercent, totalArea, leasedArea, vacantArea,
retail/office occupancy, unit/occupied/vacant counts. Percentages are 0–100 (as stored).

### 37.4 Snapshot selection
`/compare` takes explicit `from`+`to`, OR `policy` = `latest-vs-previous` | `latest-vs-first`
(resolved from the project's distinct snapshot dates; <2 dates → `INSUFFICIENT_HISTORY`).
Same date twice → change 0 (`sameSelection:true`). Missing snapshot → `present:false` + null
change (never fabricated). Building present on only one side → `presence:'added'|'removed'`,
null change. Sparse history: series returns only dates that exist.

### 37.5 Read-only endpoints (`{data,meta}` envelope; GET-only; no raw rows)
- `GET /api/history/metrics?level=project|building` — the metric registry.
- `GET /api/history/compare?project=&level=&metric=&from=&to=` (or `&policy=`) — two-point delta (project, or all buildings batched).
- `GET /api/history/series?project=&level=&metric=&building=&from=&to=` — metric values over a range.
- `GET /api/history/trend?...` — series + descriptive summary (first/last/min/max/average + first→last change + direction). **No forecasting/insights.**
Validation (400): project required, metric in registry, level project|building, dates strict
YYYY-MM-DD, `from≤to`, range ≤ `HISTORY_API_MAX_DATE_RANGE_DAYS`, policy allowlist.

### 37.6 Limits / limitations
Batched building comparison (one query); prepared statements; existing snapshot indexes
(`idx_hps_project_date`, `idx_hbs_project_date`, …) — no new migration/index needed. Trend
is descriptive only. Tenant-level comparison is NOT offered (9.1B tenant identity is
normalized-name only — see §36.8; confident tenant movement analytics wait for a stable id).

### 37.7 Tests
`npm run test:history` (now 75; +12 `analytics.test.js` unit + 7 `analytics-api.test.js` HTTP:
change math incl. zero-baseline/null/no-NaN, project/building comparison incl. same-date /
missing / added-removed, selection policies, series/trend, validation 400s, no-raw-rows,
regression of existing history APIs). Wired into `npm run verify`.

---

## 38. PHASE 9.2B — TENANT ANALYTICS & EXECUTIVE INSIGHTS

> **Status: complete (backend only).** Extends the 9.2A engine with tenant portfolio,
> concentration, lease exposure, movement, and a deterministic executive-insight rule
> engine + summary. Reuses 9.2A comparison/trend/selection and the immutable 9.1 tenant
> snapshots. Read-only; no prediction/LLM; frontend + `/api/dashboard` unchanged.

### 38.1 Data availability (Checkpoint 1 — honest findings)
Tenant snapshots carry: normalized-name identity, leased area, lease/unit/building counts,
category split, rank, lease **start** dates. **NOT present in the source:** annual **rent**,
lease **end/expiry** date, stable **tenant id**. Consequently rent-based analytics and
lease-*expiry* exposure are returned as structured `available:false` (never fabricated), and
identity stays normalized-name / confidence 'low'.

### 38.2 Modules (server/history/analytics/)
`tenant-analytics.js` (identity model + portfolio + concentration + lease-exposure),
`tenant-movement.js` (movement over two dates), `insight-rules.js` (deterministic rule
engine), `executive-summary.js` (composes everything). All read via `query-repository`
(`getAllTenantsForDate`), reuse `change-math` + 9.2A `resolveSelection`. No duplicated calc.

### 38.3 Identity (Checkpoint 2)
Order tried: stable source tenant id → persistent Monday item id → curated map → normalized
name. Only the last exists → `{ identityMethod:'normalized-name', identityConfidence:'low',
sourceTenantId:null, warnings:[…] }`. Never fabricated.

### 38.4 Concentration formulas (Checkpoint 4)
Dimensions: **area**, **units** (rent → `available:false`). `topNSharePercent = Σ(top-N)/total×100`.
**HHI = Σ(share²)** with share a fraction (0–1) → `hhi` (0–1) and `hhiPoints = hhi×10000`
(0–10000). Coverage reports counted tenants + excluded (null-value) records.

### 38.5 Lease exposure (Checkpoint 5)
Buckets expired/0-30/31-90/91-180/181-365/over-365/unknown. Lease **end/expiry is not
captured**, so exposure is `available:false, reason:'LEASE_EXPIRY_NOT_CAPTURED'`, all leases
in `unknown`, `missingExpiryCount = all`. **Never compares against today's date**; never
invents an expiry. (Requires capturing a lease-end column in a future phase.)

### 38.6 Movement (Checkpoint 6)
Reuses 9.2A selection (explicit `from`+`to` or `policy`). Because identity is low-confidence,
results use the **low-confidence buckets**: `possibleRetained` (with area/unit/lease/building
deltas + `movementType` expansion/contraction/stable), `possibleEntry`, `possibleExit`.
`possibleRename` is **not inferred** (no reliable signal; fuzzy matching forbidden) → always
empty + documented. Same normalized name = same tenant.

### 38.7 Insight rules (Checkpoint 7) — deterministic, evidence-based, no LLM
`occupancy.critical-low` (<50) / `occupancy.below-target` (<70) / `occupancy.declining`
(Δ≤−5 pts) / `occupancy.slight-decline` (<0); `vacancy.high` (>50); `concentration.high`
(top1>30% or HHI>2500) / `concentration.moderate` (HHI>1500); `movement.net-exit`
(possibleExit>possibleEntry); `trend.declining` (direction down); `data-quality.*` (rent /
lease-expiry unavailable, identity low — always surfaced). Each insight carries ruleKey,
category, severity, thresholds, evidence, snapshotIds, calculations, limitations. Missing
data → a data-quality insight, never a false positive. Optional `severity` suppression.

### 38.8 Endpoints (read-only, `{data,meta}`, mapped)
`GET /api/history/tenants/portfolio`, `/tenants/concentration` (`?dimension=area|units|rent`),
`/tenants/lease-exposure`, `/tenants/movements` (`?from&to` or `?policy`), `/insights`
(`?severity`), `/executive-summary`. All take `?project=` (required) + optional `?date=`
(defaults to the project's latest snapshot). Validation: 400 bad input, 404 valid-but-absent
date/no-history. No writes from GET.

### 38.9 Tests / limitations
`npm run test:history` (now 83; +8 `tenant-analytics.test.js` covering retained/entry/exit/
expansion/contraction, HHI + Top-N, rent/expiry unavailable, identity low-confidence, insight
rules + suppression, executive-summary composition, and the 6 HTTP endpoints incl. validation
+ no-writes). **Limitations:** no rent analytics, no lease-expiry exposure, tenant movement
low-confidence only (no rename detection) — all pending a stable tenant id / rent / lease-end
column in the source (future capture phase). No forecasting (evidence-based rules only).

---

## 39. PHASE 9.1B/9.2A/9.2B — FOCUSED CORRECTION PASS (BEFORE PHASE 9.3)

> **Status: complete.** A targeted correction pass over the 9.1B/9.2A/9.2B analytics +
> automation — **not a rewrite**. Existing architecture, services, API contract and
> read-only guarantees are preserved. No Monday mapping / business-rule change, no
> forecasting/AI/rent/expiry fabrication, no frontend change. Backend + tests only. Phase 9.3
> is intentionally NOT started.

### 39.1 A — executive-summary date scoping (no future-data leakage) [was blocking]
A summary requested for a historical date `D` must never use a snapshot LATER than `D`.
`resolveDate()` now returns `{ date, allDates, eligibleDates (≤D), previousDate,
countThroughDate, totalCount }`. `buildInsightContext()` is date-scoped: **comparison** and
**movement** use `(previousDate → D)`; **trend** spans `(eligibleDates[0] → D)`; there is **no
`policy:'latest-*'`** (which would jump to the globally latest date). The first-date case
returns structured `available:false, reason:'INSUFFICIENT_HISTORY'` for comparison + movement
(never fabricated). The summary exposes `summaryDate`, `snapshotDateCount` (through `D`) and
`totalSnapshotDateCount` (full history); `latestDate` is retained (== `summaryDate`) for
back-compat. `buildInsights()` shares the same scoped context (no duplicate calc). No insight
evidence can reference a date later than `D`. (`server/history/analytics/executive-summary.js`.)

### 39.2 B — graceful shutdown tracks startup recovery [was blocking]
`runStartupRecovery()` previously called the runner directly, bypassing lifecycle tracking, so
`stopAndWait()`/`awaitIdle()` could report **idle while a recovery was still running** (risking
DB close mid-capture). A single `track(operation)` helper now wraps **every** DB-touching
attempt (scheduled daily AND recovery): it serializes behind any prior `activePromise` (no
silent overlap), marks the scheduler running, and clears running only when the last
outstanding op completes. `recoveryState` is reset in a `try/finally`. `runAttempt` is
injectable for deterministic tests. (`server/history/automation/snapshot-scheduler.js`.)

### 39.3 C — execution-lock renewal integrated, fail-closed
`runExclusive()` now passes an owner-checked `renew()` into the run fn; the coordinated runner
forwards the lock context to the orchestrator, which **renews the lease at each project
boundary (write mode) and fails closed if ownership was lost** (records a `LOCK_OWNERSHIP_LOST`
project failure with `underlyingCode`, stops the run, persists nothing further). Captures are
synchronous (better-sqlite3), so the lease is normally held sub-second — renewal is a
correctness safeguard, documented as such, not a heartbeat timer. `LOCK_OWNERSHIP_LOST` is a
**non-retryable** code. (`execution-lock.js`, `snapshot-runner.js`, `capture-orchestrator.js`,
`constants.js`, `errors.js`.)

### 39.4 D — compareBuildings single-pass presence
The two per-building `rows.some()` rescans were replaced by presence flags
(`baselinePresent`/`comparisonPresent`) tracked **during the existing single pivot pass**.
Presence is by ROW existence, not value — a building with a stored **NULL** metric is `'both'`
(present), never misclassified as `added`/`removed`. Same-date, added and removed behaviour and
the response contract are unchanged. (`server/history/analytics/comparison-service.js`.)

### 39.5 E — API availability + zero-lease exposure
Series/trend now carry explicit `available` + `reason` (`NO_POINTS` when zero snapshots,
`NO_VALUED_POINTS` when snapshots exist but every value is null) alongside the always-present
`points`; a **single** valued point yields `change:{absolute:null,percent:null}` (no fake 0/0).
Two-point comparison already documents `baselineMissing`/`comparisonMissing`. Lease-exposure
with **zero leases** now returns `percentOfLeases: null` (was a misleading `100%`) and exposes
`leaseCount`/`tenantCount`. (`series-service.js`, `tenant-analytics.js`.)

### 39.6 F — audit / provenance
**F1:** dry-run is explicitly documented as **log-only** — it writes no run row and no snapshot,
emitting only logs and returning results in memory (never inflates the audit history).
**F2:** a project failure now preserves a sanitized `underlyingCode` (e.g. a better-sqlite3
`SQLITE_*` code) on the result AND in the run audit `metadata_json.results[]`, so provenance
records *why* a project failed without leaking any message/path. (`capture-orchestrator.js`.)

### 39.7 G — migrations verified on a disposable DB
Migrations 1→6 verified on a throwaway copy (never the real DB) via `db:migrate` + `db:check`:
fresh DB reaches **schema v6** (FK on, WAL), and a re-run is idempotent (all applied,
nothing to apply). `test:history` (migration suite) confirms a v4 DB upgrades safely with data
preserved.

### 39.8 H — aggregate test script
`npm test` = `test:seed && test:api && test:frontend && test:monday && test:history`
(deliberately **excludes** `test:monday:integration`, which needs live credentials). Current
totals: seed 28, api 11, frontend 65, monday 49, history 100 → **253** offline tests, all green.

### 39.9 I — handover hygiene
`.gitignore` confirmed to exclude `node_modules/`, `.env`/`.env.*` (keeping `.env.example`),
`data/*.db`/`-wal`/`-shm`, `config/monday-mapping.json`, and logs. `.env.example` uses
placeholders only and now documents **token rotation** (generate → paste into local `.env`
only → restart → revoke old; token is env-only, non-enumerable, never logged; no code change
to rotate; revoke immediately if exposed).

### 39.10 Tests / verify
New `tests/history/correction-pass.test.js` (**17** tests): A (middle/first/latest date +
insights endpoint scoping, no future leakage), B (delayed-recovery wait-success / hang-timeout /
exception-resets-idle / recovery+scheduled serialize), C (`renewDbLock` owner/wrong-owner/
released + `runExclusive` renew() + orchestrator fail-closed / normal), D (null-valued building
present), E (empty/all-null series, single-point change null, zero-lease exposure null). Wired
into `test:history` and `npm test`. `npm run verify` — all stages green (unchanged behaviour
elsewhere; existing 9.2B executive-summary shape assertions still pass: `latestDate`,
`snapshotDateCount` semantics preserved).

---

## 40. PHASE 9.3 — HISTORICAL DASHBOARD FRONTEND INTEGRATION

> **Status: complete.** A read-only **Historical Analytics** workspace in the frontend that
> consumes the Phase 9.1/9.2 backend. The backend is the single source of truth: NO trend,
> comparison, executive-summary or occupancy math runs in the browser — every number, delta,
> series point and insight TEXT comes from `/api/history/*` and is rendered verbatim. The live
> always-on board is unchanged; historical views are immutable. **Git is now the official VCS**
> (see the workflow at the top of the Phase 9.3 spec): this phase begins the committed history.

### 40.1 Where it lives (non-invasive)
`Project Dashboard.html` only (plus tests + one backend display-text addition). The workspace is
a **full-viewport modal overlay** (`#histOverlay`, `position:fixed`, authored in `rem` so it
scales with `fitDashboard`), opened by a header **History** trigger (`#histTrigger`, cloned from
the `.project-tab` design language). Its content area (`.hist-body`) is the one place a second
internal `overflow-y:auto` scroll region is allowed (the page itself still never scrolls). Stat/
chart cards use a new `.historical-card` added to the **secondary-card** elevation lists, so they
stay subordinate to the live board's language. Closing returns to the untouched board.

### 40.2 Six sub-views (lazy, per-view)
`Executive Overview` (snapshot headline figures from `/snapshots/:date` + change indicators &
verbatim insights from `/executive-summary`), `Portfolio Trends` (Chart.js **line** charts of
`/series` for occupancy / vacant area / occupied units / unique tenants — building-count trend is
intentionally omitted, not a captured per-project metric), `Building Analytics`
(`/snapshots/:date/buildings` table with search/sort + per-building occupancy Δ from
`/compare?level=building&policy=latest-vs-previous`), `Tenant Analytics` (largest tenants from
`/snapshots/:date/tenants`, concentration/HHI from `/tenants/concentration`, movement from
`/tenants/movements`, with rent & lease-expiry shown **unavailable + why**), `Snapshot Comparison`
(two-date picker → backend `/compare` per project metric + `/tenants/movements`), `Data Quality`
(`/history/status` counts + selected-summary metadata + data-availability insights).

### 40.3 Snapshot controls & selection guard
Project + snapshot selectors in the top bar; the per-project snapshot **date list is derived from
the occupancy `/series` points** (authoritative). Snapshot options are labelled Latest / Previous /
date. The comparison view has its own from/to selects guarded by the pure, tested
`hValidateComparison()` — it **prevents invalid or future comparisons** (a date that is not a
captured snapshot, `from > to`, or the same date) with a clear message, never firing a bad request.

### 40.4 No frontend business logic (the core rule)
The only client helpers are DISPLAY-only and unit-tested: `hFmtNum/hFmtArea/hFmtPct` (formatting),
`hDelta(change, higherIsBetter)` (chooses arrow/tone from a **backend-provided** change — never
computes it), `hStateFrom(outcome)` (maps a fetch result to loading/empty/error/unavailable/ready),
`hValidateComparison(...)` (selection guard). Occupancy/vacancy/leased/GLA, all deltas, series,
comparisons, movement counts, concentration/HHI and insight prose are taken straight from the API.

### 40.5 Backend addition (the one necessary change)
Insight objects previously carried only structured evidence (no prose), but the acceptance criterion
is "executive insights rendered **exactly** as returned" with no client interpretation. So
`insight-rules.js` now attaches a deterministic `title` + `message` to every insight — static string
templates over already-computed evidence (a date/number/dimension), **not** a calculation and **not**
AI. Additive; the existing insight-shape test was extended to lock non-empty `title`/`message`.

### 40.6 Robustness / UX
Every widget renders one of **loading / empty / error / unavailable / ready** — never a blank
section (`showState` + `stateBlock`). The history client (`HIST.hGet`) mirrors the live client's
discipline: same-origin, `cache:'no-store'`, `AbortController` 10s timeout; successful GETs are
**cached ~60s** (dedup + no duplicate calls when re-opening a view), failures are never cached.
Views fetch **lazily** and stale responses are ignored (guarded by current view/date). Trend charts
follow the shared Chart.js grammar, are registered in `resizeDashboardCharts()` (rem-scale) and the
quality controller's `applyQualityMode` (`chartAnimMs`), and are destroyed/rebuilt on demand (no
leaks; the overlay is user-invoked, not per-frame). Untrusted (Monday-sourced) tenant/building names
are rendered via `createElement`/`textContent` — never `innerHTML`. In **demo** (`file://`) mode
every view shows an honest "requires the live server" state (history reads SQLite).

### 40.7 Tests (offline)
- `tests/frontend/phase9-3-historical.test.js` (**6**): display-helper formatting, `hDelta`
  tone/arrow/unavailable, `hStateFrom` state mapping, `hValidateComparison` selection guard, the
  `HIST` controller surface, and the overlay/6-view/trigger markup + single-scroll-region invariant.
- `tests/history/phase9-3-api-integration.test.js` (**9**): drives the exact endpoints the UI calls
  against a real in-process app with two seeded snapshots — series (selector source), executive
  summary (scoped context + insight `title`/`message`), snapshot headline, buildings + building
  compare, largest tenants / portfolio / concentration / movement / lease-exposure-unavailable,
  project-metric compare, status counts, **empty-history 404**, **invalid-range 400**, and
  no-writes-from-GET.
- Aggregate `npm test` now: seed 28, api 11, frontend **71**, monday 49, history **109** → **268**
  offline tests, all green. `npm run verify` — all stages green.

### 40.8 Manual verification (headless Edge + CDP, real data)
On a **disposable copy** of the live DB (the real DB was never touched; automation disabled), the
served dashboard loaded with **zero console errors/exceptions**; the History trigger opened the
overlay (6 tabs); the Executive Overview rendered real backend figures (Business Address 57.1%
occupancy, 5 buildings, insight "Occupancy below target — Occupancy is 57.1%…") verbatim; and the
page body did not scroll. All UI endpoints returned 200 except `movements` → 400 for a project with
a single captured snapshot (the documented `INSUFFICIENT_HISTORY` case → the UI shows an "unavailable
— at least two snapshots needed" state, never a blank).

### 40.9 Limitations / deferred
- Trends cover the captured per-project metrics; a **building-count** time series is not a captured
  metric and is omitted (per-building history lives in Building Analytics).
- Rent concentration and lease-expiry exposure remain **unavailable** (not in the source) and are
  shown with the reason — unchanged from 9.2B.
- Tenant movement stays **low-confidence** (normalized-name identity); renames are not inferred.
- Full history requires the live server + captured snapshots; `file://` demo shows the honest
  "live server required" state.
- On-hardware TV validation of the overlay was not performed (no device); it reuses the quality
  controller's `chartAnimMs` gate, so `static` mode yields instant charts.

---

## 41. PHASE 9.4A — PRODUCTION READINESS

> **Status: complete.** Operational hardening for a permanent server deployment — NO new
> business features, NO architecture change, NO business-logic / analytics / snapshot /
> Monday-mapping change. Everything from Phases 1–9.3 functions exactly as before; all
> additions are additive and only take effect when the server is actually started
> (importing `app` for tests does not validate/exit, configure file logging, or install
> process handlers). Git is the official VCS; work landed as focused commits.

### 41.1 Production configuration (`config/`)
New `config/index.js` (+ `production.js`, `development.js`, `validation.js`) — an ADDITIVE
facade over the existing env handling (it does not replace `server/config/*`,
`monday/config.js`, or `automation-config.js`). `loadConfig()` reads the environment and
**bridges the spec's alias names to the canonical ones the code already uses** (one
idempotent side effect, canonical always wins): `DATABASE_PATH→SQLITE_DB_PATH`,
`SNAPSHOT_SCHEDULE→HISTORY_SNAPSHOT_TIME`, `TIMEZONE→HISTORY_TIMEZONE`
(`MONDAY_API_TOKEN→MONDAY_API_KEY` is already handled in `monday/config.js`). Board IDs
deliberately remain in `config/monday-mapping.json` (§28.2), never an env var. A
production/development profile sets strictness. `validateConfigOrExit()` validates and, in
production, prints a clear secret-free error and **exits non-zero** on any problem (bad
PORT/LOG_LEVEL/snapshot-time, `TIMEZONE≠Asia/Riyadh`, non-writable DB dir, or
sync-enabled-without-token/mapping); development downgrades provisioning issues to warnings.
`describe()` is secret-free. Validation runs at the top of `startServer()` only.

### 41.2 Centralized logging (`server/logger.js`)
Zero-dependency logger: levels `error<warn<info<debug` gated by `LOG_LEVEL`; each entry has
ISO timestamp, level, source, message, optional context. Console (stderr for warn/error,
stdout otherwise — PM2 captures it) **plus** `logs/dashboard.log` (one JSON line/entry) when
a log dir is configured; file writes are wrapped so logging never throws. **Secrets are
redacted by key** (token/apiKey/authorization/password/secret/cookie). The `(message,
context)` signature matches the scheduler/Monday `(evt, ctx)` shape, so the history/scheduler
logs now flow through the same logger (source `history`). Startup, DB-ready, scheduler,
listening, and shutdown are logged.

### 41.3 Server integration (`server/server.js`, additive)
- **Config validate-or-exit** + **logger file config** at the top of `startServer()` (never
  at module load, so tests importing `app` are unaffected).
- **Safe headers** (module scope, so `app` always has them): `X-Content-Type-Options:nosniff`,
  `X-Frame-Options:SAMEORIGIN`, `Referrer-Policy:no-referrer`, `X-DNS-Prefetch-Control:off`,
  and `x-powered-by` disabled. **No CSP** (the inline-script + CDN dashboard would break).
- **`/health` enriched** (still liveness, always 200): adds `version`, `environment`,
  `uptime`, `database` (`ready`/`unavailable`), `scheduler` (`running`/`idle`/`disabled`).
  `/ready` unchanged.
- **Process safety** (installed only by `startServer`): `unhandledRejection` is logged but
  does not kill the host (availability); `uncaughtException` is logged, SQLite is closed, and
  the process exits non-zero for a clean PM2 restart.
- **Database safety:** after init, the DB file must be writable (abort with a clear message
  otherwise); FK-ON + WAL are already hard-verified on open (§23.4). Graceful shutdown
  (SIGINT/SIGTERM → stop scheduler → await active capture → close SQLite) was already present.

### 41.4 Process management (`ecosystem.config.js`)
PM2 app: **`instances:1`, `exec_mode:'fork'`** (SQLite single-writer — never cluster),
`autorestart`, `exp_backoff_restart_delay`, `max_memory_restart:'512M'`, `kill_timeout:8000`
(room for graceful shutdown), PM2 logs under `logs/`, `env_production.NODE_ENV=production`
(no secrets in the committed file). Reboot persistence via `pm2 save` + `pm2 startup`
(documented, not auto-installed).

### 41.5 Ops scripts + hygiene
- `npm run lint` → `scripts/lint.js`: dependency-free V8 parse (`vm.Script`) over all project
  `.js` (127 files) — a real syntax gate without adding ESLint (a documented future option).
- `npm run backup` → `scripts/backup.js`: consistent online copy via `better-sqlite3`
  `.backup()` to `data/backups/dashboard-<UTC>.db`, integrity-checked; `BACKUP_KEEP=N` prunes.
- `npm run restore <file> [--confirm]` → `scripts/restore.js`: validates the backup
  (`integrity_check` + `schema_migrations`) BEFORE overwriting, safety-copies the current DB,
  clears stale `-wal`/`-shm`, re-verifies. Refuses without `--confirm`.
- `.gitignore` adds `logs/`, `coverage/`, `tmp/`. `.env.example` documents `NODE_ENV`,
  `LOG_LEVEL`, and the alias vars. `npm test` now includes `test:production` (14 tests).

### 41.6 Documentation
README gains a "Production deployment (Phase 9.4A)" section (config/validation, logging,
PM2, backup/restore, scripts) and an enriched `/health` description; new
`DEPLOYMENT_CHECKLIST.md` covers install → clone → npm install → `.env` → migrate → PM2 →
verify `/health` → Monday → scheduler → snapshots → dashboard, plus backup/restore, update,
rollback, and a pre-flight.

### 41.7 Security review
No committed secrets (`.env`/`*.db*`/`node_modules/`/`logs/`/`config/monday-mapping.json`
all gitignored; `.env.example` placeholders only); token is env-only, non-enumerable, and
redacted from logs; no debug endpoints (the `?qualityDebug` overlay is localhost-only, client
only); safe headers added; inputs validated by the existing route validators; error responses
stay generic (no stack/path/SQL). The production config **fails closed** on missing/invalid
values.

### 41.8 Tests / regression
New `tests/production/{config,logger}.test.js` (14). Full suite **282** offline
(seed 28, api 11, frontend 71, production 14, monday 49, history 109), all green; `npm run
verify` all stages green; `npm run lint` clean. Manual production smoke (headless, on a
disposable DB copy, `NODE_ENV=production`): valid config → enriched `/health` (environment
`production`, `database:ready`), safe headers present, `x-powered-by` absent, logs written to
console + `logs/dashboard.log`; an invalid `TIMEZONE=UTC` **aborts** with a clear FATAL
message and never serves. No regressions to the historical dashboard, executive summaries,
comparisons, scheduler, historical APIs, Monday sync, or the frontend.

---

## 42. PHASE 9.4B — FINAL QA & VERSION 1.0.0 CERTIFICATION

> **Status: complete — v1.0.0 certified, tag NOT yet created (awaiting approval).** A
> verification-only phase: NO new features, NO architecture/logic/snapshot/analytics change.
> All evidence was gathered against a DISPOSABLE COPY of the live database; the real DB was
> never modified. No production defect required fixing. Full evidence: `RELEASE_CHECKLIST.md`.

### 42.1 Regression (Part 1)
`npm test` → **282/282** pass, 0 failures (seed 28, api 11, frontend 71, production 14,
monday 49, history 109). `npm run verify` all stages green. `npm run lint` clean (127 files).
Migrations: fresh → schema v6 + idempotent re-run; v4→v6 upgrade preserves data (history
migration suite).

### 42.2 End-to-end (Part 2) & production scenarios (Part 3)
Live dry-run → snapshot → stored → dashboard (2 projects, live) → comparison → executive
summary → charts → **restart preserves data** (identical `dataVersion`) → **scheduler
resumes**. Fresh install auto-seeds (117 records); v4→v6 upgrade safe; invalid config and
unwritable DB **fail closed**; Monday-unavailable handled (offline fixture + 401 fast-fail);
network interruption → frontend degraded/retry (client tests).

### 42.3 Performance (Part 4)
Startup → `/health` ready ~1.3 s; API endpoints < 6 ms (`/api/dashboard` ~3.7 ms,
executive-summary ~5.7 ms); snapshot capture a few ms/project; memory ~59 MB RSS idle, CPU
~0.31 s. Monday live dry-run of both boards (full pipeline) completes in a few seconds,
network-bound, zero writes.

### 42.4 Reliability (Part 5)
3 repeated snapshot runs → all `duplicate_skipped`, no new rows, `integrity_check = ok`,
`foreign_key_check` = 0. Graceful shutdown is code-implemented + CP7/`awaitIdle` test-covered;
SIGINT/SIGTERM (PM2/Linux) trigger it — a Windows hard `taskkill /F` bypasses it (OS limit).

### 42.5 Security (Part 6)
No tracked secrets; private paths → 404; unknown `/api` → JSON 404; bad input → 400 with
generic messages (no stack/path/SQL); safe headers present; `x-powered-by` removed; no debug
routes; secrets redacted from logs; production config fails closed.

### 42.6 Monday certification (read-only, live)
`monday:mapping:check` (production) OK; `monday:mapping:validate-live` OK (both boards active,
columns resolve); live dry-run TC 129/72-active, BA 40/20-active, 0 warnings, candidate
`dataVersion 86441bbea561` == the stored SQLite value (consistent). ZERO writes; the server
never auto-syncs.

### 42.7 Bug review (Part 9) & version (Part 10)
Critical 0 · Major 0 · Minor 0 · Cosmetic 1 (`.env` uses the deprecated `MONDAY_API_TOKEN`
alias → a one-time value-free warning; rename to `MONDAY_API_KEY` to silence — not a code
defect). No Critical/Major → release not blocked. `package.json` is already `1.0.0`; README
notes the version; `CHANGELOG.md` + `RELEASE_CHECKLIST.md` added. Documentation reviewed
(Part 7): README (incl. an environment-variables table + production section),
DEPLOYMENT_CHECKLIST, CHANGELOG, .env.example, CLAUDE §§1–42 — complete.

### 42.8 Outcome
All acceptance criteria met. **v1.0.0 is ready.** The `v1.0.0` tag is prepared but was NOT
created or pushed — per the phase instruction, stop and await explicit user approval before
creating/pushing the release tag.
