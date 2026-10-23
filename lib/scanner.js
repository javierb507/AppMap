const fs = require('fs');
const path = require('path');
const { probePort } = require('./prober');
const store = require('./store');
const platform = require('./platform');

// System processes to flag or filter
const SYSTEM_PROCESSES = new Set([
  'spotify', 'onedrive', 'megasync', 'rcvoipmed', 'antigravity', 
  'dropbox', 'google', 'steam', 'stream', 'language_tool_server'
]);

class Scanner {
  constructor() {
    this.cachedApps = [];
    this.lastScanTime = null;
    this.isScanning = false;
    this.localIcons = new Map(); // port -> absoluteFilePath on disk
  }

  getLocalIcon(port) {
    return this.localIcons.get(Number(port)) || null;
  }

  /**
   * Discovers listening ports and gathers system + HTTP metadata
   */
  async scan(currentDashboardPort = 10000) {
    if (this.isScanning) {
      return this.cachedApps;
    }
    this.isScanning = true;

    try {
      // 1. Get listening ports (lsof on macOS, ss on Linux, Get-NetTCPConnection on Windows)
      const parsedListeners = platform.listListeners();
      const pids = Array.from(new Set(parsedListeners.map(l => l.pid).filter(Boolean)));

      // 2. Batch get full command lines + process names
      const processCommands = platform.getProcessCommands(pids);
      const processNames = platform.getProcessNames(pids);

      // 3. Batch get working directories (falls back to command-line inference)
      const processCwds = platform.getProcessCwds(pids, processCommands);

      // 4. Group listeners by port to avoid duplicate port entries
      const portMap = new Map();
      for (const listener of parsedListeners) {
        if (!portMap.has(listener.port)) {
          const pid = listener.pid;
          const cwd = processCwds.get(pid) || null;
          const processName = listener.command || processNames.get(pid) || 'unknown';
          const command = processCommands.get(pid) || processName;
          const gitInfo = this.getGitInfo(cwd);

          portMap.set(listener.port, {
            port: listener.port,
            host: listener.host,
            pid: listener.pid,
            processName,
            command,
            cwd,
            git: gitInfo,
            isSelf: listener.port === Number(currentDashboardPort)
          });
        }
      }

      // 5. Probe ports in parallel for HTTP / latency / metadata
      const entries = Array.from(portMap.values());
      const probePromises = entries.map(async (entry) => {
        // Probe HTTP/TCP
        const probeHost = (entry.host === '*' || entry.host === '0.0.0.0' || entry.host === '::') ? '127.0.0.1' : entry.host;
        const probeResult = await probePort(entry.port, probeHost);
        
        // Read package info & generate stable fingerprint
        const packageInfo = this.getPackageInfo(entry.cwd);
        const fingerprint = this.generateFingerprint(entry, probeResult, packageInfo);

        // Check for local project icon on disk
        const localIconPath = this.findLocalIcon(entry.cwd);
        if (localIconPath) {
          this.localIcons.set(entry.port, localIconPath);
        } else {
          this.localIcons.delete(entry.port);
        }

        // Apply custom metadata from store (lookup by port and fingerprint)
        const customMeta = store.getCustomMeta(entry.port, fingerprint) || {};

        // Derived display name
        let displayName = customMeta.title || probeResult.title || null;
        if (!displayName) {
          if (packageInfo && packageInfo.name) {
            displayName = packageInfo.name;
          } else if (entry.cwd) {
            displayName = path.basename(entry.cwd);
          } else {
            displayName = `${entry.processName} (:${entry.port})`;
          }
        }

        // Category determination
        const category = customMeta.category || this.determineCategory(entry, probeResult);
        const framework = customMeta.framework || probeResult.framework || this.inferFrameworkFromCommand(entry.command);

        // Register/update in store registry to detect port changes and track history
        const portChangeInfo = store.registerOrUpdateApp({
          fingerprint,
          port: entry.port,
          title: displayName,
          category,
          framework,
          cwd: entry.cwd,
          favicon: probeResult.favicon
        });

        const isFavorite = store.isFavorite(fingerprint, entry.port);

        // Icon resolution hierarchy:
        // 1. User provided customIcon (emoji or image URL)
        // 2. Local icon from project disk (/api/app-icon/:port)
        // 3. Web-probed favicon
        let finalFavicon = probeResult.favicon;
        if (localIconPath) {
          finalFavicon = `/api/app-icon/${entry.port}`;
        }
        if (customMeta.customIcon && (customMeta.customIcon.startsWith('http') || customMeta.customIcon.startsWith('/') || customMeta.customIcon.startsWith('data:'))) {
          finalFavicon = customMeta.customIcon;
        }

        const proc = (entry.processName || '').toLowerCase();
        const isSystemProc = SYSTEM_PROCESSES.has(proc) || proc.includes('electron') || proc.includes('language_') || proc.includes('antigravi');
        const hasRepoCwd = Boolean(entry.cwd && !platform.isSystemPath(entry.cwd));
        const hasWebFramework = Boolean(probeResult.framework && !['unknown'].includes(probeResult.framework));

        // A real dev application is either an active web app, an active API, an AI model, has a project repo, is favorite, or is self/manual
        const isDevApp = Boolean(
          entry.isSelf ||
          entry.isManual ||
          isFavorite ||
          customMeta.title ||
          (
            !isSystemProc && (
              hasRepoCwd ||
              hasWebFramework ||
              (probeResult.isHttp && ['web', 'api', 'ai'].includes(category))
            )
          )
        );

        return {
          id: `port_${entry.port}`,
          port: entry.port,
          host: entry.host,
          pid: entry.pid,
          processName: entry.processName,
          command: entry.command,
          cwd: entry.cwd,
          cwdBasename: entry.cwd ? path.basename(entry.cwd) : null,
          git: entry.git,
          isSelf: entry.isSelf,
          isDevApp,
          
          // Identity & Port Change Tracking
          fingerprint,
          hasPortChanged: Boolean(portChangeInfo.hasPortChanged),
          previousPort: portChangeInfo.previousPort,
          portChangedText: portChangeInfo.hasPortChanged ? `Port shifted: :${portChangeInfo.previousPort} → :${entry.port}` : null,

          // Probing info
          isHttp: probeResult.isHttp,
          isOnline: probeResult.isOnline,
          isRawTcp: probeResult.isRawTcp || false,
          status: probeResult.status,
          statusText: probeResult.statusText,
          latencyMs: probeResult.latencyMs,
          title: displayName,
          rawTitle: probeResult.title,
          description: customMeta.notes || probeResult.description,
          rawDescription: probeResult.description,
          favicon: finalFavicon,
          customIcon: customMeta.customIcon || null,
          framework,
          headers: probeResult.headers,

          // Custom user overrides
          category,
          tags: customMeta.tags || [],
          notes: customMeta.notes || '',
          customUrl: customMeta.url || `http://localhost:${entry.port}`,
          isFavorite,
          hasCustomMeta: Object.keys(customMeta).length > 0,
          updatedAt: new Date().toISOString()
        };
      });

      const probedApps = await Promise.all(probePromises);

      // 6. Include Manual Apps from store
      const manualApps = store.getManualApps().map(m => ({
        id: m.id,
        port: m.port,
        fingerprint: `manual:${m.id}`,
        hasPortChanged: false,
        previousPort: null,
        portChangedText: null,
        host: '127.0.0.1',
        pid: null,
        processName: 'Manual Entry',
        command: m.notes || 'User defined service',
        cwd: null,
        cwdBasename: null,
        git: null,
        isSelf: false,
        isManual: true,
        isDevApp: true,
        isHttp: true,
        isOnline: true,
        isRawTcp: false,
        status: 200,
        statusText: 'Configured',
        latencyMs: 0,
        title: m.name,
        rawTitle: m.name,
        description: m.notes,
        rawDescription: m.notes,
        favicon: m.customIcon || null,
        customIcon: m.customIcon || null,
        framework: m.framework,
        category: m.category || 'web',
        tags: m.tags || [],
        notes: m.notes || '',
        customUrl: m.url || `http://localhost:${m.port}`,
        isFavorite: store.isFavorite(`manual:${m.id}`, m.port),
        hasCustomMeta: true,
        updatedAt: m.createdAt
      }));

      // Combine and sort: Hub first, then favorites, then dev apps, then port ascending
      const allApps = [...probedApps, ...manualApps].sort((a, b) => {
        if (a.isSelf && !b.isSelf) return -1;
        if (!a.isSelf && b.isSelf) return 1;
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        if (a.isDevApp && !b.isDevApp) return -1;
        if (!a.isDevApp && b.isDevApp) return 1;
        return a.port - b.port;
      });

      this.cachedApps = allApps;
      this.lastScanTime = new Date().toISOString();
      return allApps;
    } catch (err) {
      console.error('[Scanner] Scan error:', err);
      return this.cachedApps;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Safely reads git repo and branch info by checking directory files
   */
  getGitInfo(cwd) {
    if (!cwd) return null;

    try {
      const gitDir = path.join(cwd, '.git');
      if (!fs.existsSync(gitDir)) return null;

      let branch = null;
      let headFile = '';

      const stat = fs.statSync(gitDir);
      if (stat.isDirectory()) {
        const headPath = path.join(gitDir, 'HEAD');
        if (fs.existsSync(headPath)) {
          headFile = fs.readFileSync(headPath, 'utf8').trim();
        }
      } else if (stat.isFile()) {
        // Submodule or worktree
        const content = fs.readFileSync(gitDir, 'utf8').trim();
        const gitDirRef = content.replace(/^gitdir:\s*/, '');
        const realHead = path.resolve(cwd, gitDirRef, 'HEAD');
        if (fs.existsSync(realHead)) {
          headFile = fs.readFileSync(realHead, 'utf8').trim();
        }
      }

      if (headFile.startsWith('ref: refs/heads/')) {
        branch = headFile.replace('ref: refs/heads/', '');
      } else if (headFile.length >= 7) {
        branch = headFile.substring(0, 7); // detached commit sha
      }

      return {
        repoName: path.basename(cwd),
        branch: branch || 'detached'
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Reads package.json in working directory if available
   */
  getPackageInfo(cwd) {
    if (!cwd) return null;
    try {
      const p = path.join(cwd, 'package.json');
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          name: parsed.name || null,
          description: parsed.description || null
        };
      }
    } catch (_) {}
    return null;
  }

  /**
   * Looks for local icon or logo files on disk in the project directory
   */
  findLocalIcon(cwd) {
    if (!cwd) return null;
    const candidates = [
      path.join(cwd, 'public', 'favicon.svg'),
      path.join(cwd, 'public', 'favicon.png'),
      path.join(cwd, 'public', 'favicon.ico'),
      path.join(cwd, 'public', 'vite.svg'),
      path.join(cwd, 'public', 'logo.svg'),
      path.join(cwd, 'public', 'logo.png'),
      path.join(cwd, 'client', 'public', 'favicon.svg'),
      path.join(cwd, 'client', 'public', 'favicon.png'),
      path.join(cwd, 'static', 'favicon.png'),
      path.join(cwd, 'static', 'favicon.ico'),
      path.join(cwd, 'app', 'favicon.ico'),
      path.join(cwd, 'src', 'favicon.ico'),
      path.join(cwd, 'favicon.png'),
      path.join(cwd, 'favicon.ico')
    ];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        return file;
      }
    }

    try {
      const pubDir = path.join(cwd, 'public');
      if (fs.existsSync(pubDir)) {
        const files = fs.readdirSync(pubDir);
        for (const f of files) {
          if (/logo.*\.(png|svg|webp|ico)$/i.test(f)) {
            return path.join(pubDir, f);
          }
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Computes a stable fingerprint to identify an app across port changes
   */
  generateFingerprint(entry, probeResult, packageInfo) {
    // 1. Project package identity
    if (packageInfo && packageInfo.name) {
      return `pkg:${packageInfo.name}`;
    }

    // 2. Project directory on disk (if real repo/codebase, not root, home or OS/app install dir)
    const resolvedCwd = entry.cwd ? path.resolve(entry.cwd) : '';
    const isGenericDir = !resolvedCwd || platform.isSystemPath(resolvedCwd);

    if (!isGenericDir) {
      // Normalize case on Windows so C:\Work and c:\work share a fingerprint
      return `cwd:${platform.IS_WIN ? resolvedCwd.toLowerCase() : resolvedCwd}`;
    }

    // 3. Webpage title if meaningful
    const title = (probeResult?.title || '').trim();
    const generic = new Set([
      'vite app', 'react app', 'document', 'index', 'home', 
      'untitled', 'swagger ui', 'fastapi - swagger ui', 'bad request', 'not found', 'error'
    ]);
    if (title && !generic.has(title.toLowerCase())) {
      return `web:${title.toLowerCase()}`;
    }

    // 4. Command identity
    if (entry.command) {
      const cleanCmd = entry.command
        .replace(/--port[=\s]\d+/g, '')
        .replace(/-p\s+\d+/g, '')
        .replace(/PORT=\d+/g, '')
        .trim();
      if (cleanCmd.length > 5 && !cleanCmd.includes('/Applications/')) {
        return `cmd:${cleanCmd.slice(0, 80)}`;
      }
    }

    // 5. Port fallback
    return `port:${entry.port}`;
  }

  /**
   * Infer framework from process command
   */
  inferFrameworkFromCommand(command) {
    if (!command) return null;
    const cmd = command.toLowerCase();

    if (cmd.includes('vite')) return 'Vite';
    if (cmd.includes('next')) return 'Next.js';
    if (cmd.includes('react-scripts')) return 'Create React App';
    if (cmd.includes('astro')) return 'Astro';
    if (cmd.includes('nuxt')) return 'Nuxt';
    if (cmd.includes('svelte')) return 'SvelteKit';
    if (cmd.includes('uvicorn') || cmd.includes('fastapi')) return 'FastAPI';
    if (cmd.includes('flask')) return 'Flask';
    if (cmd.includes('django')) return 'Django';
    if (cmd.includes('streamlit')) return 'Streamlit';
    if (cmd.includes('ollama')) return 'Ollama';
    if (cmd.includes('jupyter')) return 'Jupyter';
    if (cmd.includes('docker')) return 'Docker';
    if (cmd.includes('node') && cmd.includes('server')) return 'Node Server';
    if (cmd.includes('python')) return 'Python Script';

    return null;
  }

  /**
   * Categorize application based on process name, port, framework and probe
   */
  determineCategory(entry, probe) {
    const cmd = (entry.command || '').toLowerCase();
    const proc = (entry.processName || '').toLowerCase();
    const port = entry.port;

    // AI & Local LLMs
    if (
      port === 11434 ||
      proc.includes('ollama') ||
      cmd.includes('ollama') ||
      cmd.includes('langchain') ||
      cmd.includes('transformers') ||
      cmd.includes('torch') ||
      (probe.title && probe.title.toLowerCase().includes('ollama'))
    ) {
      return 'ai';
    }

    // Databases
    if (
      [5432, 6379, 27017, 3306, 9200, 5672, 8529, 7474].includes(port) ||
      proc.includes('postgres') ||
      proc.includes('redis') ||
      proc.includes('mongod') ||
      proc.includes('mysqld')
    ) {
      return 'db';
    }

    // Web App (Vite, Next, React, static server, port 3000, 5173, etc.)
    if (
      probe.framework === 'Vite' ||
      probe.framework === 'Next.js' ||
      probe.framework === 'React' ||
      probe.framework === 'Astro' ||
      probe.framework === 'Vue' ||
      probe.framework === 'Svelte' ||
      cmd.includes('vite') ||
      cmd.includes('next') ||
      cmd.includes('webpack') ||
      (port >= 3000 && port <= 3999 && probe.isHttp && probe.status === 200) ||
      (port >= 5170 && port <= 5190 && probe.isHttp)
    ) {
      return 'web';
    }

    // API / Backend (FastAPI, Flask, Express, Django, etc.)
    if (
      probe.framework === 'FastAPI' ||
      probe.framework === 'Express' ||
      probe.framework === 'Flask' ||
      probe.framework === 'Django' ||
      cmd.includes('uvicorn') ||
      cmd.includes('gunicorn') ||
      cmd.includes('flask') ||
      cmd.includes('django') ||
      (port >= 8000 && port <= 8999 && probe.isHttp)
    ) {
      return 'api';
    }

    // System / Background / Desktop Apps
    if (SYSTEM_PROCESSES.has(proc) || proc.includes('electron') || proc.includes('language_')) {
      return 'system';
    }

    // Default heuristics based on HTTP status
    if (probe.isHttp && probe.status) {
      return 'web';
    }

    return 'tools';
  }
}

module.exports = new Scanner();
