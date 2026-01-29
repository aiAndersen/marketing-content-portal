// Initialize Supabase Client
const supabaseClient = window.supabase.createClient(
  SUPABASE_CONFIG.url,
  SUPABASE_CONFIG.anonKey
);

// Form Elements
const form = document.getElementById('content-form');
const successMessage = document.getElementById('success-message');
const submitText = document.getElementById('submit-text');
const submitLoading = document.getElementById('submit-loading');

// Handle Form Submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Disable submit button
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitText.classList.add('hidden');
  submitLoading.classList.remove('hidden');

  try {
    // Get form data
    const formData = new FormData(form);
    const data = {
      type: formData.get('type'),
      title: formData.get('title'),
      live_link: formData.get('live_link'),
      ungated_link: formData.get('ungated_link') || null,
      platform: formData.get('platform'),
      state: formData.get('state') || null,
      summary: formData.get('summary'),
      tags: formData.get('tags') || null,
      last_updated: new Date().toISOString(),
      // Note: created_at is auto-populated by database on insert
    };

    // Insert into Supabase
    const { error } = await supabaseClient
      .from('marketing_content')
      .insert([data]);

    if (error) throw error;

    // Track content submission in Heap
    if (window.heap) {
      heap.track('Content Submitted', {
        content_type: data.type,
        platform: data.platform,
        state: data.state || 'National',
        has_ungated_link: !!data.ungated_link
      });
    }

    // Show success message
    form.classList.add('hidden');
    successMessage.classList.remove('hidden');

  } catch (error) {
    console.error('Error submitting content:', error);
    alert('Error submitting content. Please try again or contact IT support.');

    // Re-enable button
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoading.classList.add('hidden');
  }
});

// Reset form to submit another
function resetForm() {
  form.reset();
  form.classList.remove('hidden');
  successMessage.classList.add('hidden');

  // Re-enable submit button
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = false;
  submitText.classList.remove('hidden');
  submitLoading.classList.add('hidden');
}

// ============================================
// REPORTS FUNCTIONALITY
// ============================================

let reportData = []; // Store loaded report data for export
let currentPeriod = 'last30'; // Track active period
let allContentData = [];
let allContentLoaded = false;
let selectedState = null;
let currentReportRange = { from: null, to: null };
const chartRegistry = {};

const STATE_NAME_MAP = {
  National: 'National',
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming'
};

// Switch between tabs
function switchTab(tab) {
  // Track tab switch in Heap
  if (window.heap) {
    heap.track('Tab Switched', { tab_name: tab });
  }
  const submitSection = document.getElementById('main-content');
  const reportsSection = document.getElementById('reports-section');
  const editSection = document.getElementById('edit-section');
  const successMsg = document.getElementById('success-message');
  const tabs = document.querySelectorAll('.nav-tab');

  // Update active tab
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  // Hide all sections first
  submitSection.classList.add('hidden');
  reportsSection.classList.add('hidden');
  editSection.classList.add('hidden');
  successMsg.classList.add('hidden');

  if (tab === 'submit') {
    submitSection.classList.remove('hidden');
    form.classList.remove('hidden');
  } else if (tab === 'reports') {
    reportsSection.classList.remove('hidden');
    // Auto-load last 30 days on first visit
    if (reportData.length === 0) {
      loadReportPeriod('last30');
    }
    ensureAllContentData();
  } else if (tab === 'edit') {
    editSection.classList.remove('hidden');
  }
}

// Load report by preset period
async function loadReportPeriod(period) {
  // Track report period selection in Heap
  if (window.heap) {
    heap.track('Report Period Selected', { period: period });
  }
  currentPeriod = period;

  // Update button states
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(
      period === 'last30' ? 'last 30' : period === 'annual' ? 'this year' : 'all'
    ));
  });

  // Clear custom date inputs
  document.getElementById('report-date-from').value = '';
  document.getElementById('report-date-to').value = '';

  // Calculate dates
  let dateFrom = null;
  const now = new Date();

  if (period === 'last30') {
    dateFrom = new Date(now);
    dateFrom.setDate(dateFrom.getDate() - 30);
  } else if (period === 'annual') {
    dateFrom = new Date(now.getFullYear(), 0, 1); // Jan 1 of current year
  }
  // 'all' has no date filter

  currentReportRange = {
    from: dateFrom ? dateFrom.toISOString().split('T')[0] : null,
    to: null
  };
  await fetchReportData(dateFrom ? dateFrom.toISOString().split('T')[0] : null, null);
}

// Load report with custom date range
async function loadReport() {
  const dateFrom = document.getElementById('report-date-from').value;
  const dateTo = document.getElementById('report-date-to').value;

  // Deactivate quick filter buttons
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  currentReportRange = {
    from: dateFrom || null,
    to: dateTo || null
  };
  await fetchReportData(dateFrom || null, dateTo || null);
}

// Fetch report data from database
async function fetchReportData(dateFrom, dateTo) {
  const exportBtn = document.getElementById('export-csv-btn');

  try {
    let query = supabaseClient
      .from('marketing_content')
      .select('*')
      .order('created_at', { ascending: false });

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt('created_at', endDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query;

    if (error) throw error;

    reportData = data || [];
    renderReport(reportData);
    renderBreakdown(reportData);
    renderInsights(reportData);
    ensureAllContentData();
    exportBtn.disabled = reportData.length === 0;

  } catch (error) {
    console.error('Error loading report:', error);
    alert('Error loading report. Please try again.');
  }
}

// Render report summary and table
function renderReport(data) {
  const tbody = document.getElementById('reports-tbody');
  const summaryDiv = document.getElementById('reports-summary');

  // Calculate summary stats
  const typeCount = {};
  data.forEach(item => {
    typeCount[item.type] = (typeCount[item.type] || 0) + 1;
  });

  // Get top 4 types for summary
  const topTypes = Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  summaryDiv.innerHTML = `
    <div class="summary-stat">
      <div class="stat-value">${data.length}</div>
      <div class="stat-label">Total Submissions</div>
    </div>
    ${topTypes.map(([type, count]) => `
      <div class="summary-stat">
        <div class="stat-value">${count}</div>
        <div class="stat-label">${type}</div>
      </div>
    `).join('')}
  `;

  // Render table
  if (data.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No submissions found for the selected period</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(item => `
    <tr>
      <td>${item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</td>
      <td><span class="type-badge">${item.type || 'N/A'}</span></td>
      <td>${item.title || 'Untitled'}</td>
      <td>${normalizeState(item.state) || '—'}</td>
      <td>${item.platform || '—'}</td>
      <td>${item.live_link ? `<a href="${item.live_link}" target="_blank">View</a>` : '—'}</td>
    </tr>
  `).join('');
}

// Render type/platform/state breakdown
function renderBreakdown(data) {
  const breakdownDiv = document.getElementById('reports-breakdown');

  // Count by type, platform, state
  const typeCount = {};
  const platformCount = {};
  const stateCount = {};

  data.forEach(item => {
    if (item.type) typeCount[item.type] = (typeCount[item.type] || 0) + 1;
    if (item.platform) platformCount[item.platform] = (platformCount[item.platform] || 0) + 1;
    const stateKey = normalizeState(item.state);
    if (stateKey) stateCount[stateKey] = (stateCount[stateKey] || 0) + 1;
  });

  const renderBreakdownCard = (title, counts, isState = false) => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return '';
    return `
      <div class="breakdown-card">
        <h4>${title}</h4>
        ${sorted.slice(0, 8).map(([label, count]) => `
          <div class="breakdown-item ${isState ? 'clickable' : ''}" ${isState ? `onclick="openStateDetail('${label}')"` : ''}>
            <span class="label">${isState ? getStateDisplayName(label) : label}</span>
            <span class="count">${count}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  breakdownDiv.innerHTML = `
    ${renderBreakdownCard('By Type', typeCount)}
    ${renderBreakdownCard('By Platform', platformCount)}
    ${renderBreakdownCard('By State (Top 8)', stateCount, true)}
  `;
}

function normalizeState(state) {
  const cleaned = (state || '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'national') return 'National';
  if (cleaned.length === 2) return cleaned.toUpperCase();
  return cleaned;
}

function getStateDisplayName(stateKey) {
  return STATE_NAME_MAP[stateKey] || stateKey;
}

function ensureAllContentData() {
  if (allContentLoaded) return;
  fetchAllContentData();
}

async function fetchAllContentData() {
  try {
    const { data, error } = await supabaseClient
      .from('marketing_content')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allContentData = data || [];
    allContentLoaded = true;
    renderStateExplorer(allContentData);
    if (selectedState) {
      renderStateDetail(selectedState);
    }
  } catch (error) {
    console.error('Error loading full content set:', error);
  }
}

function renderInsights(data) {
  const trendMeta = document.getElementById('trend-meta');

  if (!data || data.length === 0) {
    trendMeta.textContent = 'No data yet';
    destroyChart('trend-chart');
    destroyChart('type-bar-chart');
    destroyChart('platform-donut-chart');
    destroyChart('type-donut-chart');
    return;
  }

  const { labels, values, granularity } = buildTrendSeries(data, currentReportRange);
  const rangeLabel = buildRangeLabel(currentReportRange, data);
  trendMeta.textContent = `${rangeLabel} · ${granularityLabel(granularity)}`;

  createOrUpdateChart('trend-chart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Submissions',
        data: values,
        borderColor: '#2B7383',
        backgroundColor: 'rgba(43, 115, 131, 0.15)',
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointBackgroundColor: '#2B7383'
      }]
    },
    options: baseChartOptions('Submissions')
  });

  const typeCounts = countByKey(data, item => item.type || 'Other');
  const topTypes = sortedEntries(typeCounts).slice(0, 8);
  createOrUpdateChart('type-bar-chart', {
    type: 'bar',
    data: {
      labels: topTypes.map(([label]) => label),
      datasets: [{
        label: 'Count',
        data: topTypes.map(([, count]) => count),
        backgroundColor: '#F4C546'
      }]
    },
    options: baseChartOptions('Count', true)
  });

  const platformCounts = countByKey(data, item => item.platform || 'Other');
  createOrUpdateChart('platform-donut-chart', {
    type: 'doughnut',
    data: {
      labels: Object.keys(platformCounts),
      datasets: [{
        data: Object.values(platformCounts),
        backgroundColor: ['#2B7383', '#F4C546', '#0F172A', '#7DD3FC', '#F97316', '#A78BFA', '#94A3B8']
      }]
    },
    options: donutOptions()
  });

  const typeMix = buildTopWithOther(typeCounts, 6);
  createOrUpdateChart('type-donut-chart', {
    type: 'doughnut',
    data: {
      labels: typeMix.labels,
      datasets: [{
        data: typeMix.values,
        backgroundColor: ['#0F172A', '#F4C546', '#2B7383', '#F97316', '#22C55E', '#94A3B8', '#E2E8F0']
      }]
    },
    options: donutOptions()
  });
}

function renderStateExplorer(data) {
  const grid = document.getElementById('state-grid');
  if (!grid) return;

  const totalCounts = countByKey(data, item => normalizeState(item.state));
  const last30Counts = countByKey(filterByLastDays(data, 30), item => normalizeState(item.state));

  const allStateKeys = new Set(Object.keys(STATE_NAME_MAP));
  Object.keys(totalCounts).forEach(key => allStateKeys.add(key));

  const cards = Array.from(allStateKeys).map(key => {
    const total = totalCounts[key] || 0;
    const last30 = last30Counts[key] || 0;
    return { key, total, last30 };
  }).sort((a, b) => b.total - a.total);

  grid.innerHTML = cards.map(card => `
    <div class="state-card ${card.total === 0 ? 'empty' : ''}" onclick="openStateDetail('${card.key}')">
      <div class="state-name">${getStateDisplayName(card.key)}</div>
      <div class="state-count">${card.total}</div>
      <div class="state-meta">${card.last30} in last 30 days</div>
    </div>
  `).join('');
}

function openStateDetail(stateKey) {
  selectedState = stateKey;
  if (!allContentLoaded) {
    ensureAllContentData();
    return;
  }
  renderStateDetail(stateKey);
  scrollToStateDetail();
}

function closeStateDetail() {
  const detail = document.getElementById('state-detail');
  if (detail) detail.classList.add('hidden');
}

function scrollToStateDetail() {
  const detail = document.getElementById('state-detail');
  if (!detail) return;
  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStateDetail(stateKey) {
  const detail = document.getElementById('state-detail');
  const title = document.getElementById('state-detail-title');
  const subtitle = document.getElementById('state-detail-subtitle');
  const kpis = document.getElementById('state-detail-kpis');
  const tbody = document.getElementById('state-detail-tbody');
  const countLabel = document.getElementById('state-detail-count');

  if (!detail || !title || !subtitle || !kpis || !tbody) return;

  const normalizedKey = normalizeState(stateKey);
  const stateData = allContentData.filter(item => normalizeState(item.state) === normalizedKey);
  const last30Data = filterByLastDays(stateData, 30);

  detail.classList.remove('hidden');
  title.textContent = `${getStateDisplayName(normalizedKey)} Detail`;
  subtitle.textContent = `All content in ${getStateDisplayName(normalizedKey)} with rolling 30-day insights.`;
  countLabel.textContent = `${stateData.length} total items`;

  const customerStories = stateData.filter(item => item.type === 'Customer Story').length;
  const videoCount = stateData.filter(item => item.type === 'Video' || item.type === 'Video Clip').length;
  const latestDate = stateData[0]?.created_at ? new Date(stateData[0].created_at).toLocaleDateString() : 'N/A';

  kpis.innerHTML = `
    <div class="summary-stat">
      <div class="stat-value">${stateData.length}</div>
      <div class="stat-label">Total Content</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${customerStories}</div>
      <div class="stat-label">Customer Stories</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${videoCount}</div>
      <div class="stat-label">Videos + Clips</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${last30Data.length}</div>
      <div class="stat-label">Last 30 Days</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${latestDate}</div>
      <div class="stat-label">Most Recent</div>
    </div>
  `;

  const rollingSeries = buildRollingSeries(last30Data, 30);
  createOrUpdateChart('state-rolling-chart', {
    type: 'line',
    data: {
      labels: rollingSeries.labels,
      datasets: [{
        label: 'Submissions',
        data: rollingSeries.values,
        borderColor: '#F97316',
        backgroundColor: 'rgba(249, 115, 22, 0.15)',
        fill: true,
        tension: 0.35,
        pointRadius: 2
      }]
    },
    options: baseChartOptions('Submissions')
  });

  const typeCounts = countByKey(stateData, item => item.type || 'Other');
  const topTypes = sortedEntries(typeCounts).slice(0, 6);
  createOrUpdateChart('state-type-chart', {
    type: 'bar',
    data: {
      labels: topTypes.map(([label]) => label),
      datasets: [{
        label: 'Count',
        data: topTypes.map(([, count]) => count),
        backgroundColor: '#2B7383'
      }]
    },
    options: baseChartOptions('Count', true)
  });

  const platformCounts = countByKey(stateData, item => item.platform || 'Other');
  const topPlatforms = sortedEntries(platformCounts).slice(0, 6);
  createOrUpdateChart('state-platform-chart', {
    type: 'bar',
    data: {
      labels: topPlatforms.map(([label]) => label),
      datasets: [{
        label: 'Count',
        data: topPlatforms.map(([, count]) => count),
        backgroundColor: '#0F172A'
      }]
    },
    options: baseChartOptions('Count', true)
  });

  if (stateData.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">No content found for this state</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = stateData.map(item => `
    <tr>
      <td>${item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</td>
      <td><span class="type-badge">${item.type || 'N/A'}</span></td>
      <td>${item.title || 'Untitled'}</td>
      <td>${item.platform || '—'}</td>
      <td>${item.live_link ? `<a href="${item.live_link}" target="_blank">View</a>` : '—'}</td>
    </tr>
  `).join('');
}

function filterByLastDays(data, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return data.filter(item => item.created_at && new Date(item.created_at) >= cutoff);
}

function buildRollingSeries(data, days) {
  const today = new Date();
  const labels = [];
  const values = [];
  const counts = {};

  data.forEach(item => {
    if (!item.created_at) return;
    const key = new Date(item.created_at).toISOString().split('T')[0];
    counts[key] = (counts[key] || 0) + 1;
  });

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    labels.push(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    values.push(counts[key] || 0);
  }

  return { labels, values };
}

function buildTrendSeries(data, range) {
  const dates = data
    .map(item => item.created_at ? new Date(item.created_at) : null)
    .filter(Boolean)
    .sort((a, b) => a - b);

  const start = range.from ? new Date(range.from) : dates[0];
  const end = range.to ? new Date(range.to) : dates[dates.length - 1];

  const dayCount = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const granularity = dayCount > 180 ? 'month' : dayCount > 60 ? 'week' : 'day';

  const buckets = {};
  dates.forEach(date => {
    const key = dateKey(date, granularity);
    buckets[key] = (buckets[key] || 0) + 1;
  });

  const labels = [];
  const values = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    const key = dateKey(cursor, granularity);
    labels.push(formatLabel(cursor, granularity));
    values.push(buckets[key] || 0);
    cursor = addStep(cursor, granularity);
  }

  return { labels, values, granularity };
}

function dateKey(date, granularity) {
  if (granularity === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  if (granularity === 'week') {
    const start = new Date(date);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    return start.toISOString().split('T')[0];
  }
  return date.toISOString().split('T')[0];
}

function addStep(date, granularity) {
  const next = new Date(date);
  if (granularity === 'month') {
    next.setMonth(next.getMonth() + 1);
    next.setDate(1);
    return next;
  }
  if (granularity === 'week') {
    next.setDate(next.getDate() + 7);
    return next;
  }
  next.setDate(next.getDate() + 1);
  return next;
}

function formatLabel(date, granularity) {
  if (granularity === 'month') {
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  if (granularity === 'week') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function granularityLabel(granularity) {
  if (granularity === 'month') return 'Monthly';
  if (granularity === 'week') return 'Weekly';
  return 'Daily';
}

function buildRangeLabel(range, data) {
  const dates = data
    .map(item => item.created_at ? new Date(item.created_at) : null)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const start = range.from ? new Date(range.from) : dates[0];
  const end = range.to ? new Date(range.to) : dates[dates.length - 1];
  if (!start || !end) return 'Range';
  return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
}

function countByKey(data, keyFn) {
  return data.reduce((acc, item) => {
    const key = keyFn(item) || 'Other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sortedEntries(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function buildTopWithOther(counts, limit) {
  const entries = sortedEntries(counts);
  const top = entries.slice(0, limit);
  const other = entries.slice(limit).reduce((sum, [, count]) => sum + count, 0);
  const labels = top.map(([label]) => label);
  const values = top.map(([, count]) => count);
  if (other > 0) {
    labels.push('Other');
    values.push(other);
  }
  return { labels, values };
}

function createOrUpdateChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
  }
  chartRegistry[id] = new Chart(canvas, config);
}

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

function baseChartOptions(yLabel, horizontal = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#475569', font: { size: 11 } }
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(148, 163, 184, 0.2)' },
        title: yLabel ? { display: false } : undefined,
        ticks: { color: '#475569', font: { size: 11 } }
      }
    }
  };
}

function donutOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#475569', boxWidth: 12 } }
    },
    cutout: '65%'
  };
}

// ============================================
// REPORTS AI ASSISTANT
// ============================================

const reportAI = {
  elements: {},
  busy: false
};

function initReportAI() {
  reportAI.elements = {
    messages: document.getElementById('reports-ai-messages'),
    input: document.getElementById('reports-ai-input'),
    sendBtn: document.getElementById('reports-ai-send'),
    status: document.getElementById('reports-ai-status')
  };

  if (!reportAI.elements.messages || !reportAI.elements.input || !reportAI.elements.sendBtn) {
    return;
  }

  reportAI.elements.sendBtn.addEventListener('click', () => sendReportAIMessage());
  reportAI.elements.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendReportAIMessage();
    }
  });

  if (reportAI.elements.messages.childElementCount === 0) {
    addReportAIMessage('assistant', 'Hi! Ask me about coverage gaps, content mix, trends, or specific states.');
  }
}

function setReportAIStatus(text, isError = false) {
  if (!reportAI.elements.status) return;
  reportAI.elements.status.textContent = text;
  reportAI.elements.status.style.color = isError ? '#dc2626' : '';
}

function addReportAIMessage(role, content) {
  if (!reportAI.elements.messages) return;
  const message = document.createElement('div');
  message.className = `reports-ai-message ${role}`;
  message.innerHTML = `
    <div class="role">${role === 'user' ? 'You' : 'AI'}</div>
    <div class="content">${escapeHtml(content)}</div>
  `;
  reportAI.elements.messages.appendChild(message);
  reportAI.elements.messages.scrollTop = reportAI.elements.messages.scrollHeight;
}

function sendReportAISuggestion(text) {
  if (!reportAI.elements.input) return;
  reportAI.elements.input.value = text;
  sendReportAIMessage();
}

async function sendReportAIMessage() {
  if (reportAI.busy) return;
  const inputText = (reportAI.elements.input?.value || '').trim();
  if (!inputText) return;

  addReportAIMessage('user', inputText);
  reportAI.elements.input.value = '';
  reportAI.busy = true;
  reportAI.elements.sendBtn.disabled = true;
  setReportAIStatus('Analyzing...');

  const context = buildReportContext();

  try {
    let responseText = '';
    if (!OPENAI_CONFIG?.apiKey) {
      responseText = generateLocalInsights(inputText, context);
      setReportAIStatus('Local insights');
    } else {
      responseText = await askReportAI(inputText, context);
      setReportAIStatus('Ready');
    }
    addReportAIMessage('assistant', responseText);
  } catch (error) {
    console.error('Report AI error:', error);
    const fallback = generateLocalInsights(inputText, context);
    addReportAIMessage('assistant', `${fallback}\n\nNote: Live AI call failed, so I used local insights.`);
    setReportAIStatus('Fallback', true);
  } finally {
    reportAI.busy = false;
    reportAI.elements.sendBtn.disabled = false;
  }
}

async function askReportAI(question, context) {
  const systemPrompt = `You are an AI insights assistant for the SchooLinks marketing content portal.
Use only the provided context. Do not fabricate numbers.
Be concise and actionable. Use bullets when helpful. If data is missing, say what to check.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_CONFIG.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Question: ${question}\n\nContext (JSON):\n${JSON.stringify(context, null, 2)}`
        }
      ],
      temperature: 0.2,
      max_tokens: 700
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from AI');
  }
  return content.trim();
}

function buildReportContext() {
  const source = allContentLoaded ? 'all_content' : 'report_range_only';
  const baseData = allContentLoaded ? allContentData : reportData;

  const totals = {
    total_items: baseData.length,
    last_30_days: filterByLastDays(baseData, 30).length,
    previous_30_days: filterByDaysRange(baseData, 60, 30).length
  };

  const reportRangeLabel = reportData.length ? buildRangeLabel(currentReportRange, reportData) : 'No data';
  const typeCounts = countByKey(baseData, item => item.type || 'Other');
  const platformCounts = countByKey(baseData, item => item.platform || 'Other');
  const stateCounts = countByKey(baseData, item => normalizeState(item.state));

  const topTypes = sortedEntries(typeCounts).slice(0, 6).map(([label, count]) => ({ label, count }));
  const topPlatforms = sortedEntries(platformCounts).slice(0, 6).map(([label, count]) => ({ label, count }));
  const topStates = sortedEntries(stateCounts).slice(0, 8).map(([label, count]) => ({
    label: getStateDisplayName(label),
    count
  }));

  const gapStates = Object.keys(STATE_NAME_MAP)
    .filter(key => !stateCounts[key])
    .map(key => getStateDisplayName(key))
    .slice(0, 12);

  return {
    context_source: source,
    report_range_label: reportRangeLabel,
    report_range_filters: currentReportRange,
    totals,
    top_types: topTypes,
    top_platforms: topPlatforms,
    top_states: topStates,
    gap_states: gapStates
  };
}

function generateLocalInsights(question, context) {
  const lower = question.toLowerCase();
  const lines = [];

  lines.push(`Totals: ${context.totals.total_items} items, ${context.totals.last_30_days} in last 30 days, ${context.totals.previous_30_days} in the prior 30 days.`);

  if (lower.includes('gap') || lower.includes('missing')) {
    lines.push(`Top gap states: ${context.gap_states.slice(0, 8).join(', ') || 'None'}.`);
  }

  if (lower.includes('type') || lower.includes('mix')) {
    const types = context.top_types.map(item => `${item.label} (${item.count})`).join(', ');
    lines.push(`Top content types: ${types || 'No data'}.`);
  }

  if (lower.includes('platform')) {
    const platforms = context.top_platforms.map(item => `${item.label} (${item.count})`).join(', ');
    lines.push(`Top platforms: ${platforms || 'No data'}.`);
  }

  if (lower.includes('state')) {
    const states = context.top_states.map(item => `${item.label} (${item.count})`).join(', ');
    lines.push(`Top states: ${states || 'No data'}.`);
  }

  if (lower.includes('trend') || lower.includes('last 30')) {
    const delta = context.totals.last_30_days - context.totals.previous_30_days;
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    lines.push(`Last 30 days are ${direction} by ${Math.abs(delta)} compared to the previous 30 days.`);
  }

  if (lines.length === 1) {
    lines.push('Try asking about gaps, content mix, platform trends, or a specific state.');
  }

  return lines.join('\n');
}

function filterByDaysRange(data, startDaysAgo, endDaysAgo) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - startDaysAgo);
  const end = new Date(now);
  end.setDate(end.getDate() - endDaysAgo);
  return data.filter(item => {
    if (!item.created_at) return false;
    const date = new Date(item.created_at);
    return date >= start && date < end;
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.addEventListener('DOMContentLoaded', () => {
  initReportAI();
});

// Export report to CSV
function exportReportCSV() {
  if (reportData.length === 0) return;

  // Track CSV export in Heap
  if (window.heap) {
    heap.track('Report Exported', {
      period: currentPeriod,
      row_count: reportData.length
    });
  }

  const headers = ['Submitted Date', 'Type', 'Title', 'Live Link', 'Ungated Link', 'Platform', 'State', 'Tags', 'Summary'];
  const rows = reportData.map(row => [
    row.created_at ? new Date(row.created_at).toLocaleDateString() : '',
    row.type || '',
    row.title || '',
    row.live_link || '',
    row.ungated_link || '',
    row.platform || '',
    row.state || '',
    row.tags || '',
    row.summary || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const periodLabel = currentPeriod === 'last30' ? 'last-30-days' :
                      currentPeriod === 'annual' ? new Date().getFullYear() : 'all-time';
  a.download = `content-submissions-${periodLabel}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// ============================================
// EDIT CONTENT FUNCTIONALITY
// ============================================

let editContentData = [];
let currentEditId = null;

// Search content for editing
async function searchContent() {
  const searchInput = document.getElementById('edit-search-input').value.trim();
  const typeFilter = document.getElementById('edit-type-filter').value;
  const resultsDiv = document.getElementById('edit-results');

  // Track content search in Heap
  if (window.heap) {
    heap.track('Content Searched', {
      search_term: searchInput || '(empty)',
      type_filter: typeFilter || 'All Types'
    });
  }

  if (!searchInput && !typeFilter) {
    resultsDiv.innerHTML = '<p class="edit-hint">Enter a search term or select a type filter</p>';
    return;
  }

  try {
    let query = supabaseClient
      .from('marketing_content')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (typeFilter) {
      query = query.eq('type', typeFilter);
    }

    if (searchInput) {
      query = query.or(`title.ilike.%${searchInput}%,tags.ilike.%${searchInput}%,summary.ilike.%${searchInput}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    editContentData = data || [];
    renderEditResults(editContentData);

  } catch (error) {
    console.error('Error searching content:', error);
    resultsDiv.innerHTML = '<p class="edit-hint" style="color: #dc2626;">Error searching. Please try again.</p>';
  }
}

// Render edit results table
function renderEditResults(data) {
  const resultsDiv = document.getElementById('edit-results');

  if (data.length === 0) {
    resultsDiv.innerHTML = '<p class="edit-hint">No content found matching your search</p>';
    return;
  }

  resultsDiv.innerHTML = `
    <table class="edit-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Type</th>
          <th>State</th>
          <th>Platform</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(item => `
          <tr>
            <td>${item.title || 'Untitled'}</td>
            <td><span class="type-badge">${item.type || 'N/A'}</span></td>
            <td>${item.state || '—'}</td>
            <td>${item.platform || '—'}</td>
            <td>
              <button class="action-btn edit" onclick="openEditModal('${item.id}')">Edit</button>
              <button class="action-btn delete" onclick="openDeleteModal('${item.id}', '${(item.title || '').replace(/'/g, "\\'")}')">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Open edit modal with content data
function openEditModal(id) {
  const item = editContentData.find(c => c.id === id);
  if (!item) return;

  currentEditId = id;

  // Populate form fields
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-type').value = item.type || '';
  document.getElementById('edit-platform').value = item.platform || '';
  document.getElementById('edit-title').value = item.title || '';
  document.getElementById('edit-live-link').value = item.live_link || '';
  document.getElementById('edit-ungated-link').value = item.ungated_link || '';
  document.getElementById('edit-state').value = item.state || '';
  document.getElementById('edit-tags').value = item.tags || '';
  document.getElementById('edit-summary').value = item.summary || '';

  document.getElementById('edit-modal').classList.remove('hidden');
}

// Close edit modal
function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  currentEditId = null;
}

// Save content edit
async function saveContentEdit(event) {
  event.preventDefault();

  if (!currentEditId) return;

  const data = {
    type: document.getElementById('edit-type').value,
    platform: document.getElementById('edit-platform').value,
    title: document.getElementById('edit-title').value,
    live_link: document.getElementById('edit-live-link').value || null,
    ungated_link: document.getElementById('edit-ungated-link').value || null,
    state: document.getElementById('edit-state').value || null,
    tags: document.getElementById('edit-tags').value || null,
    summary: document.getElementById('edit-summary').value || null,
    last_updated: new Date().toISOString()
  };

  try {
    const { error } = await supabaseClient
      .from('marketing_content')
      .update(data)
      .eq('id', currentEditId);

    if (error) throw error;

    // Track content edit in Heap
    if (window.heap) {
      heap.track('Content Edited', {
        content_type: data.type,
        content_title: data.title
      });
    }

    alert('Content updated successfully!');
    closeEditModal();
    searchContent(); // Refresh results

  } catch (error) {
    console.error('Error updating content:', error);
    alert('Error updating content. Please try again.');
  }
}

// Open delete confirmation modal
function openDeleteModal(id, title) {
  currentEditId = id;
  document.getElementById('delete-title').textContent = title;
  document.getElementById('delete-modal').classList.remove('hidden');
}

// Close delete modal
function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
}

// Confirm and execute delete
async function confirmDelete() {
  if (!currentEditId) return;

  try {
    const { error } = await supabaseClient
      .from('marketing_content')
      .delete()
      .eq('id', currentEditId);

    if (error) throw error;

    // Track content deletion in Heap
    if (window.heap) {
      heap.track('Content Deleted', {
        content_id: currentEditId
      });
    }

    alert('Content deleted successfully!');
    closeDeleteModal();
    closeEditModal();
    searchContent(); // Refresh results

  } catch (error) {
    console.error('Error deleting content:', error);
    alert('Error deleting content. Please try again.');
  }
}

// Delete from edit modal
function deleteContent() {
  if (!currentEditId) return;
  const title = document.getElementById('edit-title').value;
  closeEditModal();
  openDeleteModal(currentEditId, title);
}
