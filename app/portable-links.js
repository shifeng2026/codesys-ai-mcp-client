const fs = require('fs');
const path = require('path');

const OWNED_LINK_TREES = [
  path.join('harness', 'runtime', 'slot', 'payload', 'node_modules'),
  path.join('plugins', 'installed'),
  path.join('profiles', 'dsh', 'profiles', 'web', 'node_modules'),
];

const ROOT_ANCHORS = [
  '/harness/runtime/slot/payload/',
  '/node_modules/',
  '/plugins/',
  '/profiles/',
  '/experts/',
  '/knowledge/',
  '/repositories/',
  '/models/',
  '/video-models/',
  '/tools/',
];

function normalized(value) {
  return path.resolve(value).replaceAll('\\', '/');
}

function findPreviousRoot(target) {
  const normalizedTarget = normalized(target);
  const lowerTarget = normalizedTarget.toLowerCase();
  const positions = ROOT_ANCHORS
    .map((anchor) => lowerTarget.indexOf(anchor))
    .filter((position) => position > 0);
  if (positions.length === 0) return null;
  const anchorPosition = Math.min(...positions);
  return {
    root: normalizedTarget.slice(0, anchorPosition),
    suffix: normalizedTarget.slice(anchorPosition + 1),
  };
}

function collectJunctions(directory, output) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    let stats;
    try {
      stats = fs.lstatSync(candidate);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      output.push(candidate);
      continue;
    }
    if (stats.isDirectory()) collectJunctions(candidate, output);
  }
}

function appendRepairLog(root, result) {
  if (result.relocated === 0 && result.errors.length === 0) return;
  try {
    const logDirectory = path.join(root, 'logs');
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(
      path.join(logDirectory, 'portable-links.log'),
      `${new Date().toISOString()} ${JSON.stringify(result)}\n`,
      'utf8',
    );
  } catch {
  }
}

function repairPortableLinks(projectRoot) {
  const root = path.resolve(projectRoot);
  const normalizedRoot = normalized(root);
  const normalizedRootLower = normalizedRoot.toLowerCase();
  const primaryJunction = path.join(
    root, 'harness', 'runtime', 'slot', 'payload',
    'node_modules', '@deepseek-ai', 'dsh',
  );
  try {
    const primaryTarget = findPreviousRoot(fs.readlinkSync(primaryJunction));
    if (
      primaryTarget?.root.toLowerCase() === normalizedRootLower
      && fs.existsSync(path.join(primaryJunction, 'lib', 'bin.js'))
    ) return { root, scanned: 1, relocated: 0, skipped: 0, errors: [] };
  } catch {
  }
  const junctions = [];
  for (const relative of OWNED_LINK_TREES) collectJunctions(path.join(root, relative), junctions);

  const result = { root, scanned: junctions.length, relocated: 0, skipped: 0, errors: [] };
  for (const junction of junctions) {
    let currentTarget;
    try {
      currentTarget = fs.readlinkSync(junction);
    } catch (error) {
      result.errors.push({ path: junction, code: error.code || 'READLINK_FAILED' });
      continue;
    }
    const previous = findPreviousRoot(currentTarget);
    if (!previous || previous.root.toLowerCase() === normalizedRootLower) continue;

    const relocatedTarget = path.resolve(root, previous.suffix);
    const normalizedTarget = normalized(relocatedTarget).toLowerCase();
    if (normalizedTarget !== normalizedRootLower && !normalizedTarget.startsWith(`${normalizedRootLower}/`)) {
      result.skipped += 1;
      continue;
    }

    try {
      fs.lstatSync(relocatedTarget);
    } catch {
      result.skipped += 1;
      continue;
    }

    try {
      fs.unlinkSync(junction);
      fs.symlinkSync(relocatedTarget, junction, 'junction');
      result.relocated += 1;
    } catch (error) {
      result.errors.push({ path: junction, code: error.code || 'RELINK_FAILED' });
    }
  }

  appendRepairLog(root, result);
  return result;
}

module.exports = { OWNED_LINK_TREES, repairPortableLinks };
