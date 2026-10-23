/**
 * AppMap: UI Controller
 * Manages search, scope filtering, category filtering, theme switching,
 * view modes, toasts, and stats counters.
 */

class UIController {
  constructor() {
    this.searchInput = document.getElementById('searchInput');
    this.clearSearchBtn = document.getElementById('clearSearchBtn');
    this.categoryTabs = document.getElementById('categoryTabs');
    this.viewSwitcher = document.getElementById('viewSwitcher');
    this.toastContainer = document.getElementById('toastContainer');

    this.currentView = 'radar';
    this.currentScope = 'apps'; // 'apps' (default: real dev apps) or 'all' (technical open ports)
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.currentTheme = localStorage.getItem('appmap_theme') || 'dark';

    this.init();
  }

  init() {
    // 1. Theme Management (Light / Dark)
    this.applyTheme(this.currentTheme);
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(this.currentTheme);
        this.showToast(`Switched to ${this.currentTheme === 'light' ? 'Light' : 'Dark'} mode`, 'info');
      });
    }

    // 2. Scope Filter (Dev Apps Focus vs Technical All Ports)
    const scopeToggle = document.getElementById('scopeToggle');
    if (scopeToggle) {
      scopeToggle.querySelectorAll('.scope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          scopeToggle.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentScope = btn.getAttribute('data-scope');
          window.appState.applyFiltersAndRender();
        });
      });
    }

    // 3. Search Bar Interactions
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.clearSearchBtn?.classList.toggle('hidden', !this.searchQuery);
        window.appState.applyFiltersAndRender();
      });

      this.clearSearchBtn?.addEventListener('click', () => {
        this.searchInput.value = '';
        this.searchQuery = '';
        this.clearSearchBtn?.classList.add('hidden');
        this.searchInput.focus();
        window.appState.applyFiltersAndRender();
      });

      // Global keyboard shortcut '/' to focus search
      window.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== this.searchInput && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          e.preventDefault();
          this.searchInput.focus();
          this.searchInput.select();
        }
      });
    }

    // 4. Category Filter Tabs
    if (this.categoryTabs) {
      this.categoryTabs.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.categoryTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentCategory = btn.getAttribute('data-category');
          window.appState.applyFiltersAndRender();
        });
      });
    }

    // 5. View Switcher (Radar, Grid, Table)
    if (this.viewSwitcher) {
      this.viewSwitcher.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.switchView(btn.getAttribute('data-view'));
        });
      });
    }

    // 6. Force Rescan Button
    const scanBtn = document.getElementById('btnScanNow');
    const spinIcon = document.getElementById('scanSpinIcon');
    if (scanBtn) {
      scanBtn.addEventListener('click', async () => {
        spinIcon?.classList.add('spinning');
        document.getElementById('scanBtnText').textContent = 'Scanning...';
        await window.appState.triggerRescan();
        spinIcon?.classList.remove('spinning');
        document.getElementById('scanBtnText').textContent = 'Rescan';
        this.showToast('Port scan refreshed', 'success');
      });
    }

    // 7. Reset Filter Button in Empty State
    document.getElementById('emptyResetFilterBtn')?.addEventListener('click', () => {
      this.currentScope = 'apps';
      this.currentCategory = 'all';
      this.searchQuery = '';
      if (this.searchInput) this.searchInput.value = '';
      
      const scopeToggle = document.getElementById('scopeToggle');
      scopeToggle?.querySelectorAll('.scope-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-scope') === 'apps');
      });

      this.categoryTabs?.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-category') === 'all');
      });
      window.appState.applyFiltersAndRender();
    });

    // 8. Refresh Interval Selector
    const intervalSelect = document.getElementById('refreshIntervalSelect');
    if (intervalSelect) {
      intervalSelect.addEventListener('change', (e) => {
        const ms = parseInt(e.target.value, 10);
        window.appState.setAutoRefreshInterval(ms);
        this.showToast(ms > 0 ? `Auto-refresh set to ${ms / 1000}s` : 'Auto-refresh paused', 'info');
      });
    }
  }

  applyTheme(theme) {
    localStorage.setItem('appmap_theme', theme);
    document.body.classList.toggle('light-theme', theme === 'light');
    document.body.classList.toggle('dark-theme', theme === 'dark');

    const icon = document.getElementById('themeToggleIcon');
    const label = document.getElementById('themeToggleLabel');
    if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
    if (label) label.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';

    // Refresh canvas colors
    if (window.radar) {
      window.radar.resize();
    }
  }

  switchView(viewName) {
    this.currentView = viewName;

    // Update switcher buttons
    this.viewSwitcher.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-view') === viewName);
    });

    // Update view panels
    document.getElementById('radarView')?.classList.toggle('active', viewName === 'radar');
    document.getElementById('gridView')?.classList.toggle('active', viewName === 'grid');
    document.getElementById('tableView')?.classList.toggle('active', viewName === 'table');

    // If switched to radar, trigger canvas resize and unpin
    if (viewName === 'radar' && window.radar) {
      window.radar.unpin();
      window.radar.resize();
    }
  }

  updateMetrics(stats) {
    document.getElementById('valTotalPorts').textContent = stats.devAppsCount || stats.total || 0;
    document.getElementById('valWebApps').textContent = stats.web || 0;
    document.getElementById('valApis').textContent = stats.api || 0;
    document.getElementById('valAi').textContent = stats.ai || 0;

    // Update scope counts
    const scopeApps = document.getElementById('scopeAppsCount');
    const scopeAll = document.getElementById('scopeAllCount');
    if (scopeApps) scopeApps.textContent = stats.devAppsCount || 0;
    if (scopeAll) scopeAll.textContent = stats.total || 0;

    // Update tab count chips
    document.getElementById('countAll').textContent = (this.currentScope === 'apps' ? stats.devAppsCount : stats.total) || 0;
    document.getElementById('countWeb').textContent = stats.web || 0;
    document.getElementById('countApi').textContent = stats.api || 0;
    document.getElementById('countAi').textContent = stats.ai || 0;
    document.getElementById('countFav').textContent = stats.fav || 0;
  }

  updateLastScannedTime(isoString) {
    const el = document.getElementById('lastScannedText');
    if (el && isoString) {
      const date = new Date(isoString);
      el.textContent = `Last scanned: ${date.toLocaleTimeString()}`;
    }
  }

  showToast(message, type = 'info', duration = 3000) {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'danger') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${this.escapeHtml(message)}</span>`;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px) scale(0.95)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
}

window.UIController = UIController;
