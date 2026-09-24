const { execFile, spawn, spawnSync } = require('child_process');

function findCommand() {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    // spawnSync avoids the inherited stdio/pipe edge case that can raise EPIPE
    // inside an Electron main process when where.exe exits during startup.
    const result = spawnSync(lookup, ['claude'], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (result.error || result.status !== 0) return null;
    const commands = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    return commands.find((item) => /\.cmd$/i.test(item)) || commands[0] || null;
  } catch { return null; }
}

function status() {
  const command = findCommand();
  if (!command) return { id: 'claude-code', installed: false, authenticated: false, state: 'not-installed', version: null, command: null };
  const quote = (value) => { const text = String(value); return text && /^[\w@%+=:,./\\-]+$/.test(text) ? text : `"${text.replace(/"/g, '""')}"`; };
  const run = (args, timeout) => process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quote).join(' ')], { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let version = null;
  try { const result = run(['--version'], 10000); if (result.status === 0) version = String(result.stdout || '').trim().split(/\r?\n/)[0] || null; } catch {}
  let authenticated = false;
  let authState = 'unconfigured';
  try {
    const result = run(['auth', 'status'], 15000);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    authenticated = result.status === 0 && /"loggedIn"\s*:\s*true|logged[ -]?in|authenticated|active|valid/i.test(output);
    authState = authenticated ? 'ready' : 'unconfigured';
  } catch { authState = 'unconfigured'; }
  return { id: 'claude-code', installed: true, authenticated, state: authenticated ? 'ready' : authState, version, command };
}

function findCommandAsync() {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(lookup, ['claude'], { encoding: 'utf8', timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      const commands = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      resolve(commands.find((item) => /\.cmd$/i.test(item)) || commands[0] || null);
    });
  });
}

function runAsync(command, args, timeout) {
  const quote = (value) => { const text = String(value); return text && /^[\w@%+=:,./\\-]+$/.test(text) ? text : `"${text.replace(/"/g, '""')}"`; };
  const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : command;
  const invocation = process.platform === 'win32' ? ['/d', '/s', '/c', [command, ...args].map(quote).join(' ')] : args;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    try {
      child = spawn(executable, invocation, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ status: null, stdout, stderr, timeout: true }); }, timeout);
      child.once('error', () => { clearTimeout(timer); finish({ status: null, stdout, stderr, timeout: false }); });
      child.once('close', (status) => { clearTimeout(timer); finish({ status, stdout, stderr, timeout: false }); });
    } catch { finish({ status: null, stdout, stderr, timeout: false }); }
  });
}

async function statusAsync() {
  const command = await findCommandAsync();
  if (!command) return { id: 'claude-code', installed: false, authenticated: false, state: 'not-installed', version: null, command: null };
  const [versionResult, authResult] = await Promise.all([runAsync(command, ['--version'], 10000), runAsync(command, ['auth', 'status'], 15000)]);
  const version = versionResult.status === 0 ? String(versionResult.stdout || '').trim().split(/\r?\n/)[0] || null : null;
  const output = `${authResult.stdout || ''}\n${authResult.stderr || ''}`;
  const authenticated = authResult.status === 0 && /"loggedIn"\s*:\s*true|logged[ -]?in|authenticated|active|valid/i.test(output);
  return { id: 'claude-code', installed: true, authenticated, state: authenticated ? 'ready' : 'unconfigured', version, command };
}

module.exports = { status, statusAsync };
