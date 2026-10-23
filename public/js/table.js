/**
 * AppMap: Matrix Table Renderer
 * High-density tabular view with sorting and quick process actions.
 */

class TableRenderer {
  constructor(tableBodyId) {
    this.tbody = document.getElementById(tableBodyId);
    this.sortKey = 'port';
    this.sortAsc = true;
    this.initSortHeaders();
  }

  initSortHeaders() {
    document.querySelectorAll('.matrix-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (this.sortKey === key) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortKey = key;
          this.sortAsc = true;
        }

        // Update header UI indicators
        document.querySelectorAll('.matrix-table th.sortable').forEach(h => {
          h.textContent = h.textContent.replace(/ [▲▼]/g, '');
        });
        th.textContent += this.sortAsc ? ' ▲' : ' ▼';

        window.appState.applyFiltersAndRender();
      });
    });
  }

  sortApps(apps) {
    return [...apps].sort((a, b) => {
      let valA = a[this.sortKey];
      let valB = b[this.sortKey];

      if (this.sortKey === 'latency') {
        valA = a.latencyMs || 9999;
        valB = b.latencyMs || 9999;
      }

      if (typeof valA === 'string') {
        return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return this.sortAsc ? (valA - valB) : (valB - valA);
    });
  }

  render(apps) {
    if (!this.tbody) return;

    if (!apps || apps.length === 0) {
      this.tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 2.5rem; color: var(--text-dim);">No applications match current filters.</td></tr>`;
      return;
    }

    const sorted = this.sortApps(apps);

    this.tbody.innerHTML = sorted.map(app => {
      const isSelf = app.isSelf;
      const isFav = app.isFavorite;
      const targetUrl = app.customUrl || `http://localhost:${app.port}`;

      let statusBadge = `<span class="status-badge offline">Offline</span>`;
      if (app.isHttp) {
        if (app.status === 200) {
          statusBadge = `<span class="status-badge online-200">200 OK</span>`;
        } else {
          statusBadge = `<span class="status-badge online-warn">${app.status}</span>`;
        }
      } else if (app.isRawTcp) {
        statusBadge = `<span class="status-badge raw-tcp">TCP</span>`;
      }

      // Icon resolution
      let iconHtml = '';
      if (app.customIcon) {
        if (app.customIcon.startsWith('http') || app.customIcon.startsWith('/') || app.customIcon.startsWith('data:')) {
          iconHtml = `<img src="${app.customIcon}" style="width:16px; height:16px; object-fit:contain; vertical-align:middle; margin-right:6px;" alt="">`;
        } else {
          iconHtml = `<span style="margin-right:6px; font-size:1.1rem; vertical-align:middle;">${this.escapeHtml(app.customIcon)}</span>`;
        }
      } else if (app.favicon) {
        const src = (app.favicon.startsWith('data:') || app.favicon.startsWith('/api/app-icon/')) 
          ? app.favicon 
          : `/api/favicon-proxy?url=${encodeURIComponent(app.favicon)}`;
        iconHtml = `<img src="${src}" style="width:16px; height:16px; object-fit:contain; vertical-align:middle; margin-right:6px;" onerror="this.style.display='none';" alt="">`;
      }

      const portShiftHtml = (app.hasPortChanged && app.previousPort) 
        ? `<span class="port-shift-badge" style="font-size:0.6rem; padding:0.1rem 0.35rem; margin-left:4px;" title="${this.escapeHtml(app.portChangedText || '')}">⟵ :${app.previousPort}</span>` 
        : '';

      return `
        <tr data-port="${app.port}">
          <td class="td-fav">
            <button class="btn-fav-star ${isFav ? 'active' : ''}" data-table-fav="${app.port}" data-table-fp="${this.escapeHtml(app.fingerprint || '')}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
              ${isFav ? '★' : '☆'}
            </button>
          </td>
          <td>${statusBadge}</td>
          <td class="td-port">:${app.port}${portShiftHtml}</td>
          <td class="td-app" title="${this.escapeHtml(app.title)}">
            ${iconHtml}
            <span style="font-weight:700;">${this.escapeHtml(app.title)}</span>
            ${isSelf ? '<span class="brand-badge" style="font-size:0.65rem; margin-left:4px;">Hub</span>' : ''}
          </td>
          <td><span class="framework-badge">${this.escapeHtml(app.framework || app.processName || '-')}</span></td>
          <td class="code-font" style="color:var(--neon-green);">${app.latencyMs ? `${app.latencyMs}ms` : '-'}</td>
          <td class="code-font">${app.pid || (app.isManual ? 'Manual' : '-')}</td>
          <td class="td-cwd" title="${this.escapeHtml(app.cwd || '')}">
            ${app.cwd ? `<span class="code-font">${this.escapeHtml(app.cwdBasename || app.cwd)}</span>` : '-'}
          </td>
          <td>
            ${app.git ? `<span class="meta-chip git-chip" style="font-size:0.7rem;"> ${this.escapeHtml(app.git.branch)}</span>` : '-'}
          </td>
          <td><span class="meta-chip" style="font-size:0.7rem;">${app.category.toUpperCase()}</span></td>
          <td class="td-actions">
            <a href="${targetUrl}" target="_blank" class="btn-open-app" style="padding:0.25rem 0.5rem; font-size:0.75rem;">Open ↗</a>
            <button class="btn-card-action" style="padding:0.25rem 0.5rem;" data-table-edit="${app.port}" title="Edit metadata">✏️</button>
            ${!isSelf && app.pid ? `
              <button class="btn-card-action btn-kill" style="padding:0.25rem 0.5rem;" data-table-kill="${app.pid}" data-table-port="${app.port}" data-table-name="${this.escapeHtml(app.title)}" data-table-cwd="${this.escapeHtml(app.cwd || '')}" title="Kill Process">💀</button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');

    this.attachEvents();
  }

  attachEvents() {
    this.tbody.querySelectorAll('[data-table-fav]').forEach(el => {
      el.addEventListener('click', (e) => {
        const port = el.getAttribute('data-table-fav');
        const fp = el.getAttribute('data-table-fp');
        window.appState.toggleFavorite(port, fp);
      });
    });

    this.tbody.querySelectorAll('[data-table-edit]').forEach(el => {
      el.addEventListener('click', (e) => {
        const port = el.getAttribute('data-table-edit');
        const app = window.appState.getAppByPort(port);
        if (app && window.modal) {
          window.modal.openEditModal(app);
        }
      });
    });

    this.tbody.querySelectorAll('[data-table-kill]').forEach(el => {
      el.addEventListener('click', (e) => {
        const pid = el.getAttribute('data-table-kill');
        const port = el.getAttribute('data-table-port');
        const name = el.getAttribute('data-table-name');
        const cwd = el.getAttribute('data-table-cwd');
        if (window.modal) {
          window.modal.openKillModal({ pid, port, name, cwd });
        }
      });
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
}

window.TableRenderer = TableRenderer;
