const path = require('path');
const { spawn } = require('child_process');

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw Object.assign(new Error(`缺少 ${label}`), { code: 'CODESYS_GUI_LAUNCH_INVALID' });
  if (/[\x00\r\n"]/.test(text)) throw Object.assign(new Error(`${label} 包含无效字符`), { code: 'CODESYS_GUI_LAUNCH_INVALID' });
  return text;
}

function buildCodesysGuiLaunch(doctor, options = {}) {
  const exePath = path.resolve(requiredText(doctor?.exePath, 'CODESYS.exe 路径'));
  const profile = requiredText(doctor?.profile, 'CODESYS profile');
  const culture = requiredText(options.culture || 'zh-CN', 'CODESYS culture');
  const platform = options.platform || process.platform;
  const quote = (value) => platform === 'win32' ? `"${value}"` : value;
  const args = [`--profile=${quote(profile)}`, `--culture=${quote(culture)}`];
  return {
    exePath,
    profile,
    culture,
    args,
    options: {
      cwd: path.dirname(exePath),
      detached: true,
      windowsHide: false,
      windowsVerbatimArguments: platform === 'win32',
      stdio: 'ignore',
    },
  };
}

function launchCodesysGui(doctor, options = {}) {
  const launch = buildCodesysGuiLaunch(doctor, options);
  const spawnProcess = options.spawnProcess || spawn;
  const child = spawnProcess(launch.exePath, launch.args, launch.options);
  if (!child || typeof child.unref !== 'function') throw Object.assign(new Error('CODESYS 启动进程不可分离'), { code: 'CODESYS_GUI_LAUNCH_FAILED' });
  child.unref();
  return { ...launch, pid: child.pid || null };
}

module.exports = { buildCodesysGuiLaunch, launchCodesysGui };
