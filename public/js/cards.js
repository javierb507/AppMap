/**
 * AppMap: Cards Grid Renderer
 * Renders rich developer glass cards with live metrics, framework icons,
 * working directory quick-actions, git branches, and instant launch buttons.
 */

class CardsRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(apps) {
    if (!this.container) return;

    if (!apps || apps.length === 0) {
      this.container.innerHTML = '';
      const empty = document.getElementById('gridEmptyState');
      if (empty) empty.classList.remove('hidden');
      return;
    }

    const empty = document.getElementById('gridEmptyState');
    if (empty) empty.classList.add('hidden');

    this.container.innerHTML = apps.map(app => this.createCardHtml(app)).join('');

    // Attach card event listeners
    this.attachEvents();
  }

  createCardHtml(app) {
    const isSelf = app.isSelf;
    const isFav = app.isFavorite;
    const isRemote = window.appState ? window.appState.isRemoteClient() : false;
    const targetUrl = window.appState ? window.appState.getAppTargetUrl(app) : (app.customUrl || `http://localhost:${app.port}`);
    const effectiveHost = window.appState ? window.appState.getEffectiveHost(app) : 'localhost';

    // Status styling
    let statusClass = 'offline';
    let statusText = app.statusText || 'Offline';
    if (app.isHttp) {
      if (app.status === 200) {
        statusClass = 'online-200';
        statusText = '200 OK';
      } else {
        statusClass = 'online-warn';
        statusText = `${app.status} ${app.statusText || ''}`;
      }
    } else if (app.isRawTcp) {
      statusClass = 'raw-tcp';
      statusText = 'TCP Socket';
    }

    // Framework badge
    const frameworkBadge = app.framework ? `<span class="framework-badge">${this.escapeHtml(app.framework)}</span>` : '';
    const frameworkIcon = this.getFrameworkIcon(app.framework, app.processName);

    // App Icon & Favicon handling (priority: customIcon -> local/web favicon -> framework emoji)
    let iconHtml = '';
    if (app.customIcon) {
      if (app.customIcon.startsWith('http') || app.customIcon.startsWith('/') || app.customIcon.startsWith('data:')) {
        iconHtml = `<img src="${app.customIcon}" class="app-favicon" alt=""><span style="display:none;">${frameworkIcon}</span>`;
      } else {
        iconHtml = `<span class="app-custom-emoji" style="font-size:1.3rem;">${this.escapeHtml(app.customIcon)}</span>`;
      }
    } else if (app.favicon) {
      const src = (app.favicon.startsWith('data:') || app.favicon.startsWith('/api/app-icon/')) 
        ? app.favicon 
        : `/api/favicon-proxy?url=${encodeURIComponent(app.favicon)}`;
      iconHtml = `<img src="${src}" class="app-favicon" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';" alt=""><span style="display:none;">${frameworkIcon}</span>`;
    } else {
      iconHtml = `<span>${frameworkIcon}</span>`;
    }

    // Port Shift Badge
    const portShiftHtml = (app.hasPortChanged && app.previousPort) ? `
      <span class="port-shift-badge" title="${this.escapeHtml(app.portChangedText || '')}">
        <span>🔄 :${app.previousPort} → :${app.port}</span>
      </span>
    ` : '';

    // Network Scope Binding Badge (LAN vs Local)
    const bindingBadgeHtml = app.isNetworkExposed ? `
      <span class="binding-badge badge-lan" title="Bound to ${this.escapeHtml(app.bindingLabel || '0.0.0.0')}: Accessible from any device on your LAN">
        🌐 LAN
      </span>
    ` : `
      <span class="binding-badge badge-local" title="Bound to ${this.escapeHtml(app.bindingLabel || '127.0.0.1')}: Strictly local loopback on host machine">
        🔒 Local
      </span>
    `;

    // Warning banner if client is viewing remotely but app is loopback-only
    const remoteWarningHtml = (app.isLoopbackOnly && isRemote) ? `
      <div class="warning-remote-loopback" title="This application is bound only to 127.0.0.1 on the host server. To access it from your remote browser, bind it to 0.0.0.0 or establish an SSH tunnel.">
        <span>⚠️</span>
        <span>Host loopback only (127.0.0.1)</span>
      </div>
    ` : '';

    // Working directory chip
    const cwdHtml = app.cwd ? `
      <div class="meta-chip cwd-chip" title="Click to copy path: ${this.escapeHtml(app.cwd)}" data-copy="${this.escapeHtml(app.cwd)}">
        <span>📁</span>
        <span class="cwd-text">${this.escapeHtml(app.cwdBasename || app.cwd)}</span>
        <button class="open-folder-btn" title="Open in ${window.appPlatform?.fileManager || 'file manager'}" data-folder="${this.escapeHtml(app.cwd)}" onclick="event.stopPropagation();">↗</button>
      </div>
    ` : '';

    // Git branch chip
    const gitHtml = app.git ? `
      <div class="meta-chip git-chip" title="Git Branch: ${this.escapeHtml(app.git.branch)}">
        <span></span>
        <span>${this.escapeHtml(app.git.branch)}</span>
      </div>
    ` : '';

    // PID chip
    const pidHtml = app.pid ? `
      <div class="meta-chip pid-chip" title="Process: ${this.escapeHtml(app.processName || '')}">
        <span>PID:</span> <strong>${app.pid}</strong>
      </div>
    ` : (app.isManual ? `<div class="meta-chip pid-chip"><span>Manual Entry</span></div>` : '');

    // User tags
    const tagsHtml = (app.tags && app.tags.length > 0) ? `
      <div class="card-tags-row">
        ${app.tags.map(t => `<span class="user-tag-pill">#${this.escapeHtml(t)}</span>`).join('')}
      </div>
    ` : '';

    // Button label
    let openBtnLabel = 'Open Localhost';
    if (app.isLoopbackOnly && isRemote) {
      openBtnLabel = 'Open (Local Only)';
    } else if (effectiveHost !== 'localhost' && effectiveHost !== '127.0.0.1') {
      openBtnLabel = `Open ${effectiveHost}`;
    }

    return `
      <div class="app-card ${isSelf ? 'self-card' : ''}" data-port="${app.port}" data-category="${app.category}">
        <!-- Header -->
        <div class="card-header">
          <div class="card-header-left">
            <span class="port-pill" title="Click to copy URL: ${this.escapeHtml(targetUrl)}" data-copy-url="${targetUrl}">
              <span>:${app.port}</span>
              <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </span>
            ${bindingBadgeHtml}
            ${isSelf ? '<span class="brand-badge">📍 Hub</span>' : ''}
            ${portShiftHtml}
          </div>

          <div class="card-header-right">
            ${app.latencyMs ? `<span class="latency-chip">${app.latencyMs}ms</span>` : ''}
            <span class="status-badge ${statusClass}">
              <span class="status-dot"></span>
              <span>${statusText}</span>
            </span>
            <button class="btn-fav-star ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}" data-fav-port="${app.port}" data-fav-fp="${this.escapeHtml(app.fingerprint || '')}">
              ${isFav ? '★' : '☆'}
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="card-body">
          <div class="card-title-row">
            <div class="framework-icon-badge" title="${app.framework || app.processName || 'App'}">
              ${iconHtml}
            </div>
            <h3 class="card-title" title="${this.escapeHtml(app.title)}">${this.escapeHtml(app.title)}</h3>
            ${frameworkBadge}
          </div>

          ${app.description ? `<p class="card-description" title="${this.escapeHtml(app.description)}">${this.escapeHtml(app.description)}</p>` : ''}

          <div class="card-chips-row">
            ${cwdHtml}
            ${gitHtml}
            ${pidHtml}
          </div>

          ${tagsHtml}
          ${remoteWarningHtml}
        </div>

        <!-- Actions -->
        <div class="card-actions">
          <a href="${targetUrl}" target="_blank" class="btn-open-app" title="Launch ${this.escapeHtml(targetUrl)}">
            <span>${openBtnLabel}</span>
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
          <button class="btn-card-action btn-edit-meta" title="Inspect & Edit Details" data-edit-port="${app.port}">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          ${!isSelf && app.pid ? `
            <button class="btn-card-action btn-kill" title="Kill process PID ${app.pid}" data-kill-pid="${app.pid}" data-kill-port="${app.port}" data-kill-name="${this.escapeHtml(app.title)}" data-kill-cwd="${this.escapeHtml(app.cwd || '')}">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  attachEvents() {
    // Port pill copy
    this.container.querySelectorAll('[data-copy-url]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = el.getAttribute('data-copy-url');
        navigator.clipboard.writeText(url).then(() => {
          window.ui?.showToast(`Copied URL: ${url}`, 'success');
        });
      });
    });

    // CWD path copy
    this.container.querySelectorAll('.cwd-chip[data-copy]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = el.getAttribute('data-copy');
        navigator.clipboard.writeText(path).then(() => {
          window.ui?.showToast(`Copied folder path: ${path}`, 'success');
        });
      });
    });

    // Open Folder in the OS file manager (Finder / Explorer / xdg-open)
    this.container.querySelectorAll('.open-folder-btn[data-folder]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const folder = el.getAttribute('data-folder');
        const fm = window.appPlatform?.fileManager || 'file manager';
        try {
          const res = await fetch('/api/actions/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: folder, app: 'FileManager' })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
          window.ui?.showToast(`Opened folder in ${fm}: ${folder}`, 'info');
        } catch (err) {
          window.ui?.showToast(`Failed to open folder: ${err.message}`, 'danger');
        }
      });
    });

    // Star / Favorite toggle
    this.container.querySelectorAll('[data-fav-port]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const port = el.getAttribute('data-fav-port');
        const fp = el.getAttribute('data-fav-fp');
        window.appState.toggleFavorite(port, fp);
      });
    });

    // Edit Metadata Modal button
    this.container.querySelectorAll('[data-edit-port]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const port = el.getAttribute('data-edit-port');
        const app = window.appState.getAppByPort(port);
        if (app && window.modal) {
          window.modal.openEditModal(app);
        }
      });
    });

    // Kill button
    this.container.querySelectorAll('[data-kill-pid]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = el.getAttribute('data-kill-pid');
        const port = el.getAttribute('data-kill-port');
        const name = el.getAttribute('data-kill-name');
        const cwd = el.getAttribute('data-kill-cwd');
        if (window.modal) {
          window.modal.openKillModal({ pid, port, name, cwd });
        }
      });
    });
  }

  getFrameworkIcon(framework, processName) {
    if (!framework && !processName) return '📦';
    const fw = (framework || '').toLowerCase();
    const proc = (processName || '').toLowerCase();

    if (fw.includes('vite')) return '⚡';
    if (fw.includes('next')) return '▲';
    if (fw.includes('react')) return '⚛️';
    if (fw.includes('fastapi') || fw.includes('python')) return '🐍';
    if (fw.includes('ollama')) return '🦙';
    if (fw.includes('vue')) return '🟢';
    if (fw.includes('svelte')) return '🧡';
    if (fw.includes('astro')) return '🚀';
    if (fw.includes('angular')) return '🔺';
    if (fw.includes('express') || fw.includes('node')) return '🟩';
    if (fw.includes('docker')) return '🐳';
    if (fw.includes('postgres') || fw.includes('sql')) return '🐘';
    if (fw.includes('redis')) return '🔴';
    if (proc.includes('spotify')) return '🎵';
    if (proc.includes('onedrive')) return '☁️';
    if (proc.includes('electron')) return '⚛️';

    return '🌐';
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
}

window.CardsRenderer = CardsRenderer;
