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
├── Project Dashboard.html      ← THE LIVE APPLICATION (self-contained: HTML + CSS + JS)
├── blacksand_mark_primary.png  ← Brand mark used in the header depth-stack logo
├── logos/
│   ├── al-tamimi.png           ← Tenant logo (Al Tamimi / tamimi markets) — used by a medallion
│   └── tharwah_logo.png        ← Tenant logo (Al Tharwah Co.) — used by a medallion
├── script.js                   ← ⚠️ DEAD / ORPHANED legacy prototype — NOT loaded (see below)
├── styles.css                  ← ⚠️ DEAD / ORPHANED legacy prototype — NOT loaded (see below)
├── README.md                   ← ⚠️ Describes the OLD prototype; out of date for the live file
├── CLAUDE.md                   ← This document
└── .vscode/
    └── settings.json           ← Live Server workspace config (dev only)
```

### File responsibilities

- **`Project Dashboard.html`** — the entire live product. All markup, all CSS (one inline `<style>` in
  `<head>`), and all JavaScript (one inline `<script>` before `</body>`) live here (~2,265 lines). This is
  the **only** file that renders the dashboard. **Edit this file to change the dashboard.**

- **`blacksand_mark_primary.png`** — the official BlackSand mark. Rendered as a layered CSS "depth stack"
  in the header (multiple offset copies build a subtle extrusion). An inline SVG is a hidden fallback if the
  PNG is missing.

- **`logos/`** — tenant logo assets. A tenant object may carry a `logo` path; the 3D medallion loads it onto
  the coin face, falling back to initials if it can't load. Add new tenant logos here.

- **`script.js`, `styles.css`, `README.md`** — ⚠️ **an orphaned earlier prototype.** They target a
  non-existent `index.html` with a completely different DOM (`#live-clock`, `#tenant-body`, `.table-scroll`,
  `#occupancy-chart`, `#toast`, sort buttons, single-project data). **They are not linked by the live file
  and have no effect on it.** Do not edit them expecting the dashboard to change. They should eventually be
  deleted or reconciled (see Roadmap). Treat the live HTML as the sole source of truth.

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
- **Delete/reconcile dead code** — remove or rebuild `script.js` / `styles.css` / `README.md`, or fold the
  live file into properly separated modules.
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
- **Remember the dead-code trap:** `script.js` / `styles.css` / `README.md` do not affect the live
  dashboard. Editing them is almost always a mistake.

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
- **Sizing (do not regress):** the ring, pedestal and shadow all live inside a single
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
- **Pedestal:** three stacked `CylinderGeometry` platforms (museum-plinth); the ring floats just above them.
- **Shadow:** a cheap **radial-gradient sprite** plane (no shadow maps) for a soft contact shadow.
- **Lighting:** soft studio — neutral ambient + white key + lilac rim + fill (matches the medallion language).
- **Centre label:** a crisp **HTML overlay** (`.stage-label`), not rendered into the canvas → razor-sharp at 4K.
- **Motion:** gentle float + a tiny camera drift only; **never spins**; pauses on `document.hidden`.
- **Mounting:** `initOccupancyCentrepiece()` runs from `initThreeVisuals()` on `three-ready`; it adds
  `.has-3d` to the stage (which hides the CSS fallback) and paints the current project's value.
- **Fallback:** a **CSS conic-gradient ring** (`.stage-fallback`, driven by `--leased-turn`) shows until/unless
  the 3D mounts, so the occupancy % is always visible even with no WebGL/Three. `renderProject` calls
  `occupancy.update(fraction)` and always sets `#occPct` + `--leased-turn`.

### 21.4 Proportional TV scaling (no media queries)
The dashboard is authored at a **fixed 1920×1080 canvas** and uniformly scaled to fit any 16:9 display:
- `.dashboard { width:1920px; height:1080px; transform: scale(var(--fit)); }`, centred via `body` flexbox.
- `fitDashboard()` sets `--fit = min(innerWidth/1920, innerHeight/1080)` on load and on **genuine** resizes.
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
2. **Portfolio Statistics plinth** — medium (perspective tilt + extrusion, §21.2/§21.3).
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

### 21.4c Header brand lockup (`initBrandLockup()`)
The header symbol + "Blacksand" wordmark are now **one Three.js object** (replacing the old CSS
`.logo-depth-stack` PNG stack and the dormant `initThreeLogo()`, both removed). One
renderer/scene/camera/loop, in the occupancy model's material/light/motion language but **secondary** in
the depth hierarchy (model > lockup > medallions > cards).
- **Markup:** `<h1 class="brand-lockup-3d" id="brandLockup3D" role="img" aria-label="Blacksand">` holds a
  `<canvas class="brand-lockup-canvas">` + a flat `.brand-lockup-fallback` (official PNG symbol + wordmark
  text). The fallback shows until the first frame, then `.lockup-ready` retires it; it stays if WebGL fails
  (header never blank). The active project name stays as **HTML** `#projectName` beneath the lockup (never
  baked into the texture) so switching still updates it.
- **Symbol:** the **official mark** (`blacksand_mark_primary.png`, the curved grey→purple ribbon + diamond)
  drawn onto an offscreen 2D canvas → `CanvasTexture`, mounted as layered planes (bright front + darker
  offset back copies for shallow edge depth). This uses the real official artwork — the old angular
  SVG-path extrusion was a poor approximation and was replaced. ⚠️ **Requires http:// (Live Server):**
  WebGL cannot upload a `file://` image as a texture (cross-origin/canvas-taint), so opening the file
  directly shows the wordmark but not the 3D symbol. The dashboard's standard is Live Server, so this is
  fine; the flat fallback still covers the no-WebGL case.
- **Wordmark:** ⚠️ **no dedicated wordmark asset exists in the project** — "Blacksand" is drawn to a
  `CanvasTexture` in the brand typeface (Hanken Grotesk, redrawn on `document.fonts.ready`) and mounted as
  three layered alpha planes (graphite back copies + bright front) for shallow extruded depth (~55% of the
  symbol). If an official wordmark SVG/PNG is later added, swap it in here. Do NOT introduce a random font.
- **Camera/motion:** fixed `PerspectiveCamera` (small perspective, base tilt ≈ −3.4°/+1.7°); restrained
  synchronized drift (±~0.9°, ~1px float) on the whole group; pauses on `document.hidden`; respects
  `prefers-reduced-motion`. Soft contour shadow via a CSS `drop-shadow` on the canvas (follows the alpha
  silhouette, not a rectangle). Fixed group scale/camera; ResizeObserver updates only buffer + aspect.
- **Stability:** the canvas is a single static HTML element passed to the renderer (`{ canvas }`); init is
  guarded (`if (brandLockup) return`) → exactly one canvas/renderer/loop, refresh-stable. (Supersedes the
  §9 "header logo" description, which is obsolete.)

### 21.4d Premium finish pass (depth / lighting / material realism)
A calibrated "≈40% more premium" polish — more depth, lighting realism and material quality, **without**
more animation, glow, saturation, or size. Levers used (all restrained, executive):
- **Cards:** deeper, better-defined drop shadows + crisper inset top-edge light + thicker dark lower edge +
  a slightly richer surface gradient and border (`.card` and the secondary tier), with **heavier/smoother**
  easing (`0.35s cubic-bezier(0.22,1,0.36,1)`) — never faster. Charts inherit this via their card containers;
  chart canvases/data stay flat.
- **Occupancy model (hero):** a shared dark **studio environment map** (`makeStudioEnvironment(renderer)` —
  PMREM of a dark vertical gradient) gives subtle IBL reflections; the leased/vacant arcs became
  `MeshPhysicalMaterial` with light **clearcoat** + `envMapIntensity`; pedestals got mild metalness/env;
  the contact shadow is deeper with a tighter core. Size, camera, and animation are unchanged.
- **Medallions:** coin + ring → `MeshPhysicalMaterial` with clearcoat + env reflections; slightly stronger
  CSS contact shadow. No extra animation.
- **Header lockup:** added the dark env for richer material response + a small lighting bump (not brighter).
- **Portfolio Statistics plinth:** deeper shadow + a thicker `::before` extrusion → more dimensional and
  better integrated with the model.
- **Micro-animation:** the project-switch cross-fade is heavier (`0.45s`), with the swap timing bumped to
  match (450ms) so content lands fully faded. The env is intentionally DARK, so reflections add realism
  without brightening/glowing. `makeStudioEnvironment` returns null on failure (materials still render).

### 21.5 Reused verbatim (do not rebuild)
Project switching (`switchProject`/`renderProject`/`currentIndex`), tenant search, idle auto-paging, the two
Chart.js charts, Performance Summary, **Top Tenant 3D medallions** (kept as secondary premium accents), the
header logo/`three-ready` system, and all metric functions are unchanged in logic — only repositioned/restyled.

### 21.6 Resilience added
The two Chart.js constructors are now guarded (`typeof Chart === 'undefined' ? null : new Chart(...)`), so a
CDN failure no longer throws at top level. Verified: with the CDN blocked, KPIs, velocity, tenant tables and
the scaling still render, and the occupancy stage shows its CSS fallback ring (satisfies §17).

### 21.7 Validated
Headless Edge at 1920×1080 and 3840×2160: correct data, `has-3d` centrepiece mount, project switch to Town
Center (23,982 m² / 51.0% / 56 tenants) recomputes the ring, no page scroll, and graceful CDN-down degradation.
