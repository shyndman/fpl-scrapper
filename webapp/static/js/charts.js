/**
 * FPL Dashboard — Chart.js helper factories
 * All charts share a dark theme and FPL colour palette.
 */

const FPL_COLORS = [
  "#00ff87",
  "#38bdf8",
  "#f97316",
  "#a78bfa",
  "#fb7185",
  "#fbbf24",
  "#34d399",
  "#e879f9",
  "#60a5fa",
  "#f87171",
];

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: true,
  animation: { duration: 600, easing: "easeInOutQuart" },
  plugins: {
    legend: {
      labels: {
        color: "#94a3b8",
        font: { family: "Inter, system-ui, sans-serif", size: 12 },
        boxWidth: 12,
        padding: 16,
      },
    },
    tooltip: {
      backgroundColor: "#0f1729",
      borderColor: "#1e2d4a",
      borderWidth: 1,
      titleColor: "#e2e8f0",
      bodyColor: "#94a3b8",
      padding: 10,
      cornerRadius: 6,
    },
  },
};

const SCALE_DEFAULTS = {
  x: {
    grid: { color: "rgba(30,45,74,0.5)", drawBorder: false },
    ticks: { color: "#64748b", font: { size: 11 } },
  },
  y: {
    grid: { color: "rgba(30,45,74,0.5)", drawBorder: false },
    ticks: { color: "#64748b", font: { size: 11 } },
  },
};

// ----------------------------------------------------------------
// Line chart: points / value over gameweeks
// ----------------------------------------------------------------
function createLineChart(canvasId, labels, datasets) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const styledDatasets = datasets.map((ds, i) => ({
    ...ds,
    borderColor: ds.borderColor || FPL_COLORS[i % FPL_COLORS.length],
    backgroundColor: "transparent",
    borderWidth: 2.5,
    pointBackgroundColor: ds.borderColor || FPL_COLORS[i % FPL_COLORS.length],
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.35,
    fill: false,
    spanGaps: true,
  }));

  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets: styledDatasets },
    options: {
      ...CHART_DEFAULTS,
      scales: SCALE_DEFAULTS,
    },
  });
}

// ----------------------------------------------------------------
// Bar chart: season totals comparison
// ----------------------------------------------------------------
function createBarChart(canvasId, labels, datasets, horizontal = false) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const styledDatasets = datasets.map((ds, i) => ({
    ...ds,
    backgroundColor:
      (ds.borderColor || FPL_COLORS[i % FPL_COLORS.length]) + "bb",
    borderColor: ds.borderColor || FPL_COLORS[i % FPL_COLORS.length],
    borderWidth: 1,
    borderRadius: 4,
    borderSkipped: false,
  }));

  return new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: styledDatasets },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: horizontal ? "y" : "x",
      scales: SCALE_DEFAULTS,
    },
  });
}

// ----------------------------------------------------------------
// Radar chart: multi-metric comparison / ICT
// ----------------------------------------------------------------
function createRadarChart(canvasId, labels, datasets) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const styledDatasets = datasets.map((ds, i) => {
    const col = ds.borderColor || FPL_COLORS[i % FPL_COLORS.length];
    return {
      ...ds,
      borderColor: col,
      backgroundColor: col + "22",
      borderWidth: 2,
      pointBackgroundColor: col,
      pointRadius: 3,
    };
  });

  return new Chart(ctx, {
    type: "radar",
    data: { labels, datasets: styledDatasets },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        r: {
          grid: { color: "rgba(30,45,74,0.7)" },
          angleLines: { color: "rgba(30,45,74,0.7)" },
          ticks: {
            color: "#64748b",
            backdropColor: "transparent",
            font: { size: 10 },
          },
          pointLabels: { color: "#94a3b8", font: { size: 11 } },
        },
      },
    },
  });
}

// ----------------------------------------------------------------
// Doughnut chart: e.g. position/team breakdown
// ----------------------------------------------------------------
function createDoughnutChart(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const existing = Chart.getChart(ctx);
  if (existing) existing.destroy();

  const palette = colors || FPL_COLORS;

  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: palette.map((c) => c + "cc"),
          borderColor: palette,
          borderWidth: 1,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: "65%",
    },
  });
}

// ----------------------------------------------------------------
// Update existing chart data (avoids full re-render)
// ----------------------------------------------------------------
function updateChartData(chart, labels, datasets) {
  if (!chart) return;
  chart.data.labels = labels;
  chart.data.datasets = datasets;
  chart.update("active");
}
