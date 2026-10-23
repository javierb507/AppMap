const fs = require('fs');
const platform = require('./platform');

/**
 * Safely kills a process by PID (SIGTERM/SIGKILL on Unix, taskkill on Windows)
 */
function killProcess(pid, signal = 'SIGTERM') {
  return new Promise((resolve, reject) => {
    const targetPid = parseInt(pid, 10);
    // PID 4 is the Windows kernel "System" process
    if (!targetPid || isNaN(targetPid) || targetPid <= 1 || (platform.IS_WIN && targetPid === 4)) {
      return reject(new Error('Invalid PID or system critical process protection.'));
    }

    if (targetPid === process.pid) {
      return reject(new Error('Cannot terminate AppMap server itself.'));
    }

    const force = signal === 'SIGKILL';
    try {
      platform.killProcess(targetPid, force);
      resolve({ success: true, pid: targetPid, signal: force ? 'SIGKILL' : 'SIGTERM' });
    } catch (error) {
      reject(new Error(error.message || String(error)));
    }
  });
}

/**
 * Opens a URL in the default browser (open / xdg-open / rundll32)
 */
async function openUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Invalid URL provided');
  }
  await platform.openUrl(url);
  return { success: true, url };
}

/**
 * Opens a local directory in the OS file manager, a terminal or an installed IDE.
 * targetApp: 'FileManager' (default; 'Finder'/'Explorer' accepted), 'Terminal',
 * 'VSCode', or on macOS any application name ('iTerm', 'Sublime', 'Antigravity').
 */
async function openFolder(folderPath, targetApp = 'FileManager') {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error('Folder path does not exist on disk');
  }
  await platform.openWithApp(folderPath, targetApp);
  return { success: true, path: folderPath, app: targetApp };
}

module.exports = {
  killProcess,
  openUrl,
  openFolder
};
