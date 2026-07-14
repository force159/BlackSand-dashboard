/* ============================================================
   Real Estate Leasing Dashboard — Vanilla JS
   Handles: live clock, KPI calculations, progress bars,
            tenant table (search + sort), doughnut chart,
            and simulated auto-refresh.
   No backend — all data lives here.
   ============================================================ */

/* ---------- Source data ---------- */
const leasingData = {
  retail:  { gla: 1892,  leasedPct: 52 },
  offices: { gla: 11267, leasedPct: 47 },
};

const tenants = [
  { name: "Crocs",           category: "Retail", area: 280  },
  { name: "Gap",             category: "Retail", area: 190  },
  { name: "Nike",            category: "Retail", area: 240  },
  { name: "Starbucks",       category: "Retail", area: 150  },
  { name: "Sephora",         category: "Retail", area: 175  },
  { name: "ABC Consulting",  category: "Office", area: 1450 },
  { name: "Tech Solutions",  category: "Office", area: 1200 },
  { name: "Global Finance",  category: "Office", area: 900  },
  { name: "Creative Studio", category: "Office", area: 650  },
  { name: "Legal Partners",  category: "Office", area: 720  },
];

/* ---------- Small helpers ---------- */
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-US"); // thousands separators

/* ============================================================
   1) LIVE CLOCK — updates every second
   ============================================================ */
function updateClock() {
  const now = new Date();
  const opts = {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  };
  $("live-clock").textContent = now.toLocaleString("en-US", opts);
}

/* ============================================================
   2) KPI CALCULATIONS
   Total GLA = retail + offices
   Total Leased % = weighted by GLA (leased area / total area)
   ============================================================ */
function renderKPIs() {
  const r = leasingData.retail;
  const o = leasingData.offices;

  // Individual cards + progress bars
  $("retail-gla").textContent  = fmt(r.gla) + " m²";
  $("offices-gla").textContent = fmt(o.gla) + " m²";
  $("retail-pct").textContent  = r.leasedPct + "%";
  $("offices-pct").textContent = o.leasedPct + "%";
  $("retail-bar").style.width  = r.leasedPct + "%";
  $("offices-bar").style.width = o.leasedPct + "%";

  // Totals
  const totalGla = r.gla + o.gla;
  const leasedArea = (r.gla * r.leasedPct / 100) + (o.gla * o.leasedPct / 100);
  const totalPct = (leasedArea / totalGla) * 100;

  $("total-gla").textContent = fmt(totalGla) + " m²";
  $("total-pct").textContent = totalPct.toFixed(1) + "%";
  // width set after a tick so the CSS transition animates
  requestAnimationFrame(() => { $("total-bar").style.width = totalPct.toFixed(1) + "%"; });

  return { totalPct };
}

/* ============================================================
   3) TENANT TABLE — render, search, sort
   ============================================================ */
let currentSort = { key: "name", dir: 1 }; // dir: 1 asc, -1 desc

function renderTable(list) {
  const body = $("tenant-body");
  body.innerHTML = "";

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted)">No tenants found.</td></tr>`;
    return;
  }

  list.forEach((t) => {
    const pillClass = t.category === "Retail" ? "retail" : "office";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${t.name}</td>
      <td><span class="pill ${pillClass}">${t.category}</span></td>
      <td class="num">${fmt(t.area)}</td>
    `;
    body.appendChild(row);
  });
}

function getFilteredSorted() {
  const q = $("tenant-search").value.trim().toLowerCase();

  let list = tenants.filter((t) =>
    t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
  );

  list.sort((a, b) => {
    if (currentSort.key === "area") return (a.area - b.area) * currentSort.dir;
    return a.name.localeCompare(b.name) * currentSort.dir;
  });

  return list;
}

function refreshTable() {
  renderTable(getFilteredSorted());
}

function setupTableControls() {
  $("tenant-search").addEventListener("input", refreshTable);

  $("sort-name").addEventListener("click", () => {
    // toggle direction if already sorting by name
    currentSort.dir = currentSort.key === "name" ? -currentSort.dir : 1;
    currentSort.key = "name";
    markActiveSort("sort-name");
    refreshTable();
  });

  $("sort-area").addEventListener("click", () => {
    currentSort.dir = currentSort.key === "area" ? -currentSort.dir : 1;
    currentSort.key = "area";
    markActiveSort("sort-area");
    refreshTable();
  });
}

function markActiveSort(activeId) {
  ["sort-name", "sort-area"].forEach((id) => $(id).classList.toggle("active", id === activeId));
}

/* ============================================================
   4) DOUGHNUT CHART — Leased vs Vacant (Chart.js)
   ============================================================ */
function renderChart(totalPct) {
  const ctx = $("occupancy-chart");
  if (!ctx || typeof Chart === "undefined") return;

  const leased = Math.round(totalPct);
  const vacant = 100 - leased;

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Leased", "Vacant"],
      datasets: [{
        data: [leased, vacant],
        backgroundColor: ["#afdfe1", "#1b242e"],
        borderColor: "#121820",
        borderWidth: 3,
        hoverOffset: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (c) => `${c.label}: ${c.parsed}%` },
          bodyFont: { size: 16 },
        },
      },
    },
  });
}

/* ============================================================
   5) AUTO-REFRESH SIMULATION
   Real cycle: every 5 days. Demo: every 30 seconds.
   On each check: update "Last Updated" + show a toast.
   ============================================================ */
function updateLastUpdated() {
  const now = new Date();
  $("last-updated").textContent = now.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

let toastTimer = null;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function checkForUpdates() {
  updateLastUpdated();
  showToast("Tenant list checked successfully.");
}

/* ============================================================
   6) IDLE TENANT AUTO-PAGING
   After 10 minutes with no user activity, page the Tenant Directory
   to the next group of tenants every 20 seconds. ONLY the tenant list
   scrolls — nothing else on the dashboard moves, and no project switching
   is involved. Any user activity (mouse move/click, keyboard, touch,
   search input, or manual tenant scrolling) stops paging and restarts the
   10-minute idle timer.
   ============================================================ */
const IDLE_TIMEOUT  = 10 * 60 * 1000; // 10 minutes of no interaction
const PAGE_INTERVAL = 20 * 1000;      // page the tenant list every 20 seconds
let idleTimer = null;
let pagingTimer = null;
let isPaging = false;
let suppressScrollDetection = false;  // true while our own auto-scroll runs
let suppressTimer = null;

// The Tenant Directory's own scroll container.
function tenantScroller() {
  return document.querySelector(".table-scroll");
}

// Scroll to the next group of tenants; loop back to the top at the end.
function pageTenants() {
  const el = tenantScroller();
  if (!el) return;
  const maxTop = el.scrollHeight - el.clientHeight;
  if (maxTop <= 0) return;                            // nothing to page through
  const step = Math.max(0, el.clientHeight - 24);     // one viewport, slight overlap
  const nextTop = (el.scrollTop >= maxTop - 4) ? 0 : Math.min(el.scrollTop + step, maxTop);
  // Flag this programmatic scroll so it isn't mistaken for user activity.
  suppressScrollDetection = true;
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => { suppressScrollDetection = false; }, 1500);
  el.scrollTo({ top: nextTop, behavior: "smooth" });
}

function startTenantPaging() {
  if (isPaging) return;
  isPaging = true;
  pagingTimer = setInterval(pageTenants, PAGE_INTERVAL);
}

function stopTenantPaging() {
  if (!isPaging) return;
  isPaging = false;
  clearInterval(pagingTimer);
  pagingTimer = null;
}

// Any real interaction stops paging and rearms the idle timer. The auto-scroll
// is ignored (suppressScrollDetection) so it can't cancel itself.
function onUserActivity(e) {
  if (e && e.type === "scroll" && suppressScrollDetection) return;
  stopTenantPaging();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(startTenantPaging, IDLE_TIMEOUT);
}

function setupIdlePaging() {
  // capture:true also catches scrolling inside .table-scroll (element scroll
  // does not bubble to window), so manual tenant scrolling counts as activity.
  ["mousemove", "mousedown", "click", "keydown", "wheel", "touchstart", "scroll"].forEach((evt) => {
    window.addEventListener(evt, onUserActivity, { passive: true, capture: true });
  });
  // Search input explicitly counts as activity too (covers paste, etc.).
  const search = $("tenant-search");
  if (search) search.addEventListener("input", onUserActivity);
  onUserActivity(); // arm the 10-minute idle timer
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  // Clock: now + every second
  updateClock();
  setInterval(updateClock, 1000);

  // KPIs + chart
  const { totalPct } = renderKPIs();
  renderChart(totalPct);

  // Table
  setupTableControls();
  markActiveSort("sort-name");
  refreshTable();

  // First "Last Updated" stamp
  updateLastUpdated();

  // Auto-refresh every 30s (demo stand-in for a 5-day cycle)
  setInterval(checkForUpdates, 30000);

  // Idle tenant auto-paging: after 10 min idle, page the list every 20s
  setupIdlePaging();
}

document.addEventListener("DOMContentLoaded", init);
