/**
 * Cross-platform system layer for AppMap.
 *
 * Provides a uniform API on macOS (darwin), Linux and Windows (win32) for:
 *   - listListeners()          -> [{ port, host, pid, command }]
 *   - getProcessCommands(pids) -> Map<pid, fullCommandLine>
 *   - getProcessNames(pids)    -> Map<pid, shortProcessName>
 *   - getProcessCwds(pids, commands) -> Map<pid, workingDirectory>
 *   - isSystemPath(dir)        -> true for root/home/OS/app-install dirs
 *   - launch helpers used by actions.js
 *
 * Every external command is executed with stderr ignored and a timeout, and
 * every function degrades gracefully (returns empty results) when a tool is
 * missing, so the dashboard keeps working with partial data.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLATFORM = process.platform; // 'darwin' | 'linux' | 'win32' | ...
const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

/**
 * Run a command synchronously and return stdout. Never throws: if the command
 * exits non-zero but produced output (e.g. lsof with vanished PIDs) the
 * partial stdout is returned; if the binary is missing, '' is returned.
 */
function run(file, args, timeout = 4000) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch (err) {
    return (err && typeof err.stdout === 'string') ? err.stdout : '';
  }
}

function runPowerShell(script, timeout = 10000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeout);
}

function parseJsonArray(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return parsed ? [parsed] : [];
  } catch (_) {
    return [];
  }
}

/** Split "host:port" / "[::1]:port" / "*:port" / "127.0.0.1%lo:53" */
function splitHostPort(addr) {
  if (!addr) return null;
  const m = String(addr).match(/^(?:\[?(.*?)\]?)(?:%[^:\]]+)?:(\d+)$/);
  if (!m) return null;
  const port = parseInt(m[2], 10);
  if (isNaN(port)) return null;
  let host = m[1] || '*';
  if (host === '0.0.0.0' || host === '::' || host === '') host = '*';
  return { host, port };
}

function stripExe(name) {
  return (name || '').replace(/\.exe$/i, '');
}

// ---------------------------------------------------------------------------
// Listening TCP ports
// ---------------------------------------------------------------------------

function parseLsofListeners(raw) {
  const listeners = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('COMMAND')) continue;
    const match = line.match(/^(\S+)\s+(\d+)\s+.*?\sTCP\s+(\S+)(?:\s+\(LISTEN\))?/i);
    if (!match) continue;
    const hp = splitHostPort(match[3]);
    const pid = parseInt(match[2], 10);
    if (hp && !isNaN(pid)) {
      listeners.push({ command: match[1].replace(/\\x20/g, ' '), pid, host: hp.host, port: hp.port });
    }
  }
  return listeners;
}

function listListenersLsof() {
  return parseLsofListeners(run('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P'], 5000));
}

/** Linux: `ss -ltnpH` → LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=123,fd=21)) */
function listListenersSs() {
  const raw = run('ss', ['-ltnpH'], 4000);
  const listeners = [];
  for (const line of raw.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const hp = splitHostPort(cols[3]);
    if (!hp) continue;
    const userMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    listeners.push({
      command: userMatch ? userMatch[1] : 'unknown',
      pid: userMatch ? parseInt(userMatch[2], 10) : null,
      host: hp.host,
      port: hp.port
    });
  }
  return listeners;
}

/** Windows: Get-NetTCPConnection (locale independent), fallback to netstat. */
function listListenersWindows() {
  const ps = runPowerShell(
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ' +
    'Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'
  );
  let listeners = parseJsonArray(ps).map(r => {
    let host = String(r.LocalAddress || '*');
    if (host === '0.0.0.0' || host === '::') host = '*';
    return { command: null, pid: Number(r.OwningProcess) || null, host, port: Number(r.LocalPort) };
  }).filter(l => l.port);

  if (listeners.length === 0) {
    // netstat state names are localized, so detect listeners by the
    // "any" foreign address (0.0.0.0:0 / [::]:0) instead of "LISTENING".
    const raw = run('netstat', ['-ano', '-p', 'TCP'], 5000) + run('netstat', ['-ano', '-p', 'TCPv6'], 5000);
    for (const line of raw.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5 || !/^TCP/i.test(cols[0])) continue;
      if (!/^(0\.0\.0\.0|\[::\]):0$/.test(cols[2])) continue;
      const hp = splitHostPort(cols[1]);
      const pid = parseInt(cols[cols.length - 1], 10);
      if (hp) listeners.push({ command: null, pid: isNaN(pid) ? null : pid, host: hp.host, port: hp.port });
    }
  }
  return listeners;
}

function listListeners() {
  let listeners = [];
  if (IS_WIN) {
    listeners = listListenersWindows();
  } else if (IS_LINUX) {
    listeners = listListenersSs();
    if (listeners.length === 0) listeners = listListenersLsof();
  } else {
    listeners = listListenersLsof();
  }
  // Ignore PID 0/4 (Windows "System"/kernel) as they are not killable apps
  return listeners.filter(l => l.port > 0);
}

// ---------------------------------------------------------------------------
// Process information
// ---------------------------------------------------------------------------

let winProcCache = { time: 0, rows: [] };
function getWindowsProcesses() {
  // One PowerShell call is expensive (~0.5s); share it between name/command lookups.
  if (Date.now() - winProcCache.time < 1500) return winProcCache.rows;
  const raw = runPowerShell(
    'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'
  );
  winProcCache = { time: Date.now(), rows: parseJsonArray(raw) };
  return winProcCache.rows;
}

function getProcessCommands(pids = []) {
  const map = new Map();
  const wanted = new Set(pids.filter(Boolean));

  if (IS_WIN) {
    for (const p of getWindowsProcesses()) {
      const pid = Number(p.ProcessId);
      if (wanted.size && !wanted.has(pid)) continue;
      map.set(pid, p.CommandLine || p.Name || '');
    }
    return map;
  }

  if (IS_LINUX) {
    for (const pid of wanted) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
        if (cmd) map.set(pid, cmd);
      } catch (_) { /* process gone or not ours */ }
    }
    if (map.size === wanted.size && wanted.size > 0) return map;
  }

  const output = run('ps', ['-ww', '-eo', 'pid=,args='], 3000);
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = parseInt(match[1], 10);
    if (wanted.size && !wanted.has(pid)) continue;
    if (!map.has(pid)) map.set(pid, match[2]);
  }
  return map;
}

function getProcessNames(pids = []) {
  const map = new Map();
  if (!IS_WIN) return map; // lsof/ss already supply names on Unix
  const wanted = new Set(pids.filter(Boolean));
  for (const p of getWindowsProcesses()) {
    const pid = Number(p.ProcessId);
    if (wanted.has(pid)) map.set(pid, stripExe(p.Name));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Working directories
// ---------------------------------------------------------------------------

function getCwdsLsof(pids) {
  const map = new Map();
  for (let i = 0; i < pids.length; i += 40) {
    const chunk = pids.slice(i, i + 40).join(',');
    const output = run('lsof', ['-a', '-p', chunk, '-d', 'cwd', '-Fn'], 4000);
    let currentPid = null;
    for (const line of output.split('\n')) {
      if (line.startsWith('p')) currentPid = parseInt(line.substring(1), 10);
      else if (line.startsWith('n') && currentPid) map.set(currentPid, line.substring(1));
    }
  }
  return map;
}

function getCwdsProc(pids) {
  const map = new Map();
  for (const pid of pids) {
    try {
      map.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`));
    } catch (_) { /* permission denied for other users' processes */ }
  }
  return map;
}

/** Tokenize a command line honoring double/single quotes. */
function tokenize(cmd) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

const PROJECT_MARKERS = ['package.json', '.git', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'deno.json'];

function findProjectRoot(startDir, maxDepth = 6) {
  let dir = startDir;
  for (let i = 0; i < maxDepth && dir; i++) {
    if (PROJECT_MARKERS.some(f => fs.existsSync(path.join(dir, f)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Windows has no cheap way to read another process' CWD, so infer the project
 * directory from script paths in the command line, e.g.
 *   node C:\work\shop\node_modules\vite\bin\vite.js   -> C:\work\shop
 *   python C:\work\api\main.py                         -> C:\work\api
 * Also used as a fallback on Unix when lsof//proc gives nothing.
 */
function inferCwdFromCommand(command) {
  if (!command) return null;
  const tokens = tokenize(command).slice(1); // skip the executable itself
  for (const raw of tokens) {
    const tok = raw.replace(/^--?[\w-]+=/, ''); // --config=C:\x\vite.config.js
    if (!path.isAbsolute(tok)) continue;
    // Anything inside node_modules belongs to the project that owns node_modules
    const nm = tok.split(/[\\/]node_modules[\\/]/)[0];
    if (nm !== tok && fs.existsSync(nm)) return nm;
    try {
      const stat = fs.statSync(tok);
      const dir = stat.isDirectory() ? tok : path.dirname(tok);
      if (isSystemPath(dir)) continue;
      return findProjectRoot(dir) || dir;
    } catch (_) { /* not a path on disk */ }
  }
  return null;
}

function getProcessCwds(pids = [], commands = new Map()) {
  const list = pids.filter(Boolean);
  let map = new Map();
  if (list.length === 0) return map;

  if (IS_LINUX) map = getCwdsProc(list);
  else if (IS_MAC) map = getCwdsLsof(list);

  // Fill gaps (always on Windows) using the command line heuristic
  for (const pid of list) {
    const current = map.get(pid);
    if (!current || isSystemPath(current)) {
      const inferred = inferCwdFromCommand(commands.get(pid));
      if (inferred) map.set(pid, inferred);
      else if (current && path.parse(path.resolve(current)).root === path.resolve(current)) map.delete(pid);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

const HOME = path.resolve(os.homedir());

function systemPrefixes() {
  if (IS_WIN) {
    const env = process.env;
    return [
      env.SystemRoot || 'C:\\Windows',
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      env.ProgramData || 'C:\\ProgramData',
      env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : null,
      env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft') : null
    ].filter(Boolean).map(p => path.resolve(p).toLowerCase());
  }
  if (IS_MAC) return ['/Applications', '/System', '/Library', '/usr', '/private', '/opt/homebrew/Cellar'];
  return ['/usr', '/opt', '/snap', '/var/lib', '/bin', '/sbin', '/lib', '/etc', '/run', '/proc'];
}
const SYSTEM_PREFIXES = systemPrefixes();

/**
 * True when a directory is not a meaningful project folder: filesystem root,
 * the user home, or an OS / application install location.
 */
function isSystemPath(dir) {
  if (!dir) return true;
  const resolved = path.resolve(dir);
  if (path.parse(resolved).root === resolved) return true;
  const cmp = IS_WIN ? resolved.toLowerCase() : resolved;
  if (cmp === (IS_WIN ? HOME.toLowerCase() : HOME)) return true;
  return SYSTEM_PREFIXES.some(prefix => cmp === prefix || cmp.startsWith(prefix + path.sep));
}

// ---------------------------------------------------------------------------
// Launchers (no shell → no quoting/injection issues)
// ---------------------------------------------------------------------------

function launch(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false, ...options });
    } catch (err) {
      return reject(err);
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function launchFirst(candidates) {
  let lastErr = new Error('No launcher available');
  for (const [file, args, options] of candidates) {
    try {
      await launch(file, args, options);
      return file;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function openUrl(url) {
  if (IS_WIN) return launch('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  if (IS_MAC) return launch('open', [url]);
  return launchFirst([['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]]]);
}

function openInFileManager(dir) {
  if (IS_WIN) return launch('explorer.exe', [dir]);
  if (IS_MAC) return launch('open', [dir]);
  return launchFirst([['xdg-open', [dir]], ['gio', ['open', dir]]]);
}

function openTerminal(dir) {
  if (IS_WIN) {
    return launchFirst([
      ['wt.exe', ['-d', dir]],
      ['cmd.exe', ['/c', 'start', '', 'cmd.exe', '/K'], { cwd: dir }]
    ]);
  }
  if (IS_MAC) return launch('open', ['-a', 'Terminal', dir]);
  return launchFirst([
    ['x-terminal-emulator', [], { cwd: dir }],
    ['gnome-terminal', [`--working-directory=${dir}`]],
    ['konsole', ['--workdir', dir]],
    ['xfce4-terminal', [`--working-directory=${dir}`]],
    ['xterm', [], { cwd: dir }]
  ]);
}

/** Open with a specific editor/app; falls back to the file manager. */
async function openWithApp(dir, appName) {
  const name = (appName || '').toLowerCase();
  if (name === 'terminal') return openTerminal(dir);
  if (name === 'vscode' || name === 'code') {
    // `code` is a .cmd shim on Windows, which requires a shell to run
    return launch('code', [dir], IS_WIN ? { shell: true } : {});
  }
  if (IS_MAC && appName && !['finder', 'filemanager', 'explorer'].includes(name)) {
    const macApps = { iterm: 'iTerm', sublime: 'Sublime Text', antigravity: 'Antigravity' };
    return launch('open', ['-a', macApps[name] || appName, dir]);
  }
  return openInFileManager(dir);
}

/**
 * Terminate a process. Windows has no POSIX signals, so taskkill is used
 * (with /T to include child processes such as Vite's esbuild workers).
 */
function killProcess(pid, force = false) {
  if (IS_WIN) {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    try {
      execFileSync('taskkill', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 5000 });
    } catch (err) {
      // Console apps often refuse a graceful taskkill; escalate once.
      if (force) throw new Error((err.stderr || err.message || '').toString().trim());
      execFileSync('taskkill', [...args, '/F'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 5000 });
    }
    return;
  }
  process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
}

function fileManagerName() {
  if (IS_WIN) return 'Explorer';
  if (IS_MAC) return 'Finder';
  return 'File Manager';
}

module.exports = {
  PLATFORM,
  IS_WIN,
  IS_MAC,
  IS_LINUX,
  listListeners,
  getProcessCommands,
  getProcessNames,
  getProcessCwds,
  inferCwdFromCommand,
  isSystemPath,
  openUrl,
  openInFileManager,
  openWithApp,
  killProcess,
  fileManagerName,
  // exported for tests
  _internal: { splitHostPort, parseLsofListeners, tokenize }
};
