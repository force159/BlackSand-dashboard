# Legacy V1 prototype — archived (not used by the live dashboard)

These three files are the **original V1 prototype** of the leasing dashboard. They are
kept here **only for historical reference**.

## What they are
- `script.js` — V1 vanilla-JS logic (live clock, KPI calc, a Chart.js doughnut, a
  sortable/searchable tenant table, a 30s "auto-refresh" simulation).
- `styles.css` — V1 theme/layout/responsive styling.
- `README.md` — V1 documentation (it tells you to "open `index.html`").

## Why they are archived
They are **not imported, linked, or executed by the current dashboard**:

- The live app is a single self-contained file: **`Project Dashboard.html`** (all HTML,
  CSS, and JavaScript are inline in that one file).
- `Project Dashboard.html` contains **no `<link href="styles.css">`** and **no
  `<script src="script.js">`** — verified.
- `script.js` targets an **obsolete DOM** from a different page structure. Every element
  id it reads/writes (`live-clock`, `retail-gla`, `offices-gla`, `total-pct`,
  `occupancy-chart`, `tenant-body`, `tenant-search`, `toast`, …) **does not exist** in
  the live dashboard, which uses camelCase ids (`currentTime`, `retailGLA`, `officeGLA`,
  `occPct`, `topTenantsGrid`, …).
- `README.md` references an **`index.html`** that does not exist in this project and
  describes V1-only features (doughnut chart, sort buttons, `#8B5CF6` accent, `#0b0b0b`
  background) that are not part of the current product.

## Do not edit these expecting the dashboard to change
Editing anything in `archive/legacy-v1/` has **no effect** on the running dashboard.
All live changes must be made in **`Project Dashboard.html`** at the project root.

Archived as part of the "clean dashboard and add URL project selection" phase.
