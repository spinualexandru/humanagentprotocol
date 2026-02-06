if (!window.__TAURI__) {
  document.getElementById('ticket-list').innerHTML =
    '<div class="empty-state"><p style="color:#f87171">Tauri API not available</p>' +
    '<p style="margin-top:8px;font-size:12px">Ensure withGlobalTauri is enabled in tauri.conf.json</p></div>';
  throw new Error('window.__TAURI__ not available');
}

const { invoke } = window.__TAURI__.core;

let currentTickets = [];
let showAll = false;

async function loadTickets() {
  try {
    currentTickets = showAll
      ? await invoke('list_all')
      : await invoke('list_pending');
    renderTickets();
  } catch (e) {
    console.error('Failed to load tickets:', e);
    document.getElementById('ticket-list').innerHTML =
      '<div class="empty-state"><p style="color:#f87171">Error loading tickets</p>' +
      '<p style="margin-top:8px;font-size:12px">' + escapeHtml(String(e)) + '</p></div>';
  }
}

function riskLevel(risk) {
  if (risk < 0.3) return 'low';
  if (risk < 0.7) return 'med';
  return 'high';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

const TERMINAL = ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED', 'CHANGES_REQUESTED'];

function renderTickets() {
  const el = document.getElementById('ticket-list');
  if (currentTickets.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No pending tickets</p><p style="margin-top:8px;font-size:12px">Tickets created by AI agents will appear here</p></div>';
    return;
  }
  el.innerHTML = currentTickets.map(function(t) {
    var rl = riskLevel(t.risk);
    var resolved = TERMINAL.includes(t.state);
    var summary = (t.intent && t.intent.summary) || (t.intent && t.intent.kind) || 'Unknown';
    return '<div class="ticket-card risk-' + rl + (resolved ? ' resolved' : '') + '" data-ticket-id="' + t.id + '">' +
      '<div class="ticket-header">' +
        '<span class="ticket-id">' + t.id + '</span>' +
        '<span class="ticket-priority ' + t.priority + '">' + t.priority + '</span>' +
      '</div>' +
      '<div class="ticket-summary">' + escapeHtml(summary) + '</div>' +
      '<div class="ticket-meta">' +
        '<span class="risk-badge ' + rl + '">risk ' + t.risk.toFixed(2) + '</span>' +
        '<span class="state-badge ' + t.state + '">' + t.state + '</span>' +
        '<span>' + timeAgo(t.created_at) + '</span>' +
        '<span>' + t.from + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showDetail(ticketId) {
  var ticket = currentTickets.find(function(t) { return t.id === ticketId; });
  if (!ticket) return;

  var el = document.getElementById('detail-content');
  var resolved = TERMINAL.includes(ticket.state);
  var rl = riskLevel(ticket.risk);
  var summary = (ticket.intent && ticket.intent.summary) || '';
  var details = (ticket.intent && ticket.intent.details) || {};
  var diff = details.diff || '';

  var diffHtml = '';
  if (diff) {
    diffHtml = '<div class="detail-section"><h3>Diff</h3><div class="diff-block">' +
      escapeHtml(diff).split('\n').map(function(line) {
        if (line.startsWith('+')) return '<span class="add">' + line + '</span>';
        if (line.startsWith('-')) return '<span class="del">' + line + '</span>';
        if (line.startsWith('@@')) return '<span class="hunk">' + line + '</span>';
        return line;
      }).join('\n') +
    '</div></div>';
  }

  // Build tool input details for display
  var toolInput = details.tool_input || {};
  var toolInputHtml = '';
  if (details.tool_name) {
    var inputSummary = '';
    if (details.tool_name === 'Bash') {
      inputSummary = String(toolInput.command || '');
    } else if (details.tool_name === 'Edit') {
      inputSummary = 'file: ' + String(toolInput.file_path || '');
    } else if (details.tool_name === 'Write') {
      inputSummary = 'file: ' + String(toolInput.file_path || '');
    } else {
      inputSummary = JSON.stringify(toolInput).slice(0, 200);
    }
    toolInputHtml = '<div class="detail-field"><span class="detail-label">Tool Input</span><div class="detail-value" style="font-family:monospace;white-space:pre-wrap;word-break:break-all;font-size:12px">' + escapeHtml(inputSummary) + '</div></div>';
  }

  el.innerHTML =
    '<h2 style="margin-bottom:16px">' + escapeHtml(summary) + '</h2>' +

    '<div class="detail-section">' +
      '<div class="detail-field"><span class="detail-label">ID</span><div class="detail-value" style="font-family:monospace">' + ticket.id + '</div></div>' +
      '<div class="detail-field"><span class="detail-label">From</span><div class="detail-value">' + ticket.from + '</div></div>' +
      '<div class="detail-field"><span class="detail-label">Priority</span><div class="detail-value"><span class="ticket-priority ' + ticket.priority + '">' + ticket.priority + '</span></div></div>' +
      '<div class="detail-field"><span class="detail-label">Risk</span><div class="detail-value"><span class="risk-badge ' + rl + '">' + ticket.risk.toFixed(2) + '</span></div></div>' +
      '<div class="detail-field"><span class="detail-label">State</span><div class="detail-value"><span class="state-badge ' + ticket.state + '">' + ticket.state + '</span></div></div>' +
      '<div class="detail-field"><span class="detail-label">Created</span><div class="detail-value">' + ticket.created_at + ' (' + timeAgo(ticket.created_at) + ')</div></div>' +
      '<div class="detail-field"><span class="detail-label">Intent</span><div class="detail-value">' + ((ticket.intent && ticket.intent.kind) || '') + '</div></div>' +
      toolInputHtml +
      (details.file ? '<div class="detail-field"><span class="detail-label">File</span><div class="detail-value" style="font-family:monospace">' + escapeHtml(String(details.file)) + '</div></div>' : '') +
      (details.lines_added !== undefined ? '<div class="detail-field"><span class="detail-label">Changes</span><div class="detail-value">+' + (details.lines_added||0) + ' -' + (details.lines_removed||0) + '</div></div>' : '') +
    '</div>' +

    diffHtml +

    (resolved ? '' :
      '<div class="action-bar">' +
        '<button class="btn btn-approve" data-action="approve" data-ticket="' + ticket.id + '">Approve</button>' +
        '<button class="btn btn-reject" data-action="reject" data-ticket="' + ticket.id + '">Reject</button>' +
      '</div>'
    );

  document.getElementById('ticket-detail').classList.remove('hidden');
}

function closeDetail() {
  document.getElementById('ticket-detail').classList.add('hidden');
}

async function doApprove(ticketId) {
  try {
    await invoke('approve_ticket', { ticketId: ticketId, comment: null });
    closeDetail();
    await loadTickets();
  } catch (e) {
    alert('Failed to approve: ' + e);
  }
}

async function doReject(ticketId) {
  try {
    await invoke('reject_ticket', { ticketId: ticketId, comment: null });
    closeDetail();
    await loadTickets();
  } catch (e) {
    alert('Failed to reject: ' + e);
  }
}

// Event delegation instead of inline onclick handlers
document.addEventListener('click', function(e) {
  var card = e.target.closest('.ticket-card');
  if (card) {
    showDetail(card.dataset.ticketId);
    return;
  }

  var actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    var action = actionBtn.dataset.action;
    var ticketId = actionBtn.dataset.ticket;
    if (action === 'approve') doApprove(ticketId);
    else if (action === 'reject') doReject(ticketId);
    return;
  }

  if (e.target.closest('.detail-overlay') || e.target.closest('.close-btn')) {
    closeDetail();
  }
});

// Init
document.getElementById('refresh-btn').addEventListener('click', loadTickets);
document.getElementById('show-all').addEventListener('change', function(e) {
  showAll = e.target.checked;
  loadTickets();
});

// Auto-refresh every 3 seconds
loadTickets();
setInterval(loadTickets, 3000);
