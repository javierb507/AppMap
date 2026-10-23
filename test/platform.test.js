const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const platform = require('../lib/platform');

const { splitHostPort, parseLsofListeners, tokenize } = platform._internal;
const repoRoot = path.resolve(__dirname, '..');

test('splitHostPort handles IPv4, IPv6, wildcard and interface scopes', () => {
  assert.deepStrictEqual(splitHostPort('127.0.0.1:5173'), { host: '127.0.0.1', port: 5173 });
  assert.deepStrictEqual(splitHostPort('*:3000'), { host: '*', port: 3000 });
  assert.deepStrictEqual(splitHostPort('[::1]:8080'), { host: '::1', port: 8080 });
  assert.deepStrictEqual(splitHostPort('[::]:80'), { host: '*', port: 80 });
  assert.deepStrictEqual(splitHostPort('0.0.0.0:443'), { host: '*', port: 443 });
  assert.deepStrictEqual(splitHostPort('127.0.0.53%lo:53'), { host: '127.0.0.53', port: 53 });
  assert.strictEqual(splitHostPort('garbage'), null);
});

test('parseLsofListeners parses lsof LISTEN rows', () => {
  const raw = [
    'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'node    40972 dev    23u  IPv6 0xabc      0t0  TCP [::1]:5173 (LISTEN)',
    'Google\\x20 1234 dev    23u  IPv4 0xabc      0t0  TCP 127.0.0.1:9222 (LISTEN)'
  ].join('\n');
  const rows = parseLsofListeners(raw);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], { command: 'node', pid: 40972, host: '::1', port: 5173 });
  assert.strictEqual(rows[1].command, 'Google ');
});

test('tokenize honors quoted Windows paths', () => {
  assert.deepStrictEqual(
    tokenize('"C:\\Program Files\\nodejs\\node.exe" C:\\w\\a.js --x'),
    ['C:\\Program Files\\nodejs\\node.exe', 'C:\\w\\a.js', '--x']
  );
});

test('inferCwdFromCommand resolves project root from script paths', () => {
  const nodeModulesScript = path.join(repoRoot, 'node_modules', 'express', 'index.js');
  assert.strictEqual(platform.inferCwdFromCommand(`node "${nodeModulesScript}"`), repoRoot);
  assert.strictEqual(platform.inferCwdFromCommand(`node "${path.join(repoRoot, 'server.js')}"`), repoRoot);
  assert.strictEqual(platform.inferCwdFromCommand('node server.js'), null);
  assert.strictEqual(platform.inferCwdFromCommand(''), null);
});

test('isSystemPath flags root and home but not project folders', () => {
  assert.strictEqual(platform.isSystemPath(path.parse(repoRoot).root), true);
  assert.strictEqual(platform.isSystemPath(os.homedir()), true);
  assert.strictEqual(platform.isSystemPath(repoRoot), false);
  assert.strictEqual(platform.isSystemPath(null), true);
});

test('isPrivateIpv4 correctly identifies RFC1918 private subnets', () => {
  const { isPrivateIpv4 } = platform._internal;
  assert.strictEqual(isPrivateIpv4('192.168.1.186'), true);
  assert.strictEqual(isPrivateIpv4('10.0.0.1'), true);
  assert.strictEqual(isPrivateIpv4('172.16.0.5'), true);
  assert.strictEqual(isPrivateIpv4('172.31.255.255'), true);
  assert.strictEqual(isPrivateIpv4('172.32.0.1'), false);
  assert.strictEqual(isPrivateIpv4('8.8.8.8'), false);
  assert.strictEqual(isPrivateIpv4('127.0.0.1'), false);
  assert.strictEqual(isPrivateIpv4('invalid'), false);
});

test('getNetworkIps returns valid non-internal IPv4 interfaces', () => {
  const ips = platform.getNetworkIps();
  assert.ok(Array.isArray(ips));
  for (const item of ips) {
    assert.ok(item.name);
    assert.ok(item.address);
    assert.strictEqual(typeof item.isPrivate, 'boolean');
    assert.strictEqual(typeof item.isVirtual, 'boolean');
  }
});

test('getPrimaryLanIp returns a non-empty IP string', () => {
  const primary = platform.getPrimaryLanIp();
  assert.strictEqual(typeof primary, 'string');
  assert.ok(primary.length > 0);
  assert.ok(/^\d+\.\d+\.\d+\.\d+$/.test(primary));
});

test('listListeners detects a server we open ourselves', async () => {
  const net = require('net');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const listeners = platform.listListeners();
    const mine = listeners.find(l => l.port === port);
    assert.ok(mine, `port ${port} not found among ${listeners.length} listeners`);
    assert.strictEqual(mine.pid, process.pid);

    const cmds = platform.getProcessCommands([process.pid]);
    assert.ok((cmds.get(process.pid) || '').toLowerCase().includes('node'));
  } finally {
    server.close();
  }
});

