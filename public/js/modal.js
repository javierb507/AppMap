/**
 * AppMap: Modals & Dialogs Manager
 * Native <dialog> controllers with light-dismiss, technical inspector,
 * custom metadata editor, and process killer confirmation.
 */

class ModalManager {
  constructor() {
    this.editDialog = document.getElementById('editModal');
    this.manualDialog = document.getElementById('manualModal');
    this.killDialog = document.getElementById('killModal');

    this.pendingKillInfo = null;

    this.init();
  }

  init() {
    // Edit Modal Events
    document.getElementById('closeEditModalBtn')?.addEventListener('click', () => this.editDialog.close());
    document.getElementById('btnCancelEditModal')?.addEventListener('click', () => this.editDialog.close());
    
    // Light-dismiss: click on backdrop closes modal
    [this.editDialog, this.manualDialog, this.killDialog].forEach(dialog => {
      if (!dialog) return;
      dialog.addEventListener('click', (e) => {
        const rect = dialog.getBoundingClientRect();
        const isInDialog = (
          rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX && e.clientX <= rect.left + rect.width
        );
        if (!isInDialog) {
          dialog.close();
        }
      });
    });

    // Form submit for Edit Modal
    document.getElementById('editAppForm')?.addEventListener('submit', (e) => this.handleSaveMeta(e));
    document.getElementById('btnDeleteCustomMeta')?.addEventListener('click', () => this.handleResetMeta());

    // Emoji Palette Click Listeners
    const iconInput = document.getElementById('editCustomIconInput');
    const previewGlyph = document.getElementById('modalIconPreviewGlyph');
    const previewBox = document.getElementById('modalIconPreview');

    document.querySelectorAll('.btn-emoji-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        if (iconInput) iconInput.value = emoji;
        if (previewGlyph) previewGlyph.innerHTML = emoji;
        document.querySelectorAll('.btn-emoji-pick').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Custom Icon Input live change
    if (iconInput) {
      iconInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (!val) {
          if (previewGlyph) previewGlyph.innerHTML = '🌐';
        } else if (val.startsWith('http') || val.startsWith('/') || val.startsWith('data:')) {
          if (previewGlyph) previewGlyph.innerHTML = `<img src="${val}" alt="" onerror="this.outerHTML='🌐'">`;
        } else {
          if (previewGlyph) previewGlyph.innerHTML = val;
        }
      });
    }

    // Reset Icon button
    document.getElementById('btnClearCustomIcon')?.addEventListener('click', () => {
      if (iconInput) iconInput.value = '';
      document.querySelectorAll('.btn-emoji-pick').forEach(b => b.classList.remove('selected'));
      const port = document.getElementById('editPortInput')?.value;
      const app = window.appState?.getAppByPort(port);
      this.updateIconPreview(app, '');
    });

    // Manual Modal Events
    document.getElementById('btnManualAdd')?.addEventListener('click', () => this.openManualModal());
    document.getElementById('closeManualModalBtn')?.addEventListener('click', () => this.manualDialog.close());
    document.getElementById('btnCancelManualModal')?.addEventListener('click', () => this.manualDialog.close());
    document.getElementById('manualAppForm')?.addEventListener('submit', (e) => this.handleSaveManual(e));

    // Kill Modal Events
    document.getElementById('closeKillModalBtn')?.addEventListener('click', () => this.killDialog.close());
    document.getElementById('btnCancelKill')?.addEventListener('click', () => this.killDialog.close());
    document.getElementById('btnConfirmKill')?.addEventListener('click', () => this.handleConfirmKill());
  }

  updateIconPreview(app, customIcon = null) {
    const previewGlyph = document.getElementById('modalIconPreviewGlyph');
    if (!previewGlyph) return;

    const iconVal = customIcon !== null ? customIcon : (app?.customIcon || '');
    if (iconVal) {
      if (iconVal.startsWith('http') || iconVal.startsWith('/') || iconVal.startsWith('data:')) {
        previewGlyph.innerHTML = `<img src="${iconVal}" alt="" onerror="this.outerHTML='🌐'">`;
      } else {
        previewGlyph.innerHTML = iconVal;
      }
      return;
    }

    if (app?.favicon) {
      previewGlyph.innerHTML = `<img src="${app.favicon}" alt="" onerror="this.outerHTML='🌐'">`;
    } else {
      previewGlyph.innerHTML = '🌐';
    }
  }

  openEditModal(app) {
    if (!app || !this.editDialog) return;

    document.getElementById('editPortInput').value = app.port;
    document.getElementById('editFingerprintInput').value = app.fingerprint || '';
    document.getElementById('modalPortBadge').textContent = `:${app.port}`;
    document.getElementById('modalAppTitle').textContent = `Edit Details • ${app.title || `Port ${app.port}`}`;

    document.getElementById('editTitleInput').value = app.rawTitle === app.title && !app.hasCustomMeta ? '' : (app.title || '');
    document.getElementById('editTitleInput').placeholder = app.rawTitle || `App on :${app.port}`;

    document.getElementById('editCategorySelect').value = app.category || 'web';
    document.getElementById('editTagsInput').value = (app.tags || []).join(', ');
    document.getElementById('editUrlInput').value = app.customUrl || `http://localhost:${app.port}`;
    document.getElementById('editNotesInput').value = app.notes || '';
    
    // Icon state
    const iconInput = document.getElementById('editCustomIconInput');
    if (iconInput) iconInput.value = app.customIcon || '';
    document.querySelectorAll('.btn-emoji-pick').forEach(b => {
      b.classList.toggle('selected', b.getAttribute('data-emoji') === app.customIcon);
    });
    this.updateIconPreview(app, app.customIcon);

    // Populate Technical Deep-Dive Inspector
    document.getElementById('techPid').textContent = app.pid || 'N/A';
    document.getElementById('techProc').textContent = app.processName || 'N/A';
    document.getElementById('techFramework').textContent = app.framework || 'Generic';
    document.getElementById('techLatency').textContent = app.latencyMs ? `${app.latencyMs}ms` : 'N/A';
    document.getElementById('techStatus').textContent = app.status ? `${app.status} ${app.statusText || ''}` : (app.statusText || 'Offline');
    document.getElementById('techGit').textContent = app.git ? `${app.git.branch} (${app.git.repoName})` : 'Not in Git repo';
    
    // Network Binding & Scope
    const hostEl = document.getElementById('techHost');
    const scopeEl = document.getElementById('techScope');
    const lanUrlEl = document.getElementById('techLanUrl');
    const localUrlEl = document.getElementById('techLocalUrl');

    const lanIp = app.primaryLanIp || window.appState?.primaryLanIp || '127.0.0.1';
    if (hostEl) hostEl.textContent = app.bindingLabel || (app.isLoopbackOnly ? '127.0.0.1 (Local Only)' : '0.0.0.0 (All Interfaces)');
    if (scopeEl) scopeEl.textContent = app.isNetworkExposed ? '🌐 LAN Accessible' : '🔒 Host Loopback Only';
    if (lanUrlEl) lanUrlEl.textContent = app.isNetworkExposed ? `http://${lanIp}:${app.port}` : 'Not exposed to LAN (Loopback only)';
    if (localUrlEl) localUrlEl.textContent = `http://localhost:${app.port}`;

    document.getElementById('techCwd').textContent = app.cwd || 'N/A';
    document.getElementById('techCmd').textContent = app.command || 'N/A';

    this.editDialog.showModal();
  }

  async handleSaveMeta(e) {
    e.preventDefault();
    const port = document.getElementById('editPortInput').value;
    const fingerprint = document.getElementById('editFingerprintInput').value;
    const title = document.getElementById('editTitleInput').value.trim();
    const category = document.getElementById('editCategorySelect').value;
    const tagsRaw = document.getElementById('editTagsInput').value;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    const url = document.getElementById('editUrlInput').value.trim();
    const notes = document.getElementById('editNotesInput').value.trim();
    const customIcon = document.getElementById('editCustomIconInput').value.trim();

    try {
      const res = await fetch(`/api/apps/${port}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category, tags, url, notes, customIcon, fingerprint })
      });
      const data = await res.json();
      if (data.success) {
        window.ui?.showToast(`Saved identity & metadata for ${title || `:${port}`}`, 'success');
        this.editDialog.close();
        window.appState.fetchApps();
      }
    } catch (err) {
      window.ui?.showToast(`Error saving metadata: ${err.message}`, 'danger');
    }
  }

  async handleResetMeta() {
    const port = document.getElementById('editPortInput').value;
    const fingerprint = document.getElementById('editFingerprintInput').value;
    try {
      const res = await fetch(`/api/apps/${port}/meta?fingerprint=${encodeURIComponent(fingerprint)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        window.ui?.showToast(`Reset metadata to automatic discovery`, 'info');
        this.editDialog.close();
        window.appState.fetchApps();
      }
    } catch (err) {
      window.ui?.showToast(`Error resetting: ${err.message}`, 'danger');
    }
  }

  openManualModal() {
    if (!this.manualDialog) return;
    document.getElementById('manualAppForm').reset();
    this.manualDialog.showModal();
  }

  async handleSaveManual(e) {
    e.preventDefault();
    const port = document.getElementById('manualPortInput').value;
    const name = document.getElementById('manualNameInput').value.trim();
    const url = document.getElementById('manualUrlInput').value.trim();
    const category = document.getElementById('manualCategorySelect').value;
    const notes = document.getElementById('manualNotesInput').value.trim();

    try {
      const res = await fetch('/api/apps/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, name, url, category, notes })
      });
      const data = await res.json();
      if (data.success) {
        window.ui?.showToast(`Custom service "${name}" registered on :${port}`, 'success');
        this.manualDialog.close();
        window.appState.fetchApps();
      }
    } catch (err) {
      window.ui?.showToast(`Error adding service: ${err.message}`, 'danger');
    }
  }

  openKillModal({ pid, port, name, cwd }) {
    if (!this.killDialog) return;
    this.pendingKillInfo = { pid, port, name, cwd };

    document.getElementById('killPortText').textContent = `:${port}`;
    document.getElementById('killProcessNameText').textContent = name || 'Process';
    document.getElementById('killPidText').textContent = pid;
    document.getElementById('killCwdText').textContent = cwd || 'N/A';

    this.killDialog.showModal();
  }

  async handleConfirmKill() {
    if (!this.pendingKillInfo) return;
    const { pid, port, name } = this.pendingKillInfo;
    const signalRadio = document.querySelector('input[name="killSignal"]:checked');
    const signal = signalRadio ? signalRadio.value : 'SIGTERM';

    try {
      const btn = document.getElementById('btnConfirmKill');
      btn.textContent = 'Terminating...';
      btn.disabled = true;

      const res = await fetch('/api/actions/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid, signal })
      });

      const data = await res.json();
      btn.textContent = 'Yes, Terminate Process';
      btn.disabled = false;

      if (data.success) {
        window.ui?.showToast(`Terminated PID ${pid} (Port :${port})`, 'success');
        this.killDialog.close();
        this.pendingKillInfo = null;
        setTimeout(() => window.appState.fetchApps(), 600);
      } else {
        window.ui?.showToast(`Kill failed: ${data.error}`, 'danger');
      }
    } catch (err) {
      window.ui?.showToast(`Failed: ${err.message}`, 'danger');
    }
  }
}

window.ModalManager = ModalManager;
