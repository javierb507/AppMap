/**
 * AppMap: Main Application State Orchestrator
 * Connects SSE stream, coordinates data fetching, filtering, and view renders.
 */

class AppState {
  constructor() {
    this.apps = [];
    this.filteredApps = [];
    this.pollTimer = null;
    this.pollIntervalMs = 5000;
    this.eventSource = null;
    this.knownPorts = new Set();

    this.init();
  }

  async init() {
    // Instantiate UI and View renderers
    window.ui = new UIController();
    window.modal = new ModalManager();
    window.radar = new RadarGalaxy('radarCanvas', 'radarTooltip');
    window.cards = new CardsRenderer('appsCardsContainer');
    window.table = new TableRenderer('matrixTableBody');

    // Host platform info (Finder / Explorer / File Manager labels)
    try {
      const health = await fetch('/api/health').then(r => r.json());
      window.appPlatform = { platform: health.platform, fileManager: health.fileManager };
      const tip = document.querySelector('.tip-text');
      if (tip && health.fileManager) {
        tip.textContent = `💡 Tip: Click any port badge to copy URL • Click folder to open in ${health.fileManager}`;
      }
    } catch (_) {
      window.appPlatform = { platform: 'unknown', fileManager: 'file manager' };
    }

    // Initial Fetch
    await this.fetchApps();

    // Connect SSE for Real-Time Live Updates
    this.connectSse();

    // Start fallback poll loop
    this.startPolling();
  }

  async fetchApps() {
    try {
      const res = await fetch('/api/apps');
      const data = await res.json();
      if (data.success && data.apps) {
        this.setApps(data.apps, data.timestamp);
      }
    } catch (err) {
      console.error('[AppState] Error fetching apps:', err);
    }
  }

  async triggerRescan() {
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.apps) {
        this.setApps(data.apps, data.timestamp);
      }
    } catch (err) {
      console.error('[AppState] Rescan error:', err);
    }
  }

  setApps(apps, timestamp) {
    if (!this.notifiedPortChanges) this.notifiedPortChanges = new Set();

    // Check for newly started servers and port shifts for notifications
    const currentPorts = new Set(apps.map(a => a.port));
    if (this.knownPorts.size > 0) {
      for (const p of currentPorts) {
        if (!this.knownPorts.has(p)) {
          const newApp = apps.find(a => a.port === p);
          if (newApp?.hasPortChanged && newApp?.previousPort) {
            window.ui?.showToast(`🔄 Port shift detected: ${newApp.title} moved from :${newApp.previousPort} → :${newApp.port}`, 'info', 6000);
          } else {
            window.ui?.showToast(`⚡ New server detected on port :${p} (${newApp?.title || 'Active'})`, 'info', 4000);
          }
        }
      }
    }
    this.knownPorts = currentPorts;

    this.apps = apps || [];
    this.updateStats();
    if (timestamp) {
      window.ui?.updateLastScannedTime(timestamp);
    }
    this.applyFiltersAndRender();
  }

  getAppByPort(port) {
    const p = Number(port);
    return this.apps.find(a => a.port === p) || null;
  }

  getAppByFingerprint(fingerprint) {
    if (!fingerprint) return null;
    return this.apps.find(a => a.fingerprint === fingerprint) || null;
  }

  async toggleFavorite(port, fingerprint = null) {
    const p = Number(port);
    const target = this.getAppByPort(p) || this.getAppByFingerprint(fingerprint);
    const prevFav = target ? Boolean(target.isFavorite) : false;
    const newFav = !prevFav;

    // Optimistic local update
    if (target) {
      target.isFavorite = newFav;
      this.updateStats();
      this.applyFiltersAndRender();
    }

    try {
      const res = await fetch(`/api/apps/${port}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint })
      });
      const data = await res.json();
      if (data.success) {
        this.onFavoriteToggled(port, fingerprint || data.fingerprint, data.isFavorite);
        window.ui?.showToast(
          data.isFavorite ? `⭐ Starred ${target?.title || `:${port}`}` : `☆ Removed ${target?.title || `:${port}`} from favorites`,
          'info'
        );
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      // Revert optimistic update on error
      if (target) {
        target.isFavorite = prevFav;
        this.updateStats();
        this.applyFiltersAndRender();
      }
      window.ui?.showToast('Failed to update favorite', 'danger');
    }
  }

  onFavoriteToggled(port, fingerprint, isFavorite) {
    const p = Number(port);
    for (const app of this.apps) {
      if (app.port === p || (fingerprint && app.fingerprint === fingerprint)) {
        app.isFavorite = isFavorite;
      }
    }
    this.updateStats();
    this.applyFiltersAndRender();
  }

  toggleFavoriteLocal(port, isFav) {
    this.toggleFavorite(port);
  }

  updateStats() {
    const scope = window.ui ? window.ui.currentScope : 'apps';
    const devApps = this.apps.filter(a => a.isDevApp);
    const pool = scope === 'apps' ? devApps : this.apps;

    const stats = {
      total: this.apps.length,
      devAppsCount: devApps.length,
      web: 0,
      api: 0,
      ai: 0,
      db: 0,
      system: 0,
      fav: 0
    };

    // Calculate favorites across all registered apps so count is always accurate
    for (const a of this.apps) {
      if (a.isFavorite) stats.fav++;
    }

    for (const a of pool) {
      if (a.category === 'web') stats.web++;
      else if (a.category === 'api') stats.api++;
      else if (a.category === 'ai') stats.ai++;
      else if (a.category === 'db') stats.db++;
      else if (a.category === 'system') stats.system++;
    }

    window.ui?.updateMetrics(stats);
  }

  applyFiltersAndRender() {
    const scope = window.ui ? window.ui.currentScope : 'apps';
    const cat = window.ui ? window.ui.currentCategory : 'all';
    const query = window.ui ? window.ui.searchQuery : '';

    this.filteredApps = this.apps.filter(app => {
      // 1. Favorites Category Tab: ALWAYS show favorited apps
      if (cat === 'fav') {
        if (!app.isFavorite) return false;
      } else {
        // Scope Filter (Dev Apps focus vs All Open Ports)
        if (scope === 'apps' && !app.isDevApp) return false;

        // Specific Category Filter
        if (cat !== 'all' && app.category !== cat) return false;
      }

      // 3. Search Query Filter
      if (query) {
        const portStr = String(app.port);
        const pidStr = String(app.pid || '');
        const title = (app.title || '').toLowerCase();
        const rawTitle = (app.rawTitle || '').toLowerCase();
        const framework = (app.framework || '').toLowerCase();
        const cwd = (app.cwd || '').toLowerCase();
        const desc = (app.description || '').toLowerCase();
        const tags = (app.tags || []).join(' ').toLowerCase();
        const gitBranch = (app.git?.branch || '').toLowerCase();

        const matches = (
          portStr.includes(query) ||
          pidStr.includes(query) ||
          title.includes(query) ||
          rawTitle.includes(query) ||
          framework.includes(query) ||
          cwd.includes(query) ||
          desc.includes(query) ||
          tags.includes(query) ||
          gitBranch.includes(query)
        );

        if (!matches) return false;
      }

      return true;
    });

    // Render to Active Views
    window.radar?.setApps(this.filteredApps);
    window.cards?.render(this.filteredApps);
    window.table?.render(this.filteredApps);
  }

  connectSse() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    try {
      this.eventSource = new EventSource('/api/events');
      
      this.eventSource.addEventListener('connected', (e) => {
        const dot = document.querySelector('.connection-status .status-dot');
        const label = document.querySelector('.connection-status .status-label');
        if (dot) dot.classList.add('pulsing');
        if (label) label.textContent = 'Live Radar Active';
      });

      this.eventSource.addEventListener('apps_updated', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.apps) {
            this.setApps(payload.apps, payload.timestamp);
          }
        } catch (_) {}
      });

      this.eventSource.addEventListener('meta_changed', () => {
        this.fetchApps();
      });

      this.eventSource.addEventListener('favorite_toggled', (e) => {
        try {
          const payload = JSON.parse(e.data);
          this.onFavoriteToggled(payload.port, payload.fingerprint, payload.isFavorite);
        } catch (_) {}
      });

      this.eventSource.onerror = () => {
        const dot = document.querySelector('.connection-status .status-dot');
        const label = document.querySelector('.connection-status .status-label');
        if (dot) dot.classList.remove('pulsing');
        if (label) label.textContent = 'Reconnecting...';
      };
    } catch (err) {
      console.warn('[SSE] EventSource not available, relying on polling:', err);
    }
  }

  setAutoRefreshInterval(ms) {
    this.pollIntervalMs = ms;
    this.startPolling();
  }

  startPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => {
        this.fetchApps();
      }, this.pollIntervalMs);
    }
  }
}

// Bootstrap on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.appState = new AppState();
});
