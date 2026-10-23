# 🌐 AppMap • Localhost Command Center & Port Radar

> **The ultimate visual localhost dashboard for vibe coding.** Never wonder which dev server is running on what port again.

Running automatically on fixed port **`http://localhost:10000`** (override with `PORT=xxxx`).

Works on **macOS**, **Linux** and **Windows** — zero native dependencies, only Node.js ≥ 18 and Express.

---

## ✨ Features

- 📡 **Automated Localhost Port Discovery**:
  - Automatically discovers all listening TCP ports on macOS, Linux and Windows (see [Platform support](#-platform-support)).
  - Identifies Process Name, Process ID (PID), command-line arguments, and working directory (`cwd`).
  - Detects Git repository folder name and active Git branch (e.g. `main`, `develop`).
  - Probes HTTP services for status code (`200 OK`, `307`, `404`), HTML `<title>`, `<meta description>`, latency (`ms`), and favicon.
  - Automatically identifies frameworks: **Vite**, **Next.js**, **React**, **FastAPI / Uvicorn**, **Flask**, **Django**, **Ollama**, **Svelte**, **Astro**, **Vue**, **Angular**, **Express**, **Docker**, etc.
  - Categorizes servers into:
    - ⚡ **Web Apps** (Vite, Next.js, React dev servers)
    - 🚀 **APIs & Backends** (FastAPI, Flask, Express, Uvicorn)
    - 🦙 **AI & Local LLMs** (Ollama, PyTorch, LangChain)
    - 💾 **Databases & Caches** (PostgreSQL, Redis, MongoDB)
    - 🖥️ **System & Desktop Services**

- 🌌 **Three Interactive Views**:
  1. **Radar Galaxy Map**:
     - Visual orbital canvas centered at `Localhost:10000`.
     - 4 concentric orbital rings categorized by port range (Web Devs, APIs, AI/DB, System).
     - Live rotating sweep beam, pulsating status halos, and laser targeting beams.
     - Hover over any node to reveal instant preview card; click to inspect or launch.
  2. **Developer Cards Grid**:
     - Modern glassmorphic cards with responsive latency badges and status chips.
     - 1-click copy for `http://localhost:<port>` and working directory path.
     - Direct button to open folder in **Finder / Explorer / your Linux file manager**.
     - Launch button to open application in browser with one click.
  3. **Matrix Inspector Table**:
     - Dense tabular view with sortable columns (Port, Status, Name, Framework, Latency, PID, Working Directory, Git Branch, Category).
     - Quick inline action buttons.

- ✏️ **Custom User Metadata & Notes**:
  - Rename any detected app with a custom display name / nickname.
  - Assign custom categories and tags (e.g. `#client-demo`, `#prototype`, `#vibe-session`).
  - Add developer notes and test credentials (e.g. `admin / test1234`).
  - Star / Pin favorite applications.
  - Add manual ports (for Docker containers, ngrok / cloudflare tunnels, WSL, or external dev servers).
  - All annotations persist in `app-map-data.json`.

- ⚡ **Live Real-time SSE Sync**:
  - Live Server-Sent Events (`/api/events`) connection updates the radar in real time whenever a server starts or stops in terminal.
  - Toast alerts notify when a new dev server appears on localhost.

- 🔄 **Port-Shift Detection**:
  - Apps are fingerprinted by `package.json` name → project folder → page `<title>` → command line.
  - When a dev server hops ports (e.g. Vite `5173 → 5174`), nickname, notes, icon and favorite follow it, and the UI flags the shift.

- 🎨 **App Icons**:
  - Auto-detected from the page (`<link rel="icon">`, data URIs) or from the project folder (`public/favicon.svg`, `logo.png`, …).
  - Override with any emoji or image URL from the Edit dialog.

- 🛡️ **Safe Process Termination**:
  - Kill hung or runaway dev servers directly from the UI with modal confirmation.
  - Choice between graceful `SIGTERM` and immediate force kill `SIGKILL` (`taskkill /T` and `taskkill /T /F` on Windows).
  - Safeguards protect the AppMap hub itself from accidental termination.

---

## 🚀 Quick Start

```bash
git clone https://github.com/javierb507/AppMap.git
cd AppMap
npm install
npm start          # or: npm run dev (auto-restart on changes)
```

Open your browser at:
👉 **[http://localhost:10000](http://localhost:10000)**

Use another port with `PORT=12000 npm start` (macOS/Linux) or `$env:PORT=12000; npm start` (PowerShell).

---

## 💻 Platform Support

All OS-specific logic lives in [`lib/platform.js`](lib/platform.js). Each step degrades gracefully if a tool is missing.

| Capability | macOS | Linux | Windows |
|---|---|---|---|
| Listening ports | `lsof -iTCP -sTCP:LISTEN` | `ss -ltnp` (fallback `lsof`) | `Get-NetTCPConnection` (fallback `netstat -ano`) |
| Command line | `ps -ww -eo pid,args` | `/proc/<pid>/cmdline` | `Get-CimInstance Win32_Process` |
| Working directory | `lsof -d cwd` | `/proc/<pid>/cwd` | Inferred from script paths in the command line |
| Open URL | `open` | `xdg-open` / `gio open` | `rundll32 url.dll` |
| Open folder | Finder | `xdg-open` | Explorer |
| Kill process | `SIGTERM` / `SIGKILL` | `SIGTERM` / `SIGKILL` | `taskkill /T` / `taskkill /T /F` |

**Notes**
- **Linux**: process names/PIDs of *other users'* sockets are only visible when running as root; your own dev servers are always detected. Install `iproute2` (`ss`) or `lsof`.
- **Windows**: requires PowerShell 5+ (built in on Windows 10/11). Windows doesn't expose another process' working directory, so AppMap infers the project folder from script paths (e.g. `node C:\work\shop\node_modules\vite\bin\vite.js` → `C:\work\shop`). Apps started as bare `node server.js` may show no folder.
- **WSL**: run AppMap inside WSL to see WSL servers (Linux mode), or on Windows to see Windows servers.

---

## 🛠️ Tech Stack

- **Backend**: Node.js ≥ 18, Express 5, native OS tooling via [`lib/platform.js`](lib/platform.js).
- **Frontend**: Modern Vanilla JavaScript, HTML5 Canvas, Vanilla CSS3 (Glassmorphism, CSS Custom Properties, native `<dialog>` modals with backdrop filters).
- **Zero Heavy Framework Overhead**: Sub-second load times, sub-50ms scans, zero bundler latency.

---

## 📁 Project Structure

```
App-map/
├── package.json          # Project metadata and start scripts
├── server.js             # Express 5 server listening on port 10000 & SSE stream
├── app-map-data.json     # Local store (git-ignored): tags, nicknames, notes, favorites
├── lib/
│   ├── platform.js       # Cross-platform layer (ports, processes, cwd, launchers)
│   ├── scanner.js        # Port scanner, fingerprinting, git info, categorizer
│   ├── prober.js         # HTTP/TCP latency prober, framework and metadata detector
│   ├── store.js          # Persistent JSON store manager
│   └── actions.js        # Process killer, open in browser / file manager
└── public/
    ├── index.html        # Main dashboard SPA
    ├── css/
    │   ├── main.css      # Core tokens, dark cyberpunk theme, ambient glows, header
    │   ├── radar.css     # Orbital radar canvas and tooltip styles
    │   └── components.css# Cards grid, matrix table, dialog modals, toasts
    └── js/
        ├── app.js        # State manager and SSE live listener
        ├── radar.js      # Interactive HTML5 Canvas radar galaxy
        ├── cards.js      # Developer cards grid renderer
        ├── table.js      # Matrix table inspector renderer
        ├── modal.js      # Edit metadata and process kill dialog controllers
        └── ui.js         # Search, category filters, keyboard shortcuts ('/'), toasts
```
