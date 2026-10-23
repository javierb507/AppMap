const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const scanner = require('./lib/scanner');
const store = require('./lib/store');
const actions = require('./lib/actions');
const platform = require('./lib/platform');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected SSE clients for real-time live events
const sseClients = new Set();

function broadcastSse(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    port: PORT,
    platform: platform.PLATFORM,
    fileManager: platform.fileManagerName()
  });
});

// Get all applications & current scan
app.get('/api/apps', async (req, res) => {
  try {
    const apps = await scanner.scan(PORT);
    res.json({
      success: true,
      port: PORT,
      timestamp: scanner.lastScanTime,
      count: apps.length,
      apps
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force immediate rescan
app.post('/api/scan', async (req, res) => {
  try {
    const apps = await scanner.scan(PORT);
    broadcastSse('apps_updated', { apps, count: apps.length, timestamp: scanner.lastScanTime });
    res.json({
      success: true,
      timestamp: scanner.lastScanTime,
      count: apps.length,
      apps
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save custom metadata for an app/port
app.post('/api/apps/:port/meta', (req, res) => {
  try {
    const port = req.params.port;
    const { title, category, tags, notes, url, framework, customIcon, fingerprint } = req.body;
    const updated = store.setCustomMeta(port, {
      title,
      category,
      tags,
      notes,
      url,
      framework,
      customIcon
    }, fingerprint);

    // Notify clients
    broadcastSse('meta_changed', { port, fingerprint, meta: updated });

    res.json({ success: true, meta: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear custom metadata
app.delete('/api/apps/:port/meta', (req, res) => {
  try {
    const port = req.params.port;
    const { fingerprint } = req.query || {};
    store.deleteCustomMeta(port, fingerprint);
    broadcastSse('meta_changed', { port, fingerprint, meta: null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle favorite (supports fingerprint or port)
app.post('/api/apps/:port/favorite', (req, res) => {
  try {
    const port = req.params.port;
    const { fingerprint } = req.body || {};
    const isFav = store.toggleFavorite(fingerprint || port, port);
    broadcastSse('favorite_toggled', { port: Number(port), fingerprint, isFavorite: isFav });
    res.json({ success: true, isFavorite: isFav, port: Number(port), fingerprint });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add manual app entry
app.post('/api/apps/manual', (req, res) => {
  try {
    const { port, name, url, category, framework, notes, tags } = req.body;
    if (!port && !url) {
      return res.status(400).json({ success: false, error: 'Port or URL is required' });
    }

    const entry = store.addManualApp({
      port: Number(port) || 0,
      name,
      url,
      category,
      framework,
      notes,
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : [])
    });

    broadcastSse('manual_added', entry);
    res.json({ success: true, app: entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove manual app entry
app.delete('/api/apps/manual/:id', (req, res) => {
  try {
    const id = req.params.id;
    store.removeManualApp(id);
    broadcastSse('manual_removed', { id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Kill process
app.post('/api/actions/kill', async (req, res) => {
  try {
    const { pid, signal } = req.body;
    if (!pid) return res.status(400).json({ success: false, error: 'PID is required' });

    const result = await actions.killProcess(pid, signal || 'SIGTERM');
    
    // Trigger immediate rescan after short delay to let process terminate
    setTimeout(async () => {
      const apps = await scanner.scan(PORT);
      broadcastSse('apps_updated', { apps, count: apps.length, timestamp: scanner.lastScanTime });
    }, 600);

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open URL in default browser
app.post('/api/actions/open-url', async (req, res) => {
  try {
    const { url } = req.body;
    const result = await actions.openUrl(url);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open folder in the OS file manager, terminal or IDE
app.post('/api/actions/open-folder', async (req, res) => {
  try {
    const { path: folderPath, app: targetApp } = req.body;
    const result = await actions.openFolder(folderPath, targetApp || 'FileManager');
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve local project icons discovered on disk by scanner
app.get('/api/app-icon/:port', (req, res) => {
  try {
    const port = parseInt(req.params.port, 10);
    const iconPath = scanner.getLocalIcon(port);
    if (!iconPath || !fs.existsSync(iconPath)) {
      return res.status(404).send('Icon not found');
    }
    const ext = path.extname(iconPath).toLowerCase();
    const mimeTypes = {
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=600');
    fs.createReadStream(iconPath).pipe(res);
  } catch (_) {
    res.status(500).send('Error');
  }
});

// Proxy favicon to bypass CORS / SSL issues on localhost dev ports
app.get('/api/favicon-proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  if (targetUrl.startsWith('data:')) {
    return res.redirect(targetUrl);
  }
  if (!targetUrl.startsWith('http://localhost') && !targetUrl.startsWith('http://127.0.0.1')) {
    return res.status(400).send('Invalid url parameter');
  }

  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    let finished = false;

    const proxyReq = client.get(targetUrl, { timeout: 1500 }, (remoteRes) => {
      if (finished || res.headersSent) return;
      finished = true;
      if (remoteRes.statusCode === 200) {
        res.set('Content-Type', remoteRes.headers['content-type'] || 'image/x-icon');
        res.set('Cache-Control', 'public, max-age=300');
        remoteRes.pipe(res);
      } else {
        res.status(404).send('Not found');
      }
    });

    proxyReq.on('error', () => {
      if (finished || res.headersSent) return;
      finished = true;
      res.status(404).send('Failed to fetch favicon');
    });

    proxyReq.on('timeout', () => {
      if (finished || res.headersSent) return;
      finished = true;
      proxyReq.destroy();
      res.status(408).send('Timeout');
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).send('Error');
    }
  }
});

// SSE endpoint for live reactive updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ port: PORT, time: Date.now() })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Background periodic scanner (every 4 seconds)
let previousPortsSignature = '';
setInterval(async () => {
  try {
    const apps = await scanner.scan(PORT);
    const signature = apps.map(a => `${a.port}:${a.pid}:${a.isOnline}:${a.isFavorite}:${a.fingerprint}:${a.hasPortChanged}:${a.customIcon || ''}`).join('|');
    if (signature !== previousPortsSignature) {
      previousPortsSignature = signature;
      broadcastSse('apps_updated', {
        apps,
        count: apps.length,
        timestamp: scanner.lastScanTime
      });
    }
  } catch (err) {
    console.error('[Background Scanner Error]:', err.message);
  }
}, 4000);

// Fallback to index.html for SPA (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================================`);
  console.log(`  🚀 AppMap Localhost Hub running on http://localhost:${PORT}`);
  console.log(`  📡 Platform: ${platform.PLATFORM} • dashboard ready on port ${PORT}`);
  console.log(`========================================================\n`);
});
