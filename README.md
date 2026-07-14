# Real Estate Leasing Dashboard

A responsive, corporate-executive **front-end prototype** for a real estate leasing dashboard. Built with plain **HTML, CSS, and vanilla JavaScript** — no backend, no database, no build step.

Designed to look great on a large **55-inch TV** as well as on desktop and mobile.

## Run it

Just open **`index.html`** in any modern browser. That's it.

> The doughnut chart loads Chart.js from a CDN, so an internet connection is needed for the chart to appear. Everything else works offline.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure — header, KPI cards, chart, tenant table |
| `styles.css` | Theme, layout, responsive rules, animations |
| `script.js`  | Clock, calculations, table logic, chart, auto-refresh |
| `README.md`  | This file |

## Features

- **Live header** — company logo placeholder, project name, current date & time (updates every second), and a "Last Updated" timestamp.
- **KPI cards** for Retail and Offices (GLA + leased %), plus auto-calculated **Total GLA** and **Total Leased %** (GLA-weighted).
- **Purple progress bars** for each rental type with smooth fill animation.
- **Tenant table** with alternating row colors, **search**, and **sort by name / area** (click a sort button again to reverse order).
- **Doughnut chart** (Chart.js) showing Leased vs Vacant.
- **Auto-refresh simulation** — checks every **30 seconds** (standing in for a real 5-day cycle). On each check it updates the "Last Updated" time and shows a `Tenant list checked successfully.` notification.
- **Fully responsive** with breakpoints for TV, desktop, tablet, and mobile.

## Theme

| Token | Value |
|-------|-------|
| Background | `#0b0b0b` |
| Accent | `#8B5CF6` |
| Text | `#ffffff` |

## Editing the data

All data lives at the top of `script.js`:

```js
const leasingData = {
  retail:  { gla: 1892,  leasedPct: 52 },
  offices: { gla: 11267, leasedPct: 47 },
};

const tenants = [ /* { name, category, area } */ ];
```

Change these values and reload — totals, bars, and the chart recalculate automatically.

## Notes

- Pure prototype: no login, no server, no persistence.
- To change the demo refresh interval, edit the `setInterval(checkForUpdates, 30000)` line in `script.js`.
