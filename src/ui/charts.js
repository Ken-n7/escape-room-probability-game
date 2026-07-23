// ═══════════════════════════════════════════════════════════════════════════════
//  Chart.js + Lucide glue for the admin dashboard.
//  Builders return an HTML string (a <canvas>) and queue a chart spec; after the
//  dashboard writes its innerHTML, mountCharts() instantiates them. Both libs load
//  lazily (see charts-lib.js) so the game bundle is unaffected.
// ═══════════════════════════════════════════════════════════════════════════════

// Fixed light-theme palette (mirrors the dashboard CSS vars).
const INK = '#0f172a', MUTED = '#64748b', LINE = '#e5eaf1', LINE2 = '#eef2f7';
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

let _lib = null;                 // cached { Chart, createIcons, lucideIcons }
const _pending = [];             // chart specs awaiting a canvas in the DOM
const _live = [];                // instantiated Chart objects (destroyed on re-render)
let _cid = 0;

async function ensureLib() {
  if (!_lib) {
    _lib = await import('./charts-lib.js');
    const { Chart } = _lib;
    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = MUTED;
    Chart.defaults.plugins.tooltip.backgroundColor = INK;
    Chart.defaults.plugins.tooltip.padding = 9;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
    Chart.defaults.animation.duration = 520;
    Chart.register(centerTextPlugin);
  }
  return _lib;
}

// Draws a big value + small label in the hole of a doughnut/gauge.
const centerTextPlugin = {
  id: 'centerText',
  afterDatasetsDraw(chart) {
    const o = chart.options.plugins.centerText;
    if (!o || o.value == null) return;
    const { ctx, chartArea: { left, right, top, bottom } } = chart;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.font = `750 ${o.size || 24}px ${FONT}`;
    ctx.fillText(String(o.value), cx, cy - (o.label ? 7 : 0));
    if (o.label) { ctx.fillStyle = MUTED; ctx.font = `600 11px ${FONT}`; ctx.fillText(o.label, cx, cy + 13); }
    ctx.restore();
  },
};

// ── lifecycle ────────────────────────────────────────────────────────────────
export function resetCharts() {           // call before rebuilding the body
  while (_live.length) { try { _live.pop().destroy(); } catch { /* detached */ } }
  _pending.length = 0;
}
export async function mountCharts() {      // call after innerHTML is in the DOM
  if (!_pending.length) return;
  const { Chart } = await ensureLib();
  const specs = _pending.splice(0);
  for (const { id, config } of specs) {
    const el = document.getElementById(id);
    if (el) _live.push(new Chart(el.getContext('2d'), config));
  }
}
function queue(config, { height = 220, cls = '' } = {}) {
  const id = `chart-${++_cid}`;
  _pending.push({ id, config });
  return `<div class="chart-box ${cls}" style="height:${height}px"><canvas id="${id}"></canvas></div>`;
}

// ── icons (Lucide) ─────────────────────────────────────────────────────────────
export const icon = name => `<i data-lucide="${name}"></i>`;
export async function mountIcons(root) {
  if (!root?.querySelector('[data-lucide]')) return;
  const { createIcons, lucideIcons } = await ensureLib();
  createIcons({ icons: lucideIcons, attrs: { 'stroke-width': 2 }, root });
}

// ── chart builders (drop-in replacements for the old SVG helpers) ───────────────
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// Doughnut with a legend + centre headline. `segments` = [{label,value,color}].
export function donutChart(segments, { centerValue = '', centerLabel = '', height = 240 } = {}) {
  const live = segments.filter(s => s.value > 0);
  const total = live.reduce((s, x) => s + x.value, 0) || 1;
  return queue({
    type: 'doughnut',
    data: {
      labels: live.map(s => s.label),
      datasets: [{
        data: live.map(s => s.value),
        backgroundColor: live.map(s => s.color),
        borderColor: '#fff', borderWidth: 2, hoverOffset: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        centerText: { value: centerValue, label: centerLabel },
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14,
            generateLabels: chart => chart.data.labels.map((label, i) => {
              const v = chart.data.datasets[0].data[i];
              return {
                text: `${label}  ${v} · ${pct(v, total)}%`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                strokeStyle: chart.data.datasets[0].backgroundColor[i],
                index: i, fontColor: INK,
              };
            }),
          },
        },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed} (${pct(c.parsed, total)}%)` } },
      },
    },
  }, { height });
}

// Radial gauge for one 0–100 metric — a 270° arc with a centre percentage.
export function gaugeChart(value, { label = '', color = '#2563eb', height = 200 } = {}) {
  const v = Math.max(0, Math.min(100, value));
  return queue({
    type: 'doughnut',
    data: { datasets: [{ data: [v, 100 - v], backgroundColor: [color, LINE2], borderWidth: 0, circumference: 270, rotation: -135 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '76%',
      plugins: { centerText: { value: `${value}%`, label, size: 26 }, legend: { display: false }, tooltip: { enabled: false } },
    },
  }, { height });
}

// Filled area/line trend. `points` = [{label, full?, value}].
export function areaChart(points, { unit = '', color = '#2563eb', height = 200 } = {}) {
  return queue({
    type: 'line',
    data: {
      labels: points.map(p => p.label || ''),
      datasets: [{
        data: points.map(p => p.value),
        borderColor: color, borderWidth: 2, tension: 0.35,
        pointRadius: 2.5, pointHoverRadius: 5, pointBackgroundColor: color,
        fill: true,
        backgroundColor: ctx => {
          const { chart } = ctx; const { ctx: c, chartArea } = chart;
          if (!chartArea) return 'transparent';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, 'rgba(37,99,235,0.26)'); g.addColorStop(1, 'rgba(37,99,235,0)');
          return g;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => points[items[0].dataIndex]?.full || items[0].label, label: c => ` ${c.parsed.y}${unit}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: LINE2 }, border: { display: false }, ticks: { precision: 0 } },
      },
    },
  }, { height });
}

// Multi-line accuracy chart on a fixed 0–100 scale. `labels` = [{axis,tip}];
// `series` = [{name,color,vals}] where vals may contain nulls (gaps spanned).
export function lineChart(labels, series, { height = 260 } = {}) {
  return queue({
    type: 'line',
    data: {
      labels: labels.map(l => l.axis),
      datasets: series.map(s => ({
        label: s.name, data: s.vals, borderColor: s.color, backgroundColor: s.color,
        borderWidth: 2, tension: 0.3, spanGaps: true,
        pointRadius: 2.5, pointHoverRadius: 5,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12, color: MUTED } },
        tooltip: { callbacks: { title: items => labels[items[0].dataIndex]?.tip || '', label: c => ` ${c.dataset.label}: ${c.parsed.y}%` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { min: 0, max: 100, grid: { color: LINE2 }, border: { display: false }, ticks: { stepSize: 25, callback: v => v } },
      },
    },
  }, { height });
}

// Horizontal bars. `items` = [{label,value,display?}]; colorByValue tints by band.
const band = v => v >= 75 ? '#16a34a' : v >= 50 ? '#d97706' : '#dc2626';
export function barChart(items, { colorByValue = false, unit = '', color = '#2563eb', height } = {}) {
  const h = height || Math.max(120, items.length * 34 + 30);
  return queue({
    type: 'bar',
    data: {
      labels: items.map(i => i.label),
      datasets: [{
        data: items.map(i => i.value),
        backgroundColor: colorByValue ? items.map(i => band(i.value)) : color,
        borderRadius: 5, borderSkipped: false, barThickness: 'flex', maxBarThickness: 22,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${items[c.dataIndex].display ?? c.parsed.x}${unit}` } },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: LINE2 }, border: { display: false }, ticks: { precision: 0 } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: INK, font: { weight: '500' } } },
      },
    },
  }, { height: h });
}
