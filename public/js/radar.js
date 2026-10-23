/**
 * AppMap: Interactive Orbital Radar Galaxy
 * Renders an animated canvas with localhost at the center, concentric orbital rings,
 * rotating sweep beam, and interactive application nodes with hover/click effects.
 * Supports light & dark themes, node pinning, and direct 1-click app launching.
 */

class RadarGalaxy {
  constructor(canvasId, tooltipId) {
    this.canvas = document.getElementById(canvasId);
    this.tooltip = document.getElementById(tooltipId);
    this.ctx = this.canvas.getContext('2d');
    
    this.apps = [];
    this.nodes = [];
    this.hoveredNode = null;
    this.pinnedNode = null;
    this.isMouseInTooltip = false;
    this.sweepAngle = 0;
    this.isSweepActive = true;
    this.animId = null;

    // Center and scaling
    this.centerX = 0;
    this.centerY = 0;
    this.dpr = window.devicePixelRatio || 1;

    // Ring radii config
    this.rings = [
      { id: 'web', min: 3000, max: 5999, r: 120, label: '3000-5999: Web Devs', color: '#00f2fe' },
      { id: 'api', min: 6000, max: 8999, r: 195, label: '6000-8999: APIs & Backends', color: '#9d4edd' },
      { id: 'ai', min: 9000, max: 15000, r: 265, label: '9000-15000: AI & DBs', color: '#10b981' },
      { id: 'sys', min: 15001, max: 65535, r: 330, label: '>15000: System & High', color: '#64748b' }
    ];

    this.init();
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Tooltip hover persistence
    if (this.tooltip) {
      this.tooltip.addEventListener('mouseenter', () => {
        this.isMouseInTooltip = true;
      });
      this.tooltip.addEventListener('mouseleave', () => {
        this.isMouseInTooltip = false;
        if (!this.pinnedNode && !this.hoveredNode) {
          this.hideTooltip();
        }
      });
    }

    // Mouse interactions on Canvas
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('dblclick', (e) => this.handleDblClick(e));

    // Controls
    const resetBtn = document.getElementById('radarResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.unpin();
        this.resize();
        window.ui?.showToast('Radar view centered', 'info');
      });
    }

    const animToggle = document.getElementById('radarAnimationToggle');
    if (animToggle) {
      animToggle.addEventListener('click', () => {
        this.isSweepActive = !this.isSweepActive;
        animToggle.classList.toggle('active', this.isSweepActive);
        animToggle.textContent = this.isSweepActive ? '🌀 Sweep: ON' : '⏸️ Sweep: OFF';
      });
    }

    this.startLoop();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 680;

    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.ctx.scale(this.dpr, this.dpr);

    this.width = w;
    this.height = h;
    this.centerX = w / 2;
    this.centerY = h / 2;

    // Scale ring radii proportionally if window is small
    const scaleFactor = Math.min(1, Math.min(w / 800, h / 700));
    this.rings[0].r = 115 * scaleFactor;
    this.rings[1].r = 185 * scaleFactor;
    this.rings[2].r = 250 * scaleFactor;
    this.rings[3].r = 315 * scaleFactor;

    this.layoutNodes();
  }

  setApps(apps) {
    this.apps = apps || [];
    this.layoutNodes();
  }

  layoutNodes() {
    this.nodes = [];
    if (!this.apps.length) return;

    // Group apps by ring
    const ringBuckets = { 0: [], 1: [], 2: [], 3: [] };

    for (const app of this.apps) {
      // Don't place self at orbit, self is center
      if (app.isSelf) continue;

      const p = app.port;
      let ringIndex = 3; // default outer
      if (p >= 3000 && p <= 5999) ringIndex = 0;
      else if (p >= 6000 && p <= 8999) ringIndex = 1;
      else if (p >= 9000 && p <= 15000) ringIndex = 2;
      
      ringBuckets[ringIndex].push(app);
    }

    // Distribute angles evenly along each ring
    for (let rIdx = 0; rIdx < 4; rIdx++) {
      const items = ringBuckets[rIdx];
      const radius = this.rings[rIdx].r;
      const count = items.length;
      if (count === 0) continue;

      const angleStep = (Math.PI * 2) / count;
      const offset = (rIdx * 0.45);

      items.forEach((app, i) => {
        const angle = offset + (i * angleStep);
        const x = this.centerX + Math.cos(angle) * radius;
        const y = this.centerY + Math.sin(angle) * radius;

        this.nodes.push({
          app,
          x,
          y,
          radius: app.isHttp && app.status === 200 ? 15 : 12,
          color: this.getNodeColor(app),
          ringIndex: rIdx,
          angle
        });
      });
    }

    // If previously pinned node is still here, re-link it
    if (this.pinnedNode) {
      const found = this.nodes.find(n => n.app.port === this.pinnedNode.app.port);
      if (found) {
        this.pinnedNode = found;
        this.showTooltip(found, true);
      } else {
        this.unpin();
      }
    }
  }

  getNodeColor(app) {
    if (app.category === 'web') return '#00f2fe';
    if (app.category === 'api') return '#9d4edd';
    if (app.category === 'ai') return '#10b981';
    if (app.category === 'db') return '#f59e0b';
    return '#64748b';
  }

  startLoop() {
    const loop = () => {
      this.draw();
      if (this.isSweepActive) {
        this.sweepAngle += 0.015;
        if (this.sweepAngle > Math.PI * 2) this.sweepAngle -= Math.PI * 2;
      }
      this.animId = requestAnimationFrame(loop);
    };
    loop();
  }

  draw() {
    const ctx = this.ctx;
    const isLight = document.body.classList.contains('light-theme');
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Rings & Crosshairs
    this.drawBackgroundRings(isLight);

    // 2. Radar Sweep Beam
    if (this.isSweepActive) {
      this.drawSweepBeam(isLight);
    }

    // 3. Laser Beam to Active/Hovered/Pinned Node
    const activeTarget = this.pinnedNode || this.hoveredNode;
    if (activeTarget) {
      this.drawLaserBeam(activeTarget, isLight);
    }

    // 4. Center Localhost Hub
    this.drawCenterHub(isLight);

    // 5. App Nodes
    this.drawNodes(isLight);
  }

  drawBackgroundRings(isLight) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;

    // Crosshairs
    ctx.beginPath();
    ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.moveTo(cx - 360, cy);
    ctx.lineTo(cx + 360, cy);
    ctx.moveTo(cx, cy - 360);
    ctx.lineTo(cx, cy + 360);
    ctx.stroke();

    // Concentric Rings
    for (const ring of this.rings) {
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.strokeStyle = isLight ? (ring.color + '44') : (ring.color + '22');
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ring Label along upper arc
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = isLight ? '#475569' : (ring.color + '88');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(ring.label, cx, cy - ring.r - 5);
    }
  }

  drawSweepBeam(isLight) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;
    const maxR = this.rings[3].r + 20;

    ctx.save();
    ctx.translate(cx, cy);

    // Gradient Arc Sector
    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, maxR);
    if (isLight) {
      grad.addColorStop(0, 'rgba(2, 132, 199, 0.16)');
      grad.addColorStop(0.7, 'rgba(2, 132, 199, 0.04)');
      grad.addColorStop(1, 'rgba(2, 132, 199, 0)');
    } else {
      grad.addColorStop(0, 'rgba(0, 242, 254, 0.22)');
      grad.addColorStop(0.7, 'rgba(0, 242, 254, 0.05)');
      grad.addColorStop(1, 'rgba(0, 242, 254, 0)');
    }

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, maxR, this.sweepAngle - 0.4, this.sweepAngle, false);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Leading radar beam
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(this.sweepAngle) * maxR, Math.sin(this.sweepAngle) * maxR);
    ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.7)' : 'rgba(0, 242, 254, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = isLight ? '#0284c7' : '#00f2fe';
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.restore();
  }

  drawLaserBeam(node, isLight) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.centerX, this.centerY);
    ctx.lineTo(node.x, node.y);
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = node.color;
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Pulsing packet traveling along the beam
    const time = Date.now() / 400;
    const progress = (time % 1);
    const px = this.centerX + (node.x - this.centerX) * progress;
    const py = this.centerY + (node.y - this.centerY) * progress;

    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isLight ? '#0284c7' : '#ffffff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.fill();

    ctx.restore();
  }

  drawCenterHub(isLight) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;

    ctx.save();
    // Center glowing halo
    const halo = ctx.createRadialGradient(cx, cy, 5, cx, cy, 38);
    halo.addColorStop(0, isLight ? 'rgba(2, 132, 199, 0.25)' : 'rgba(0, 242, 254, 0.4)');
    halo.addColorStop(1, 'rgba(0, 242, 254, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    // Center Core
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = isLight ? '#ffffff' : '#080d1a';
    ctx.strokeStyle = isLight ? '#0284c7' : '#00f2fe';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = isLight ? '#0284c7' : '#00f2fe';
    ctx.shadowBlur = isLight ? 8 : 14;
    ctx.stroke();
    ctx.fill();

    // Hub Icon / Text
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText('10000', cx, cy - 2);

    ctx.font = 'bold 7px sans-serif';
    ctx.fillStyle = isLight ? '#0284c7' : '#00f2fe';
    ctx.fillText('HUB', cx, cy + 7);

    ctx.restore();
  }

  drawNodes(isLight) {
    const ctx = this.ctx;

    for (const node of this.nodes) {
      const isHovered = this.hoveredNode === node;
      const isPinned = this.pinnedNode === node;
      const app = node.app;

      ctx.save();

      // Active Pulse Ring for responsive HTTP 200 apps
      if (app.isHttp && app.status === 200) {
        const pulse = (Date.now() / 1000 + node.angle) % 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + (pulse * 8), 0, Math.PI * 2);
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = Math.max(0, 1 - pulse / 2) * 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Pinned halo ring
      if (isPinned) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 10;
        ctx.stroke();
      }

      // Favorite Golden Halo
      if (app.isFavorite) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 6;
        ctx.stroke();
      }

      // Port Shift Amber Indicator
      if (app.hasPortChanged && app.previousPort) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Main Node Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, (isHovered || isPinned) ? node.radius + 3 : node.radius, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? '#ffffff' : ((isHovered || isPinned) ? '#1a233a' : '#0b101d');
      ctx.strokeStyle = node.color;
      ctx.lineWidth = (isHovered || isPinned) ? 3 : 2;
      ctx.shadowColor = node.color;
      ctx.shadowBlur = (isHovered || isPinned) ? 16 : 8;
      ctx.fill();
      ctx.stroke();

      // Star badge mark on node
      if (app.isFavorite) {
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#facc15';
        ctx.fillText('★', node.x + node.radius - 2, node.y - node.radius + 2);
      }

      // Node Label (Port Number)
      ctx.shadowBlur = 0;
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const portStr = String(app.port);
      ctx.fillText(portStr.length > 4 ? portStr.slice(-4) : portStr, node.x, node.y);

      // App Title below node
      if (isHovered || isPinned || node.ringIndex <= 1) {
        const iconPrefix = app.customIcon ? `${app.customIcon} ` : (app.hasPortChanged ? '🔄 ' : '');
        ctx.font = '10px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = isLight ? '#0f172a' : ((isHovered || isPinned) ? '#ffffff' : 'rgba(255, 255, 255, 0.7)');
        ctx.fillText(iconPrefix + this.truncate(app.title, 14), node.x, node.y + node.radius + 12);
      }

      ctx.restore();
    }
  }

  handleMouseMove(e) {
    if (this.isMouseInTooltip) return;

    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let hit = null;
    for (const node of this.nodes) {
      const dist = Math.hypot(node.x - mx, node.y - my);
      if (dist <= node.radius + 8) {
        hit = node;
        break;
      }
    }

    if (hit !== this.hoveredNode) {
      this.hoveredNode = hit;
      if (hit) {
        this.canvas.style.cursor = 'pointer';
        // If not pinned, show preview
        if (!this.pinnedNode) {
          this.showTooltip(hit, false);
        }
      } else {
        this.canvas.style.cursor = 'crosshair';
        if (!this.pinnedNode && !this.isMouseInTooltip) {
          this.hideTooltip();
        }
      }
    }
  }

  handleMouseLeave() {
    this.hoveredNode = null;
    if (!this.pinnedNode && !this.isMouseInTooltip) {
      this.hideTooltip();
    }
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check hit on nodes
    let hit = null;
    for (const node of this.nodes) {
      const dist = Math.hypot(node.x - mx, node.y - my);
      if (dist <= node.radius + 8) {
        hit = node;
        break;
      }
    }

    if (hit) {
      // Pin this node and show interactive action card
      this.pinnedNode = hit;
      this.showTooltip(hit, true);
    } else {
      // Check center hub hit
      const centerDist = Math.hypot(mx - this.centerX, my - this.centerY);
      if (centerDist <= 24) {
        const hubApp = this.apps.find(a => a.isSelf);
        if (hubApp) {
          this.pinnedNode = { app: hubApp, x: this.centerX, y: this.centerY };
          this.showTooltip(this.pinnedNode, true);
          return;
        }
      }

      // Clicked outside: unpin
      this.unpin();
    }
  }

  handleDblClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const node of this.nodes) {
      const dist = Math.hypot(node.x - mx, node.y - my);
      if (dist <= node.radius + 8) {
        this.openAppUrl(node.app);
        break;
      }
    }
  }

  showTooltip(node, isPinned = false) {
    const app = node.app;
    const targetUrl = app.customUrl || `http://localhost:${app.port}`;

    this.tooltip.style.left = `${node.x}px`;
    this.tooltip.style.top = `${node.y - 12}px`;
    this.tooltip.classList.remove('hidden');
    this.tooltip.classList.toggle('pinned', isPinned);

    const statusClass = app.isHttp ? (app.status === 200 ? 'online-200' : 'online-warn') : (app.isRawTcp ? 'raw-tcp' : 'offline');
    const statusText = app.isHttp ? `${app.status} ${app.statusText || 'OK'}` : (app.statusText || 'TCP Service');

    const portShiftHtml = (app.hasPortChanged && app.previousPort) ? `
      <span class="port-shift-badge" title="${this.escapeHtml(app.portChangedText || '')}">
        🔄 :${app.previousPort} → :${app.port}
      </span>
    ` : '';

    let iconHtml = '';
    if (app.customIcon) {
      if (app.customIcon.startsWith('http') || app.customIcon.startsWith('/') || app.customIcon.startsWith('data:')) {
        iconHtml = `<img src="${app.customIcon}" style="width:20px; height:20px; object-fit:contain; vertical-align:middle; margin-right:6px;" alt="">`;
      } else {
        iconHtml = `<span style="font-size:1.2rem; margin-right:6px; vertical-align:middle;">${this.escapeHtml(app.customIcon)}</span>`;
      }
    } else if (app.favicon) {
      const src = (app.favicon.startsWith('data:') || app.favicon.startsWith('/api/app-icon/')) 
        ? app.favicon 
        : `/api/favicon-proxy?url=${encodeURIComponent(app.favicon)}`;
      iconHtml = `<img src="${src}" style="width:20px; height:20px; object-fit:contain; vertical-align:middle; margin-right:6px;" onerror="this.style.display='none';" alt="">`;
    }

    this.tooltip.innerHTML = `
      <div class="tooltip-header">
        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
          <span class="tooltip-port-badge">:${app.port}</span>
          <span class="status-badge ${statusClass}">
            <span class="status-dot"></span>
            <span>${statusText}</span>
          </span>
          ${portShiftHtml}
        </div>
        ${isPinned ? `<button class="tooltip-close-btn" onclick="window.radar.unpin(); event.stopPropagation();" title="Close">&times;</button>` : ''}
      </div>

      <div class="tooltip-title">
        ${iconHtml}<span>${this.escapeHtml(app.title)}</span>
      </div>

      <div class="tooltip-meta-row">
        <span class="tooltip-framework-pill">${app.framework || app.processName || 'Process'}</span>
        <span class="tooltip-latency">${app.latencyMs ? `⚡ ${app.latencyMs}ms` : ''}</span>
        ${app.pid ? `<span>PID: ${app.pid}</span>` : ''}
      </div>

      ${app.cwd ? `<div class="tooltip-cwd" title="${app.cwd}">📂 ${this.escapeHtml(app.cwd)}</div>` : ''}

      <!-- Direct Prominent Open Button -->
      <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="tooltip-open-big" onclick="window.radar.openAppUrl(window.appState.getAppByPort(${app.port})); event.stopPropagation();">
        <span>🚀 Open in Browser</span>
        <span>↗</span>
      </a>

      <!-- Quick Action Secondary Buttons -->
      <div class="tooltip-actions" style="margin-top: 0.5rem;">
        <button class="tooltip-btn tooltip-btn-secondary" onclick="window.modal.openEditModal(window.appState.getAppByPort(${app.port})); event.stopPropagation();">
          ✏️ Inspect / Edit
        </button>
        <button class="tooltip-btn tooltip-btn-secondary ${app.isFavorite ? 'active' : ''}" onclick="window.appState.toggleFavorite(${app.port}, '${this.escapeHtml(app.fingerprint || '')}'); event.stopPropagation();" title="${app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
          ${app.isFavorite ? '★ Starred' : '☆ Star'}
        </button>
      </div>
    `;
  }

  openAppUrl(app) {
    if (!app) return;
    const targetUrl = app.customUrl || `http://localhost:${app.port}`;
    
    // Open directly in browser tab
    window.open(targetUrl, '_blank');

    // Also trigger system open via backend
    fetch('/api/actions/open-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl })
    }).catch(() => {});

    window.ui?.showToast(`Opening ${app.title} (:${app.port})`, 'success');
  }

  unpin() {
    this.pinnedNode = null;
    this.hideTooltip();
  }

  hideTooltip() {
    this.tooltip.classList.add('hidden');
    this.tooltip.classList.remove('pinned');
  }

  truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
}

window.RadarGalaxy = RadarGalaxy;
