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
      <td>${item.state || '—'}</td>
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
    if (item.state) stateCount[item.state] = (stateCount[item.state] || 0) + 1;
  });

  const renderBreakdownCard = (title, counts) => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return '';
    return `
      <div class="breakdown-card">
        <h4>${title}</h4>
        ${sorted.slice(0, 8).map(([label, count]) => `
          <div class="breakdown-item">
            <span class="label">${label}</span>
            <span class="count">${count}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  breakdownDiv.innerHTML = `
    ${renderBreakdownCard('By Type', typeCount)}
    ${renderBreakdownCard('By Platform', platformCount)}
    ${renderBreakdownCard('By State', stateCount)}
  `;
}

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
