const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'app-map-data.json');

class Store {
  constructor() {
    this.data = {
      appRegistry: {},   // Keyed by fingerprint (stable app identity across port changes)
      customMeta: {},    // Keyed by port number or id (legacy / fallback)
      manualApps: [],    // User-added manual ports / services
      favorites: [],     // Array of port numbers or fingerprint strings
      settings: {
        autoRefreshInterval: 5000,
        filterCategory: 'all',
        theme: 'dark',
        hostMode: 'auto',     // 'auto' | 'lan' | 'localhost' | 'custom'
        customHost: ''
      }
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          ...this.data,
          ...parsed,
          appRegistry: parsed.appRegistry || {},
          customMeta: parsed.customMeta || {},
          manualApps: parsed.manualApps || [],
          favorites: parsed.favorites || [],
          settings: { ...this.data.settings, ...(parsed.settings || {}) }
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[Store] Error loading data file:', err);
    }
  }

  save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[Store] Error saving data file:', err);
    }
  }

  /**
   * Tracks an app by its fingerprint, detecting when its port has changed
   */
  registerOrUpdateApp({ fingerprint, port, title, category, framework, cwd, favicon }) {
    if (!fingerprint) return { hasPortChanged: false, previousPort: null, record: null };

    const p = Number(port);
    let record = this.data.appRegistry[fingerprint];
    let hasPortChanged = false;
    let previousPort = null;

    if (!record) {
      // First time registering this app by fingerprint
      // Check if this port was already in favorites or customMeta
      const isFav = this.data.favorites.includes(p) || this.data.favorites.includes(fingerprint);
      const meta = this.data.customMeta[String(p)] || {};

      record = {
        fingerprint,
        name: meta.title || title || `App (:${p})`,
        customTitle: meta.title || '',
        customIcon: meta.customIcon || '',
        currentPort: p,
        previousPort: null,
        portHistory: [p],
        hasPortChanged: false,
        portChangedAt: null,
        favorite: isFav,
        category: meta.category || category || 'web',
        tags: meta.tags || [],
        notes: meta.notes || '',
        cwd: cwd || null,
        framework: framework || null,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      };
      this.data.appRegistry[fingerprint] = record;
      this.save();
    } else {
      // Record exists: check if port changed
      record.lastSeenAt = new Date().toISOString();
      if (cwd) record.cwd = cwd;
      if (framework) record.framework = framework;

      if (record.currentPort && record.currentPort !== p) {
        // PORT CHANGE DETECTED!
        hasPortChanged = true;
        previousPort = record.currentPort;
        record.hasPortChanged = true;
        record.previousPort = previousPort;
        record.currentPort = p;
        if (!record.portHistory) record.portHistory = [];
        if (!record.portHistory.includes(p)) {
          record.portHistory.push(p);
        }
        record.portChangedAt = new Date().toISOString();
        this.save();
      } else {
        hasPortChanged = Boolean(record.hasPortChanged);
        previousPort = record.previousPort;
      }

      // Sync favorite state if previously favorited by port
      if (this.data.favorites.includes(p) && !record.favorite) {
        record.favorite = true;
        this.save();
      }
    }

    return {
      hasPortChanged,
      previousPort,
      record
    };
  }

  getAppRecord(fingerprint) {
    if (!fingerprint) return null;
    return this.data.appRegistry[fingerprint] || null;
  }

  getCustomMeta(key, fingerprint = null) {
    const k = String(key);
    const byPort = this.data.customMeta[k] || {};
    const byFp = (fingerprint && this.data.appRegistry[fingerprint]) ? this.data.appRegistry[fingerprint] : {};

    return {
      ...byPort,
      ...byFp,
      title: byFp.customTitle || byPort.title || '',
      customIcon: byFp.customIcon || byPort.customIcon || '',
      category: byFp.category || byPort.category || null,
      tags: byFp.tags || byPort.tags || [],
      notes: byFp.notes || byPort.notes || ''
    };
  }

  setCustomMeta(key, meta, fingerprint = null) {
    const k = String(key);
    this.data.customMeta[k] = {
      ...(this.data.customMeta[k] || {}),
      ...meta,
      updatedAt: new Date().toISOString()
    };

    if (fingerprint) {
      if (!this.data.appRegistry[fingerprint]) {
        this.data.appRegistry[fingerprint] = {
          fingerprint,
          currentPort: Number(key) || 0,
          portHistory: [Number(key) || 0],
          favorite: this.isFavorite(fingerprint, key)
        };
      }
      const reg = this.data.appRegistry[fingerprint];
      if (meta.title !== undefined) reg.customTitle = meta.title;
      if (meta.customIcon !== undefined) reg.customIcon = meta.customIcon;
      if (meta.category !== undefined) reg.category = meta.category;
      if (meta.tags !== undefined) reg.tags = meta.tags;
      if (meta.notes !== undefined) reg.notes = meta.notes;
      reg.updatedAt = new Date().toISOString();
    }

    this.save();
    return this.getCustomMeta(key, fingerprint);
  }

  deleteCustomMeta(key, fingerprint = null) {
    const k = String(key);
    delete this.data.customMeta[k];
    if (fingerprint && this.data.appRegistry[fingerprint]) {
      this.data.appRegistry[fingerprint].customTitle = '';
      this.data.appRegistry[fingerprint].customIcon = '';
      this.data.appRegistry[fingerprint].notes = '';
      this.data.appRegistry[fingerprint].tags = [];
    }
    this.save();
  }

  toggleFavorite(identifier, port = null) {
    const p = port ? Number(port) : (!isNaN(Number(identifier)) ? Number(identifier) : null);
    const fp = String(identifier);

    let isFav = false;

    // 1. If fingerprint exists in appRegistry, toggle there
    if (this.data.appRegistry[fp]) {
      this.data.appRegistry[fp].favorite = !this.data.appRegistry[fp].favorite;
      isFav = this.data.appRegistry[fp].favorite;
    } else if (p && this.isFavorite(null, p)) {
      isFav = false;
    } else {
      isFav = true;
    }

    // 2. Sync favorites array for both port and fingerprint
    if (p) {
      const pIdx = this.data.favorites.indexOf(p);
      if (isFav && pIdx < 0) {
        this.data.favorites.push(p);
      } else if (!isFav && pIdx >= 0) {
        this.data.favorites.splice(pIdx, 1);
      }
    }

    const fpIdx = this.data.favorites.indexOf(fp);
    if (isFav && fpIdx < 0) {
      this.data.favorites.push(fp);
    } else if (!isFav && fpIdx >= 0) {
      this.data.favorites.splice(fpIdx, 1);
    }

    // Also update any appRegistry entry matching port
    for (const rec of Object.values(this.data.appRegistry)) {
      if (rec.currentPort === p || rec.fingerprint === fp) {
        rec.favorite = isFav;
      }
    }

    this.save();
    return isFav;
  }

  isFavorite(fingerprint, port) {
    if (fingerprint && this.data.appRegistry[fingerprint]?.favorite) {
      return true;
    }
    if (fingerprint && this.data.favorites.includes(String(fingerprint))) {
      return true;
    }
    if (port && this.data.favorites.includes(Number(port))) {
      return true;
    }
    return false;
  }

  addManualApp(app) {
    const id = 'manual_' + Date.now();
    const entry = {
      id,
      isManual: true,
      port: Number(app.port) || 0,
      name: app.name || `Custom Service (${app.port})`,
      url: app.url || `http://localhost:${app.port}`,
      category: app.category || 'web',
      framework: app.framework || 'Custom',
      customIcon: app.customIcon || '',
      notes: app.notes || '',
      tags: app.tags || [],
      createdAt: new Date().toISOString()
    };
    this.data.manualApps.push(entry);
    this.save();
    return entry;
  }

  removeManualApp(id) {
    this.data.manualApps = this.data.manualApps.filter(a => a.id !== id);
    this.save();
  }

  getManualApps() {
    return this.data.manualApps || [];
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
    return this.data.settings;
  }

  getSettings() {
    return this.data.settings;
  }
}

module.exports = new Store();
