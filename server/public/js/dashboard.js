/**
 * DewClient Central Server - Dashboard & Local Admin Auth Controller
 */

const API_BASE = '/api/v1';

let currentSession = null;
let currentUser = null;
let currentTab = 'overview';
let accountsData = [];
let accountPage = 1;
let accountTotal = 0;
let serversData = [];
let newsData = [];
let announcementsData = [];
let maintenanceData = null;
let releaseData = null;
let cosmeticLibrary = [];
const cosmeticPreviewCache = new Map();
const cosmeticPreviewQueue = [];
const cosmeticPreviewQueued = new Set();
let cosmeticPreviewActive = 0;
let cosmeticPreviewObserver = null;
let bugReportsData = [];
let dashboardRefreshPromise = null;
let dashboardRefreshQueued = false;
let dashboardRefreshTimer = null;
let visibilityRefreshBound = false;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupButtons();
  initAdminAuth();
});

function initTheme() {
  const savedTheme = localStorage.getItem('dewclient_dashboard_theme') || 'black';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const toggle = document.getElementById('theme-toggle');
  toggle?.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'white' ? 'black' : 'white';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('dewclient_dashboard_theme', nextTheme);
    toggle.textContent = nextTheme === 'white' ? '☾' : '☼';
    toggle.setAttribute('aria-label', `Switch to ${nextTheme === 'white' ? 'black' : 'white'} theme`);
  });
  if (toggle) toggle.textContent = savedTheme === 'white' ? '☾' : '☼';
}

window.handleAdminLogin = async function(event) {
  if (event) event.preventDefault();

  const emailInput = document.getElementById('admin-email');
  const passwordInput = document.getElementById('admin-password');
  const email = (emailInput?.value || '').trim();
  const password = passwordInput?.value || '';

  if (!email || !password) {
    showLoginError('Please enter both your admin email and password.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error?.message || 'Invalid administrator credentials.');
    }

    const token = json.data?.token;
    if (!token) {
      throw new Error('Authentication token was not returned by the server.');
    }

    currentSession = { access_token: token };
    localStorage.setItem('dewclient_admin_session', token);
    await onUserAuthenticated(json.data?.user || { email, name: email.split('@')[0] });
  } catch (err) {
    showLoginError(err.message || 'Unable to sign in.');
  }
};

function setupButtons() {
  if (!document.documentElement.dataset.cosmeticActionsBound) {
    document.documentElement.dataset.cosmeticActionsBound = 'true';
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const assignButton = target?.closest('[data-assign-cosmetic-player]');
      if (assignButton) {
        void window.openCosmeticAssignment(assignButton.dataset.assignCosmeticPlayer);
        return;
      }
      const deleteButton = target?.closest('[data-delete-cosmetic-asset]');
      if (deleteButton) void window.deleteLibraryCosmetic(deleteButton.dataset.deleteCosmeticAsset);
      const freeCapeButton = target?.closest('[data-toggle-free-cosmetic]');
      if (freeCapeButton) void window.toggleLibraryCosmeticFree(freeCapeButton.dataset.toggleFreeCosmetic, freeCapeButton.dataset.isFree !== 'true');
      const updateReportButton = target?.closest('[data-update-bug-report]');
      if (updateReportButton) void updateBugReportStatus(updateReportButton.dataset.updateBugReport);
    });
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm && !loginForm.dataset.bound) {
    loginForm.dataset.bound = 'true';
    loginForm.addEventListener('submit', window.handleAdminLogin);
  }

  const btnSignout = document.getElementById('btn-signout');
  if (btnSignout && !btnSignout.dataset.bound) {
    btnSignout.dataset.bound = 'true';
    btnSignout.addEventListener('click', async () => {
      currentSession = null;
      localStorage.removeItem('dewclient_admin_session');
      window.location.reload();
    });
  }

  const reportFilter = document.getElementById('bug-report-filter');
  if (reportFilter && !reportFilter.dataset.bound) {
    reportFilter.dataset.bound = 'true';
    reportFilter.addEventListener('change', () => void fetchBugReports());
  }
  const refreshReports = document.getElementById('btn-refresh-bug-reports');
  if (refreshReports && !refreshReports.dataset.bound) {
    refreshReports.dataset.bound = 'true';
    refreshReports.addEventListener('click', () => void fetchBugReports());
  }
}

async function initAdminAuth() {
  try {
    const savedToken = localStorage.getItem('dewclient_admin_session');
    if (!savedToken) {
      showLoginScreen();
      return;
    }

    currentSession = { access_token: savedToken };
    await onUserAuthenticated({ email: 'admin@local', name: 'Administrator' });
  } catch (err) {
    showLoginError(`Failed to initialize admin authentication: ${err.message}`);
  }
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-dashboard').style.display = 'none';
}

function showLoginError(msg) {
  const errBox = document.getElementById('login-error');
  if (errBox) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
  }
}

async function onUserAuthenticated(userSession) {
  const token = currentSession?.access_token;
  let verifiedUser;
  if (!token) {
    showLoginScreen();
    return;
  }

  const userEmail = (userSession?.email || 'admin').toLowerCase().trim();

  try {
    const res = await fetch(`${API_BASE}/auth/verify-admin`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.warn('[AUTH] Admin rejected by backend:', userEmail);
      currentSession = null;
      localStorage.removeItem('dewclient_admin_session');
      showLoginScreen();
      showLoginError(json.error?.message || 'Access denied: invalid administrator session.');
      return;
    }
    verifiedUser = json.data.user;
  } catch (err) {
    console.error('[AUTH] Admin verification failed:', err);
    currentSession = null;
    localStorage.removeItem('dewclient_admin_session');
    showLoginScreen();
    showLoginError(`Verification failed: ${err.message}`);
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-dashboard').style.display = 'block';

  currentUser = verifiedUser;
  const email = currentUser.email || userSession?.email || 'Admin';
  const name = currentUser.name || userSession?.name || email.split('@')[0];
  const avatar = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`;

  const elName = document.getElementById('admin-name');
  const elEmail = document.getElementById('admin-profile-email');
  const elAvatar = document.getElementById('admin-avatar');

  if (elName) elName.textContent = name;
  if (elEmail) elEmail.textContent = email;
  if (elAvatar) elAvatar.src = avatar;

  initTabs();
  applyAdminAccess();
  initModals();
  initSearch();
  fetchStaff();
  loadAllData();
  startDashboardRefresh();
}

function applyAdminAccess() {
  document.querySelectorAll('[data-permission]').forEach((element) => {
    element.hidden = false;
  });
  const activeTab = document.querySelector('.nav-item.active:not([hidden])') || document.querySelector('.nav-item:not([hidden])');
  if (activeTab) {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item === activeTab);
      if (item === activeTab) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${activeTab.dataset.tab}`);
    });
    currentTab = activeTab.dataset.tab || 'overview';
  }
}

function getAuthHeaders() {
  const headers = { 'Accept': 'application/json' };
  if (currentSession?.access_token) {
    headers['Authorization'] = `Bearer ${currentSession.access_token}`;
  }
  return headers;
}

function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      if (!tab) return;

      navItems.forEach((n) => n.classList.remove('active'));
      navItems.forEach((n) => n.removeAttribute('aria-current'));
      item.classList.add('active');
      item.setAttribute('aria-current', 'page');

      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      const activePanel = document.getElementById(`panel-${tab}`);
      if (activePanel) activePanel.classList.add('active');

      currentTab = tab;
      loadAllData();
    });
  });
}

function startDashboardRefresh() {
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadAllData();
  }, 30_000);

  if (!visibilityRefreshBound) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadAllData();
    });
    visibilityRefreshBound = true;
  }
}

function loadAllData() {
  if (document.visibilityState !== 'visible') return Promise.resolve();
  if (dashboardRefreshPromise) {
    dashboardRefreshQueued = true;
    return dashboardRefreshPromise;
  }

  dashboardRefreshPromise = (async () => {
    do {
      dashboardRefreshQueued = false;
      const tasks = [updateServerStatus(), fetchStats()];
      if (currentTab === 'overview') tasks.push(fetchAccounts());
      if (currentTab === 'clients') tasks.push(fetchClients());
      if (currentTab === 'servers' || currentTab === 'news') tasks.push(fetchManifest());
      if (currentTab === 'releases') tasks.push(fetchReleaseStatus());
      if (currentTab === 'cosmetics') {
        tasks.push(fetchCosmeticLibrary());
      }
      if (currentTab === 'bug-reports') tasks.push(fetchBugReports());
      await Promise.allSettled(tasks);
    } while (dashboardRefreshQueued && document.visibilityState === 'visible');
  })().finally(() => {
    dashboardRefreshPromise = null;
  });

  return dashboardRefreshPromise;
}

async function updateServerStatus() {
  const relayStatus = document.getElementById('network-status');
  const storageStatus = document.getElementById('storage-status');
  try {
    const response = await fetch(`${API_BASE}/health`);
    const result = await response.json();
    const ready = response.ok && result.ok === true && result.status === 'healthy';
    if (relayStatus) relayStatus.textContent = ready ? 'Database connected' : 'Database unavailable';
    if (storageStatus) storageStatus.textContent = ready ? 'SUPABASE CONNECTED' : 'SUPABASE UNAVAILABLE';
  } catch {
    if (relayStatus) relayStatus.textContent = 'Database unavailable';
    if (storageStatus) storageStatus.textContent = 'SUPABASE UNAVAILABLE';
  }
}

async function fetchReleaseStatus() {
  try {
    const res = await fetch(`${API_BASE}/admin/release`, { headers: getAuthHeaders() });
    if (!res.ok) {
      return;
    }
    const json = await res.json();
    const release = json.data || null;
    releaseData = release;
    renderRelease(release);
  } catch (err) {
    console.error('Failed to fetch current release status:', err);
  }
}

async function fetchStats() {
  try {
    const res = await fetch(`${API_BASE}/stats`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    const data = json.data;

    document.getElementById('stat-accounts').textContent = data.totalAccounts ?? 0;
    document.getElementById('stat-online').textContent = `${data.onlineClients ?? 0} / ${data.totalClients ?? 0}`;
    document.getElementById('stat-servers').textContent = data.featuredServersCount ?? 0;
    document.getElementById('stat-cosmetics').textContent = data.cosmeticsCount ?? 0;
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

async function fetchAccounts() {
  try {
    const searchVal = document.getElementById('account-search')?.value || '';
    const res = await fetch(`${API_BASE}/accounts?limit=100&page=${accountPage}&search=${encodeURIComponent(searchVal)}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return;
    const json = await res.json();
    accountsData = json.data?.accounts || [];
    accountTotal = Number(json.data?.total) || 0;
    renderAccounts(accountsData);
    renderAccountPagination(Number(json.data?.pages) || 0);
  } catch (err) {
    console.error('Failed to fetch accounts:', err);
  }
}

function renderAccountPagination(pageCount) {
  const container = document.getElementById('account-pagination');
  if (!container) return;
  const first = accountTotal === 0 ? 0 : (accountPage - 1) * 100 + 1;
  const last = Math.min(accountPage * 100, accountTotal);
  container.innerHTML = `
    <span style="color:var(--text-muted);font-size:12px">Showing ${first}-${last} of ${accountTotal}</span>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" type="button" data-account-page="prev" ${accountPage <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn btn-secondary" type="button" data-account-page="next" ${accountPage >= pageCount ? 'disabled' : ''}>Next</button>
    </div>`;
  container.querySelector('[data-account-page="prev"]')?.addEventListener('click', () => {
    if (accountPage > 1) { accountPage -= 1; void fetchAccounts(); }
  });
  container.querySelector('[data-account-page="next"]')?.addEventListener('click', () => {
    if (accountPage < pageCount) { accountPage += 1; void fetchAccounts(); }
  });
}

function renderAccounts(accounts) {
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;

  if (accounts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 30px;">
          No player accounts have been shared yet. Users can opt in under Launcher Settings → Privacy.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = accounts.map((a) => {
    const playerUuid = String(a.uuid || '');
    const playerUsername = String(a.username || '');
    const canAssignCosmetics = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(playerUuid);
    const avatar = safeImageUrl(a.avatarUrl || (playerUsername ? `https://mc-heads.net/avatar/${encodeURIComponent(playerUsername)}/64` : ''));
    const avatarMarkup = avatar
      ? `<img class="player-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(playerUsername)}" onerror="this.remove()">`
      : `<div class="player-avatar" aria-hidden="true" style="display:grid;place-items:center;color:var(--text-muted);">${escapeHtml(playerUsername.trim().charAt(0).toUpperCase() || '?')}</div>`;
    const typeBadge = a.type === 'microsoft'
      ? `<span class="badge badge-microsoft">Microsoft</span>`
      : `<span class="badge badge-offline">Offline</span>`;

    const lastSeen = a.lastUsedAt ? timeAgo(new Date(a.lastUsedAt)) : 'Unknown';

    return `
      <tr>
        <td>
          <div class="player-cell">
            ${avatarMarkup}
            <div>
              <div class="player-name">${escapeHtml(a.username)}</div>
              <div class="player-uuid">${escapeHtml(a.uuid)}</div>
            </div>
          </div>
        </td>
        <td>${typeBadge}</td>
        <td style="font-family: monospace; font-size: 11px; color: var(--text-dim);">${escapeHtml(a.clientId || 'standalone')}</td>
        <td style="color: var(--text-muted);">${lastSeen}</td>
        <td>
          <span class="badge badge-online">Synced</span>
        </td>
        <td>${canAssignCosmetics ? `<button class="btn btn-secondary" type="button" data-assign-cosmetic-player="${escapeHtml(playerUuid)}">Assign</button>` : ''}</td>
      </tr>
    `;
  }).join('');
}

async function fetchClients() {
  try {
    const res = await fetch(`${API_BASE}/clients`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    const clients = json.data || [];
    renderClients(clients);
  } catch (err) {
    console.error('Failed to fetch clients:', err);
  }
}

function renderClients(clients) {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;

  if (clients.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-dim); padding: 30px;">
          No active client installations connected.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = clients.map((c) => {
    const statusBadge = c.isOnline
      ? `<span class="badge badge-online">● ONLINE</span>`
      : `<span class="badge badge-offline-status">○ OFFLINE</span>`;

    const lastSeen = c.lastSeenAt ? timeAgo(new Date(c.lastSeenAt)) : 'Never';

    return `
      <tr>
        <td style="font-family: monospace; font-weight: 600; color: var(--primary);">${escapeHtml(c.id)}</td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(c.os || 'Windows')} ${escapeHtml(c.osVersion || '')}</div>
          <div style="font-size: 11px; color: var(--text-dim);">${escapeHtml(c.architecture || 'x64')} · ${escapeHtml(c.hostname || 'PC')}</div>
        </td>
        <td><span class="badge badge-microsoft">${escapeHtml(c.clientVersion || 'Unknown version')}</span></td>
        <td>${statusBadge}</td>
        <td style="color: var(--text-muted);">${lastSeen}</td>
      </tr>
    `;
  }).join('');
}

async function fetchManifest() {
  try {
    const res = await fetch(`${API_BASE}/admin/manifest`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const payload = await res.json();
    if (!payload.ok || !payload.data) throw new Error(payload.error?.message || 'Could not load launcher content.');
    const data = payload.data;
    serversData = data.featuredServers || [];
    newsData = data.news || [];
    announcementsData = data.announcements || [];
    maintenanceData = data.maintenance || { enabled: false, mode: 'soft', title: '', message: '' };
    releaseData = data.client || null;
    renderServers(serversData);
    renderNews(newsData);
    renderAnnouncements(announcementsData);
    renderMaintenance(maintenanceData);
    renderRelease(releaseData);
  } catch (err) {
    console.error('Failed to fetch manifest:', err);
  }
}

function renderRelease(release) {
  const versionBadge = document.getElementById('release-current-version');
  const details = document.getElementById('release-current-details');
  if (!versionBadge || !details) return;

  const hasValidInstaller = typeof release?.updateUrl === 'string'
    && release.updateUrl.trim().length > 0
    && /^[a-f0-9]{64}$/i.test(String(release.sha256 || ''))
    && Number.isSafeInteger(Number(release.sizeBytes))
    && Number(release.sizeBytes) > 0;
  if (!release?.latestVersion || !hasValidInstaller) {
    versionBadge.textContent = 'Client build: 1.0.1';
    details.textContent = 'No verified installer has been published yet. The current DewClient build is 1.0.1.';
    const minimumInput = document.getElementById('release-minimum-version');
    const notesInput = document.getElementById('release-notes-url');
    if (minimumInput && !minimumInput.value) minimumInput.value = '1.0.0';
    if (notesInput && !notesInput.value) notesInput.value = 'https://dewclient.fun/#download';
    return;
  }

  const latestVersion = String(release.latestVersion).replace(/^v/, '');
  const minimumVersion = release.minimumVersion ? String(release.minimumVersion).replace(/^v/, '') : latestVersion;
  versionBadge.textContent = 'Client build: 1.0.1';
  details.textContent = `Published installer: ${latestVersion} · Minimum supported: ${minimumVersion} · ${release.sizeBytes ? `${(release.sizeBytes / 1024 / 1024).toFixed(1)} MiB` : 'Installer size unavailable'}`;

  const minimumInput = document.getElementById('release-minimum-version');
  const notesInput = document.getElementById('release-notes-url');
  if (minimumInput && !minimumInput.value) minimumInput.value = minimumVersion;
  if (notesInput && !notesInput.value) notesInput.value = release.notesUrl || '';
}

function renderServers(servers) {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;

  if (servers.length === 0) {
    grid.innerHTML = `<div style="color: var(--text-dim);">No featured servers added yet.</div>`;
    return;
  }

  grid.innerHTML = servers.map((s) => {
    const icon = safeImageUrl(s.iconUrl || `https://api.mcstatus.io/v2/icon/${encodeURIComponent(`${s.host}:${s.port || 25565}`)}`);
    const tags = Array.isArray(s.tags) ? s.tags.map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('') : '';

    return `
      <div class="server-card">
        <div class="server-card-top">
          <img class="server-icon" src="${escapeHtml(icon)}" alt="${escapeHtml(s.name)}" onerror="this.src='https://mc-heads.net/avatar/DewClient/64'">
          <div class="server-title">
            <h4>${escapeHtml(s.name)}</h4>
            <div class="server-host">${escapeHtml(s.host)}${s.port !== 25565 ? `:${s.port}` : ''}</div>
          </div>
          <div style="margin-left:auto;display:flex;gap:6px"><button class="btn btn-secondary" type="button" onclick="editServer('${escapeHtml(s.id)}')">Edit</button><button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;color:var(--danger)" type="button" onclick="deleteServer('${escapeHtml(s.id)}')" aria-label="Remove ${escapeHtml(s.name)}">✕</button></div>
        </div>
        <div class="server-tags">${tags}</div>
      </div>
    `;
  }).join('');
}

function renderNews(news) {
  const list = document.getElementById('news-list');
  if (!list) return;

  if (news.length === 0) {
    list.innerHTML = `<div style="color: var(--text-dim);">No news published yet.</div>`;
    return;
  }

  list.innerHTML = news.map((n) => {
    return `
      <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span class="badge badge-microsoft">${escapeHtml(n.tag || 'NEWS')}</span>
            <strong style="font-size: 15px;">${escapeHtml(n.title)}</strong>
          </div>
          <div style="font-size: 13px; color: var(--text-muted); max-width: 600px;">${escapeHtml(n.summary)}</div>
        </div>
        <div style="display:flex;gap:8px"><button class="btn btn-secondary" type="button" onclick="editNews('${escapeHtml(n.id)}')">Edit</button><button class="btn btn-secondary" style="padding:6px 12px;color:var(--danger);font-size:12px" type="button" onclick="deleteNews('${escapeHtml(n.id)}')">Delete</button></div>
      </div>
    `;
  }).join('');
}

function renderAnnouncements(announcements) {
  const list = document.getElementById('announcement-list');
  if (!list) return;

  if (announcements.length === 0) {
    list.textContent = 'No announcements published.';
    return;
  }

  list.innerHTML = announcements.map((announcement) => `
    <div style="border-top: 1px solid var(--border); padding: 14px 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
      <div>
        <div><span class="badge badge-microsoft">${escapeHtml(announcement.severity || 'info')}</span> <strong>${escapeHtml(announcement.title)}</strong></div>
        <div style="font-size: 13px; color: var(--text-muted); margin-top: 5px;">${escapeHtml(announcement.message)}</div>
      </div>
      <button class="btn btn-secondary" type="button" data-announcement-delete="${escapeHtml(announcement.id)}" style="color: var(--danger);">Delete</button>
    </div>`).join('');

  list.querySelectorAll('[data-announcement-delete]').forEach((button) => {
    button.addEventListener('click', () => window.deleteAnnouncement(button.dataset.announcementDelete));
  });
}

function renderMaintenance(maintenance) {
  const enabled = document.getElementById('maintenance-enabled');
  const mode = document.getElementById('maintenance-mode');
  const title = document.getElementById('maintenance-title');
  const message = document.getElementById('maintenance-message');
  const status = document.getElementById('maintenance-status');
  if (!enabled || !mode || !title || !message) return;

  enabled.checked = maintenance.enabled === true;
  mode.value = maintenance.mode === 'hard' ? 'hard' : 'soft';
  title.value = maintenance.title || '';
  message.value = maintenance.message || '';
  if (status) status.textContent = enabled.checked ? `Enabled (${mode.value})` : 'Disabled';
}

function initSearch() {
  const searchInput = document.getElementById('account-search');
  if (!searchInput) return;

  let debounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { accountPage = 1; fetchAccounts(); }, 300);
  });
}

function initModals() {
  const cosmeticsModal = document.getElementById('modal-cosmetics');
  const cosmeticsForm = document.getElementById('form-cosmetics');
  document.getElementById('btn-close-cosmetics')?.addEventListener('click', () => cosmeticsModal?.classList.remove('open'));
  for (const kind of ['skin', 'cape', 'elytra']) {
    document.getElementById(`admin-${kind}-picker`)?.addEventListener('change', () => {
      const form = document.getElementById('form-cosmetics');
      form.dataset[`dirty${kind[0].toUpperCase()}${kind.slice(1)}`] = 'true';
      updateCosmeticPickerCount(kind);
    });
    document.getElementById(`admin-${kind}-search`)?.addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll(`#admin-${kind}-picker .cosmetic-picker-item`).forEach((item) => {
        item.hidden = !item.dataset.search.includes(query);
      });
    });
    document.querySelector(`[data-clear-picker="${kind}"]`)?.addEventListener('click', () => {
      document.querySelectorAll(`#admin-${kind}-picker input[type="checkbox"]`).forEach((checkbox) => { checkbox.checked = false; });
      const form = document.getElementById('form-cosmetics');
      form.dataset[`dirty${kind[0].toUpperCase()}${kind.slice(1)}`] = 'true';
      updateCosmeticPickerCount(kind);
    });
  }
  cosmeticsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const playerUuid = cosmeticsForm.dataset.playerUuid;
    const status = document.getElementById('admin-cosmetic-status');
    const submitButton = document.getElementById('btn-save-cosmetics');
    const body = { expectedVersion: Number(cosmeticsForm.dataset.version || 0) };
    try {
      for (const kind of ['skin', 'cape', 'elytra']) {
        const collectionKey = `${kind === 'elytra' ? 'elytra' : kind}s`;
        const selections = getCosmeticPickerSelection(kind);
        const isDirty = cosmeticsForm.dataset[`dirty${kind[0].toUpperCase()}${kind.slice(1)}`] === 'true';
        if (isDirty) {
          body[collectionKey] = selections.map((assetId) => {
            const selected = cosmeticLibrary.find((item) => item.assetId === assetId && item.kind === kind);
            if (!selected) throw new Error(`Choose a valid uploaded ${kind} from the library.`);
            return { assetId: selected.assetId, sha256: selected.sha256 };
          });
        }
      }
      if (Object.keys(body).length === 1) throw new Error('Choose a texture or select a removal option.');

      submitButton.disabled = true;
      status.textContent = 'Saving player cosmetic assignments...';
      const response = await fetch(`${API_BASE}/admin/cosmetics/${encodeURIComponent(playerUuid)}`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not save assignments.');

      cosmeticsForm.dataset.version = String(result.data.version || 0);
      status.textContent = `Cosmetics saved for ${result.data.username}. They will sync when DewClient players next launch the game.`;
      for (const kind of ['skin', 'cape', 'elytra']) {
        const collectionKey = `${kind === 'elytra' ? 'elytra' : kind}s`;
        const assigned = Array.isArray(result.data.metadata?.[collectionKey])
          ? result.data.metadata[collectionKey]
          : result.data[kind]?.enabled ? [result.data[kind]] : [];
        const assetIds = assigned.map((item) => item.assetId).filter(Boolean);
        setCosmeticPickerSelection(kind, assetIds);
        cosmeticsForm.dataset[`initial${kind[0].toUpperCase()}${kind.slice(1)}`] = JSON.stringify(assetIds);
        cosmeticsForm.dataset[`dirty${kind[0].toUpperCase()}${kind.slice(1)}`] = 'false';
        document.getElementById(`admin-${kind}-state`).textContent = assetIds.length
          ? `${assetIds.length} assigned${assetIds.length <= 3 ? ` · ${assetIds.map((id) => cosmeticLibrary.find((item) => item.assetId === id)?.name || 'Texture').join(', ')}` : ''}`
          : 'No texture assigned';
      }
    } catch (error) {
      status.textContent = error.message || 'Could not save assignments.';
    } finally {
      submitButton.disabled = false;
    }
  });

  const libraryForm = document.getElementById('form-cosmetic-library');
  libraryForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = document.getElementById('library-cosmetic-file').files?.[0];
    const status = document.getElementById('cosmetic-library-status');
    const button = document.getElementById('btn-upload-library-cosmetic');
    if (!file || !file.name.toLowerCase().endsWith('.png') || file.type !== 'image/png') {
      status.textContent = 'Choose a PNG texture.';
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      status.textContent = 'Texture exceeds the 50 MiB limit.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Uploading private cosmetic...';
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response = await fetch(`${API_BASE}/admin/cosmetics/library`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('library-cosmetic-name').value.trim(),
          kind: document.getElementById('library-cosmetic-kind').value,
          contentType: 'image/png',
          data: dataUrl.split(',')[1]
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Cosmetic upload failed.');
      libraryForm.reset();
      status.textContent = `${result.data.name} uploaded. It is private until assigned.`;
      await fetchCosmeticLibrary();
    } catch (error) {
      status.textContent = error.message || 'Cosmetic upload failed.';
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('btn-open-cosmetic-target')?.addEventListener('click', () => {
    const identifier = document.getElementById('cosmetic-target-identifier').value.trim();
    if (!identifier) {
      document.getElementById('cosmetic-library-status').textContent = 'Enter a player username or UUID.';
      return;
    }
    window.openCosmeticAssignment(identifier);
  });

  const releaseForm = document.getElementById('form-release');
  releaseForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = document.getElementById('release-version').value.trim();
    const installer = document.getElementById('release-installer').files?.[0];
    const status = document.getElementById('release-upload-status');
    const submitButton = document.getElementById('btn-publish-release');
    if (!installer || !installer.name.toLowerCase().endsWith('.exe')) {
      status.textContent = 'Choose a Windows .exe installer.';
      return;
    }
    if (installer.size > 2 * 1024 * 1024 * 1024) {
      status.textContent = 'Installer exceeds the 2 GiB upload limit.';
      return;
    }

    submitButton.disabled = true;
    status.textContent = 'Uploading installer...';
    try {
      const uploadResponse = await fetch(`${API_BASE}/admin/release/upload?version=${encodeURIComponent(version)}`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/octet-stream' },
        body: installer
      });
      const uploadJson = await uploadResponse.json();
      if (!uploadResponse.ok || !uploadJson.ok) {
        throw new Error(uploadJson.error?.message || 'Installer upload failed.');
      }

      status.textContent = 'Installer uploaded. Publishing release metadata...';
      const releaseResponse = await fetch(`${API_BASE}/admin/release`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latestVersion: version,
          minimumVersion: document.getElementById('release-minimum-version').value.trim(),
          notesUrl: document.getElementById('release-notes-url').value.trim(),
          updateUrl: uploadJson.data.updateUrl,
          sha256: uploadJson.data.sha256,
          sizeBytes: uploadJson.data.sizeBytes
        })
      });
      const releaseJson = await releaseResponse.json();
      if (!releaseResponse.ok || !releaseJson.ok) {
        throw new Error(releaseJson.error?.message || 'Release metadata could not be published.');
      }

      releaseData = releaseJson.data;
      renderRelease(releaseData);
      document.getElementById('release-version').value = '';
      document.getElementById('release-installer').value = '';
      status.textContent = `Version ${version} published. Launchers will download it during their next background update check.`;
    } catch (error) {
      status.textContent = error.message || 'Release upload failed.';
    } finally {
      submitButton.disabled = false;
    }
  });

  // Add Server Modal
  const btnAddServer = document.getElementById('btn-add-server');
  const modalServer = document.getElementById('modal-server');
  const btnCloseServer = document.getElementById('btn-close-server');
  const formServer = document.getElementById('form-server');

  if (btnAddServer && modalServer) {
    btnAddServer.addEventListener('click', () => window.editServer(null));
    btnCloseServer?.addEventListener('click', () => modalServer.classList.remove('open'));

    formServer?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        ...(formServer.dataset.editId ? { id: formServer.dataset.editId } : {}),
        name: document.getElementById('srv-name').value,
        host: document.getElementById('srv-host').value,
        port: document.getElementById('srv-port').value || 25565,
        tags: document.getElementById('srv-tags').value
      };

      const button = document.getElementById('btn-save-server');
      const status = document.getElementById('server-status');
      button.disabled = true;
      status.textContent = formServer.dataset.editId ? 'Saving server changes…' : 'Adding server…';
      try {
        const response = await fetch(`${API_BASE}/admin/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(body)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Server could not be saved.');
        modalServer.classList.remove('open');
        formServer.reset();
        delete formServer.dataset.editId;
        document.getElementById('server-modal-title').textContent = 'Add Featured Server';
        button.textContent = 'Save Server';
        await fetchManifest();
      } catch (error) {
        status.textContent = error.message || 'Server could not be saved.';
      } finally {
        button.disabled = false;
      }
    });
  }

  // Add News Modal
  const btnAddNews = document.getElementById('btn-add-news');
  const modalNews = document.getElementById('modal-news');
  const btnCloseNews = document.getElementById('btn-close-news');
  const formNews = document.getElementById('form-news');

  if (btnAddNews && modalNews) {
    btnAddNews.addEventListener('click', () => window.editNews(null));
    btnCloseNews?.addEventListener('click', () => modalNews.classList.remove('open'));

    formNews?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        ...(formNews.dataset.editId ? { id: formNews.dataset.editId } : {}),
        title: document.getElementById('news-title').value,
        tag: document.getElementById('news-tag').value,
        summary: document.getElementById('news-summary').value,
        url: document.getElementById('news-url').value
      };

      const button = document.getElementById('btn-save-news');
      const status = document.getElementById('news-status');
      button.disabled = true;
      status.textContent = formNews.dataset.editId ? 'Saving news changes…' : 'Publishing news…';
      try {
        const response = await fetch(`${API_BASE}/admin/news`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(body)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error?.message || 'News item could not be saved.');
        modalNews.classList.remove('open');
        formNews.reset();
        delete formNews.dataset.editId;
        document.getElementById('news-modal-title').textContent = 'Publish Launcher News';
        button.textContent = 'Publish News';
        await fetchManifest();
      } catch (error) {
        status.textContent = error.message || 'News item could not be saved.';
      } finally {
        button.disabled = false;
      }
    });
  }

  const announcementForm = document.getElementById('form-announcement');
  announcementForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('announcement-status');
    const button = document.getElementById('btn-publish-announcement');
    button.disabled = true;
    status.textContent = 'Publishing announcement...';
    try {
      const response = await fetch(`${API_BASE}/admin/announcements`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('announcement-title').value.trim(),
          message: document.getElementById('announcement-message').value.trim(),
          severity: document.getElementById('announcement-severity').value,
          priority: Number(document.getElementById('announcement-priority').value || 10),
          url: document.getElementById('announcement-url').value.trim()
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Announcement could not be published.');
      announcementForm.reset();
      document.getElementById('announcement-priority').value = '10';
      await fetchManifest();
      status.textContent = 'Announcement published.';
    } catch (error) {
      status.textContent = error.message || 'Announcement could not be published.';
    } finally {
      button.disabled = false;
    }
  });

  const maintenanceForm = document.getElementById('form-maintenance');
  maintenanceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('maintenance-form-status');
    const button = document.getElementById('btn-save-maintenance');
    button.disabled = true;
    status.textContent = 'Saving maintenance settings...';
    try {
      const response = await fetch(`${API_BASE}/admin/maintenance`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: document.getElementById('maintenance-enabled').checked,
          mode: document.getElementById('maintenance-mode').value,
          title: document.getElementById('maintenance-title').value.trim(),
          message: document.getElementById('maintenance-message').value.trim()
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Maintenance settings could not be saved.');
      maintenanceData = result.data;
      renderMaintenance(maintenanceData);
      status.textContent = 'Maintenance settings saved.';
    } catch (error) {
      status.textContent = error.message || 'Maintenance settings could not be saved.';
    } finally {
      button.disabled = false;
    }
  });

  const staffForm = document.getElementById('form-staff');
  staffForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('staff-status');
    const button = document.getElementById('btn-create-staff');
    button.disabled = true;
    status.textContent = 'Creating staff account...';
    try {
      const response = await fetch(`${API_BASE}/admin/staff`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('staff-email').value.trim(),
          displayName: document.getElementById('staff-display-name').value.trim(),
          password: document.getElementById('staff-password').value,
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not create staff account.');
      staffForm.reset();
      status.textContent = `Administrator account created for ${result.data.email}.`;
      await fetchStaff();
    } catch (error) {
      status.textContent = error.message || 'Could not create staff account.';
    } finally {
      button.disabled = false;
    }
  });
}

window.openCosmeticAssignment = async function(playerIdentifier) {
  const form = document.getElementById('form-cosmetics');
  const modal = document.getElementById('modal-cosmetics');
  const status = document.getElementById('admin-cosmetic-status');
  const account = accountsData.find((entry) => entry.uuid?.toLowerCase() === playerIdentifier.toLowerCase()
    || entry.username?.toLowerCase() === playerIdentifier.toLowerCase());
  form.dataset.playerUuid = playerIdentifier;
  form.dataset.version = '0';
  form.reset();
  document.getElementById('cosmetic-player-label').textContent = account
    ? `${account.username} · ${account.uuid}`
    : playerIdentifier;
  for (const kind of ['skin', 'cape', 'elytra']) {
    form.dataset[`initial${kind[0].toUpperCase()}${kind.slice(1)}`] = '[]';
    form.dataset[`dirty${kind[0].toUpperCase()}${kind.slice(1)}`] = 'false';
    setCosmeticPickerSelection(kind, []);
    const search = document.getElementById(`admin-${kind}-search`);
    if (search) search.value = '';
    document.getElementById(`admin-${kind}-state`).textContent = 'Loading...';
  }
  status.textContent = '';
  modal.classList.add('open');

  try {
    const response = await fetch(`${API_BASE}/admin/cosmetics/${encodeURIComponent(playerIdentifier)}`, { headers: getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not load current assignments.');
    const cosmetics = result.data.cosmetics;
    form.dataset.version = String(cosmetics?.version || 0);
    for (const kind of ['skin', 'cape', 'elytra']) {
      const assigned = cosmetics?.[kind];
      const collectionKey = `${kind === 'elytra' ? 'elytra' : kind}s`;
      const assignedItems = Array.isArray(cosmetics?.metadata?.[collectionKey])
        ? cosmetics.metadata[collectionKey]
        : (assigned?.enabled ? [assigned] : []);
      const assignedIds = assignedItems.map((item) => item.assetId).filter(Boolean);
      form.dataset[`initial${kind[0].toUpperCase()}${kind.slice(1)}`] = JSON.stringify(assignedIds);
      form.dataset[`dirty${kind[0].toUpperCase()}${kind.slice(1)}`] = 'false';
      setCosmeticPickerSelection(kind, assignedIds);
      const adminOwned = cosmetics?.metadata?.adminAssignedKinds?.includes(kind);
      const stateItems = assignedItems.map((item) => cosmeticLibrary.find((entry) => entry.assetId === item.assetId && entry.kind === kind)?.name).filter(Boolean);
      document.getElementById(`admin-${kind}-state`).textContent = stateItems.length
        ? `${adminOwned ? 'Admin assigned' : 'Player uploaded'} · ${stateItems.length}: ${stateItems.slice(0, 3).join(', ')}${stateItems.length > 3 ? ` +${stateItems.length - 3} more` : ''}`
        : 'No texture assigned';
    }
  } catch (error) {
    status.textContent = error.message || 'Could not load current assignments.';
  }
};

async function fetchCosmeticLibrary() {
  try {
    const response = await fetch(`${API_BASE}/admin/cosmetics/library`, { headers: getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || !result.ok || !Array.isArray(result.data)) {
      throw new Error(result.error?.message || 'Could not load the admin cosmetic library.');
    }
    cosmeticLibrary = result.data;
    renderCosmeticLibrary();
  } catch (error) {
    const list = document.getElementById('cosmetic-library-list');
    if (list) list.textContent = error.message || 'Could not load the private cosmetic library.';
  }
}

function renderCosmeticLibrary() {
  const list = document.getElementById('cosmetic-library-list');
  if (!list) return;
  if (cosmeticLibrary.length === 0) {
    list.textContent = 'No cosmetics uploaded yet.';
  } else {
    list.innerHTML = cosmeticLibrary.map((item) => `
      <div class="server-card" style="margin-bottom: 8px;">
        <div class="server-card-top">
          <img class="cosmetic-preview-thumb" data-cosmetic-preview="${escapeHtml(item.assetId)}" alt="" loading="lazy">
          <div class="server-title">
            <h4>${escapeHtml(item.name)}</h4>
            <div class="server-host">${escapeHtml(item.kind)} · ${escapeHtml(item.sha256.slice(0, 12))} · ${(item.byteSize / 1024).toFixed(1)} KiB</div>
            ${item.kind === 'cape' ? `<span class="cosmetic-free-badge ${item.isFree ? 'is-free' : ''}">${item.isFree ? 'Free claim enabled' : 'Private'}</span>` : ''}
          </div>
          ${item.kind === 'cape' ? `<button class="btn btn-secondary" type="button" data-toggle-free-cosmetic="${escapeHtml(item.assetId)}" data-is-free="${item.isFree === true}">${item.isFree ? 'Unlist' : 'List free'}</button>` : ''}
          <button class="btn btn-secondary" type="button" data-delete-cosmetic-asset="${escapeHtml(item.assetId)}">Delete</button>
        </div>
      </div>
    `).join('');
  }
  for (const kind of ['skin', 'cape', 'elytra']) {
    renderCosmeticPicker(kind, getCosmeticPickerSelection(kind));
  }
  observeCosmeticPreviews();
}

function observeCosmeticPreviews() {
  cosmeticPreviewObserver?.disconnect();
  const images = [...document.querySelectorAll('img[data-cosmetic-preview]')];
  for (const image of images) {
    const assetId = image.dataset.cosmeticPreview;
    if (cosmeticPreviewCache.has(assetId)) image.src = cosmeticPreviewCache.get(assetId);
  }
  const pendingImages = images.filter((image) => !image.getAttribute('src') && image.dataset.cosmeticPreview);
  if (typeof IntersectionObserver === 'undefined') {
    for (const image of pendingImages) queueCosmeticPreview(image.dataset.cosmeticPreview);
    return;
  }
  cosmeticPreviewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      cosmeticPreviewObserver.unobserve(entry.target);
      queueCosmeticPreview(entry.target.dataset.cosmeticPreview);
    }
  }, { rootMargin: '100px' });
  for (const image of pendingImages) cosmeticPreviewObserver.observe(image);
}

function queueCosmeticPreview(assetId) {
  if (!/^[a-f0-9]{64}$/i.test(assetId || '') || cosmeticPreviewCache.has(assetId) || cosmeticPreviewQueued.has(assetId)) return;
  cosmeticPreviewQueued.add(assetId);
  cosmeticPreviewQueue.push(assetId);
  drainCosmeticPreviewQueue();
}

function drainCosmeticPreviewQueue() {
  while (cosmeticPreviewActive < 2 && cosmeticPreviewQueue.length) {
    const assetId = cosmeticPreviewQueue.shift();
    cosmeticPreviewActive += 1;
    void loadCosmeticPreview(assetId).finally(() => {
      cosmeticPreviewQueued.delete(assetId);
      cosmeticPreviewActive -= 1;
      drainCosmeticPreviewQueue();
    });
  }
}

async function loadCosmeticPreview(assetId) {
  try {
    const response = await fetch(`${API_BASE}/admin/cosmetics/library/${encodeURIComponent(assetId)}/preview`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) return;
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(160 / bitmap.width, 80 / bitmap.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return bitmap.close();
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const thumbnail = canvas.toDataURL('image/png');
    cosmeticPreviewCache.set(assetId, thumbnail);
    if (cosmeticPreviewCache.size > 96) cosmeticPreviewCache.delete(cosmeticPreviewCache.keys().next().value);
    for (const image of document.querySelectorAll(`img[data-cosmetic-preview="${CSS.escape(assetId)}"]`)) image.src = thumbnail;
  } catch {
    // Keep the preview placeholder if a private asset cannot be decoded.
  }
}

async function fetchBugReports() {
  const list = document.getElementById('bug-report-list');
  const status = document.getElementById('bug-report-status');
  if (!list) return;
  const filter = document.getElementById('bug-report-filter')?.value || 'all';
  list.setAttribute('aria-busy', 'true');
  if (status) status.textContent = 'Loading reports…';
  try {
    const response = await fetch(`${API_BASE}/admin/bug-reports?status=${encodeURIComponent(filter)}`, {
      headers: getAuthHeaders()
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !Array.isArray(result.data?.reports)) {
      throw new Error(result.error?.message || 'Bug reports could not be loaded.');
    }
    bugReportsData = result.data.reports;
    renderBugReports();
    if (status) status.textContent = `${result.data.total ?? bugReportsData.length} report${(result.data.total ?? bugReportsData.length) === 1 ? '' : 's'}`;
  } catch (error) {
    list.textContent = error.message || 'Bug reports could not be loaded.';
    if (status) status.textContent = 'Could not refresh reports';
  } finally {
    list.removeAttribute('aria-busy');
  }
}

function renderBugReports() {
  const list = document.getElementById('bug-report-list');
  if (!list) return;
  if (bugReportsData.length === 0) {
    list.innerHTML = '<div class="bug-report-empty"><strong>No reports here</strong><span>New player reports will appear in this queue.</span></div>';
    return;
  }
  list.innerHTML = bugReportsData.map((report) => {
    const id = escapeHtml(report.id);
    const created = Number.isFinite(Date.parse(report.createdAt))
      ? new Date(report.createdAt).toLocaleString()
      : 'Date unavailable';
    const selectedStatus = ['pending', 'reviewing', 'resolved'].includes(report.status) ? report.status : 'pending';
    const note = report.resolutionNote || '';
    return `<article class="bug-report-card" data-report-id="${id}">
      <div class="bug-report-card-heading">
        <div class="bug-report-title-group"><span class="bug-report-category">${escapeHtml(report.category)}</span><h3>${escapeHtml(report.title)}</h3></div>
        <time datetime="${escapeHtml(report.createdAt || '')}">${escapeHtml(created)}</time>
      </div>
      <div class="bug-report-version">DewClient ${escapeHtml(report.clientVersion || 'unknown')} · Minecraft ${escapeHtml(report.minecraftVersion || 'not provided')}</div>
      <p class="bug-report-description">${escapeHtml(report.description)}</p>
      <div class="bug-report-resolution">${report.resolvedBy ? `Resolved by ${escapeHtml(report.resolvedBy)}` : 'No administrator assigned'}</div>
      <div class="bug-report-actions">
        <label>Status<select class="form-input" data-report-status>
          <option value="pending"${selectedStatus === 'pending' ? ' selected' : ''}>Pending</option>
          <option value="reviewing"${selectedStatus === 'reviewing' ? ' selected' : ''}>Under review</option>
          <option value="resolved"${selectedStatus === 'resolved' ? ' selected' : ''}>Resolved</option>
        </select></label>
        <label class="bug-report-note-label">Resolution note<textarea class="form-input" data-report-note maxlength="1000" rows="2" placeholder="Optional note for the admin team">${escapeHtml(note)}</textarea></label>
        <button class="btn btn-primary" type="button" data-update-bug-report="${id}">Save status</button>
      </div>
    </article>`;
  }).join('');
}

async function updateBugReportStatus(reportId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId || '')) return;
  const card = document.querySelector(`.bug-report-card[data-report-id="${CSS.escape(reportId)}"]`);
  const button = card?.querySelector('[data-update-bug-report]');
  const status = document.getElementById('bug-report-status');
  if (!card || !button) return;
  button.disabled = true;
  const oldLabel = button.textContent;
  button.textContent = 'Saving…';
  try {
    const response = await fetch(`${API_BASE}/admin/bug-reports/${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: card.querySelector('[data-report-status]')?.value,
        resolutionNote: card.querySelector('[data-report-note]')?.value || ''
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || 'The report could not be updated.');
    if (status) status.textContent = 'Report updated';
    await fetchBugReports();
  } catch (error) {
    if (status) status.textContent = error.message || 'The report could not be updated.';
    button.textContent = oldLabel;
    button.disabled = false;
  }
}

function getCosmeticPickerSelection(kind) {
  return [...document.querySelectorAll(`#admin-${kind}-picker input[type="checkbox"]:checked`)]
    .map((checkbox) => checkbox.value);
}

function setCosmeticPickerSelection(kind, assetIds) {
  renderCosmeticPicker(kind, assetIds);
  updateCosmeticPickerCount(kind);
}

function renderCosmeticPicker(kind, selectedIds = []) {
  const picker = document.getElementById(`admin-${kind}-picker`);
  if (!picker) return;
  const selected = new Set(selectedIds);
  const items = cosmeticLibrary.filter((item) => item.kind === kind);
  if (!items.length) {
    picker.innerHTML = '<div class="cosmetic-picker-empty">No textures in this category yet. Upload one to the private library first.</div>';
    updateCosmeticPickerCount(kind);
    return;
  }
  picker.innerHTML = items.map((item) => {
    const dimensions = Number(item.width) && Number(item.height) ? `${item.width} × ${item.height}` : 'PNG texture';
    const size = Number(item.byteSize) ? ` · ${(item.byteSize / 1024).toFixed(1)} KiB` : '';
    return `<label class="cosmetic-picker-item" data-search="${escapeHtml(`${item.name} ${kind}`.toLowerCase())}">
      <input type="checkbox" name="assetId" value="${escapeHtml(item.assetId)}"${selected.has(item.assetId) ? ' checked' : ''}>
      <img class="cosmetic-preview-thumb" data-cosmetic-preview="${escapeHtml(item.assetId)}" alt="" loading="lazy">
      <span class="cosmetic-picker-item-copy"><span class="cosmetic-picker-item-name">${escapeHtml(item.name)}</span><span class="cosmetic-picker-item-meta">${dimensions}${size}</span></span>
    </label>`;
  }).join('');
  const query = document.getElementById(`admin-${kind}-search`)?.value.trim().toLowerCase() || '';
  picker.querySelectorAll('.cosmetic-picker-item').forEach((item) => { item.hidden = !item.dataset.search.includes(query); });
  observeCosmeticPreviews();
  updateCosmeticPickerCount(kind);
}

function updateCosmeticPickerCount(kind) {
  const count = document.getElementById(`admin-${kind}-count`);
  if (count) {
    const selected = getCosmeticPickerSelection(kind).length;
    count.textContent = `${selected} selected`;
  }
}

window.deleteLibraryCosmetic = async function(assetId) {
  if (!confirm('Delete this private cosmetic from the library?')) return;
  const response = await fetch(`${API_BASE}/admin/cosmetics/library/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    document.getElementById('cosmetic-library-status').textContent = result.error?.message || 'Could not delete cosmetic.';
    return;
  }
  await fetchCosmeticLibrary();
};

window.toggleLibraryCosmeticFree = async function(assetId, isFree) {
  const status = document.getElementById('cosmetic-library-status');
  try {
    const response = await fetch(`${API_BASE}/admin/cosmetics/library/${encodeURIComponent(assetId)}/free`, {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFree })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not update cape availability.');
    if (status) status.textContent = isFree ? `${result.data.name} is now listed in the free cape catalog.` : `${result.data.name} is no longer available to new claimants.`;
    await fetchCosmeticLibrary();
  } catch (error) {
    if (status) status.textContent = error.message || 'Could not update cape availability.';
  }
};

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read selected texture file.'));
    reader.readAsDataURL(file);
  });
}

async function fetchStaff() {
  const list = document.getElementById('staff-list');
  if (!list) return;
  try {
    const response = await fetch(`${API_BASE}/admin/staff`, { headers: getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not load staff accounts.');
    renderStaff(result.data || []);
  } catch (error) {
    list.textContent = error.message || 'Could not load staff accounts.';
  }
}

function renderStaff(staff) {
  const list = document.getElementById('staff-list');
  if (!list) return;
  if (staff.length === 0) {
    list.textContent = 'No administrator accounts found.';
    return;
  }
  list.innerHTML = staff.map((entry) => {
    const isSelf = entry.id === currentUser?.id;
    return `<div class="staff-row">
      <div class="staff-identity"><strong>${escapeHtml(entry.displayName || entry.email)}</strong><span>${escapeHtml(entry.email)}</span></div>
      <span class="badge badge-emerald">Administrator</span>
      <label class="staff-active"><input type="checkbox" data-staff-active="${escapeHtml(entry.id)}" ${entry.isActive ? 'checked' : ''} ${isSelf ? 'disabled' : ''}> Active</label>
      <button class="btn btn-secondary" type="button" onclick="saveStaff('${escapeHtml(entry.id)}')" ${isSelf ? 'disabled' : ''}>Save</button>
    </div>`;
  }).join('');
}

window.saveStaff = async function(staffId) {
  const status = document.getElementById('staff-status');
  const active = document.querySelector(`[data-staff-active="${CSS.escape(staffId)}"]`);
  try {
    const response = await fetch(`${API_BASE}/admin/staff/${encodeURIComponent(staffId)}`, {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: active.checked })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || 'Could not update staff account.');
    status.textContent = `Updated ${result.data.email}.`;
    await fetchStaff();
  } catch (error) {
    status.textContent = error.message || 'Could not update staff account.';
  }
};

window.editServer = function (id) {
  const form = document.getElementById('form-server');
  const modal = document.getElementById('modal-server');
  if (!form || !modal) return;
  form.reset();
  delete form.dataset.editId;
  document.getElementById('server-status').textContent = '';
  const server = id ? serversData.find((entry) => entry.id === id) : null;
  if (server) {
    form.dataset.editId = server.id;
    document.getElementById('srv-name').value = server.name || '';
    document.getElementById('srv-host').value = server.host || '';
    document.getElementById('srv-port').value = String(server.port || 25565);
    document.getElementById('srv-tags').value = Array.isArray(server.tags) ? server.tags.join(', ') : '';
    document.getElementById('server-modal-title').textContent = 'Edit Featured Server';
    document.getElementById('btn-save-server').textContent = 'Save Changes';
  } else {
    document.getElementById('server-modal-title').textContent = 'Add Featured Server';
    document.getElementById('btn-save-server').textContent = 'Save Server';
  }
  modal.classList.add('open');
};

window.editNews = function (id) {
  const form = document.getElementById('form-news');
  const modal = document.getElementById('modal-news');
  if (!form || !modal) return;
  form.reset();
  delete form.dataset.editId;
  document.getElementById('news-status').textContent = '';
  const news = id ? newsData.find((entry) => entry.id === id) : null;
  if (news) {
    form.dataset.editId = news.id;
    document.getElementById('news-title').value = news.title || '';
    document.getElementById('news-tag').value = news.tag || 'UPDATE';
    document.getElementById('news-summary').value = news.summary || '';
    document.getElementById('news-url').value = news.url || '';
    document.getElementById('news-modal-title').textContent = 'Edit Launcher News';
    document.getElementById('btn-save-news').textContent = 'Save Changes';
  } else {
    document.getElementById('news-tag').value = 'UPDATE';
    document.getElementById('news-modal-title').textContent = 'Publish Launcher News';
    document.getElementById('btn-save-news').textContent = 'Publish News';
  }
  modal.classList.add('open');
};

window.deleteServer = async function (id) {
  if (!confirm('Remove this featured server?')) return;
  await fetch(`${API_BASE}/admin/servers/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  fetchManifest();
};

window.deleteNews = async function (id) {
  if (!confirm('Delete this news item?')) return;
  await fetch(`${API_BASE}/admin/news/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  fetchManifest();
};

window.deleteAnnouncement = async function (id) {
  if (!confirm('Delete this announcement?')) return;
  const response = await fetch(`${API_BASE}/admin/announcements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error?.message || 'Announcement could not be deleted.');
  }
  await fetchManifest();
};

function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 15) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
