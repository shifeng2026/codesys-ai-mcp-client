"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempPrefix = "codex-project-switch-smoke-";

let serverStdout = "";
let serverStderr = "";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function samePath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sortedProjectNames(data) {
  return (Array.isArray(data.projects) ? data.projects : [])
    .map((project) => project.name)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function currentProjects(data) {
  return (Array.isArray(data.projects) ? data.projects : []).filter((project) => project.current === true);
}

async function availablePort() {
  const configured = Number.parseInt(process.env.TEST_CODESYS_PROJECT_SWITCH_PORT || "", 10);
  if (Number.isInteger(configured) && configured > 0 && configured < 65536) {
    return configured;
  }

  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) {
    throw new Error("failed to allocate an isolated test port");
  }
  return port;
}

async function waitForServer(baseUrl, probeDirectory, child, getSpawnError) {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw spawnError;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`test server exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode || ""})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/list?path=${encodeURIComponent(probeDirectory)}`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`readiness probe returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`test server did not become ready: ${lastError ? lastError.message : "timeout"}`);
}

async function postProjectList(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/codesys/list-projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`project list returned invalid JSON (HTTP ${response.status}): ${text}`);
  }
  if (!response.ok) {
    throw new Error(`project list failed (HTTP ${response.status}): ${data.error || text}`);
  }
  return data;
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  if (await waitForExit(child, 1500)) {
    return;
  }
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 3000))) {
    throw new Error(`failed to stop isolated test server pid ${child.pid || "unknown"}`);
  }
}

function removeCreatedTempRoot(tempRoot) {
  if (!tempRoot) {
    return;
  }
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTemp, resolvedRoot);
  const safe = relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative) &&
    path.basename(resolvedRoot).startsWith(tempPrefix);
  if (!safe) {
    throw new Error(`refusing to remove unexpected test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  let tempRoot = "";
  let child = null;
  let spawnError = null;
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix));
    const projectDirectory = path.join(tempRoot, "中文 工程文件夹");
    const nestedDirectory = path.join(projectDirectory, "nested");
    const outsideDirectory = path.join(tempRoot, "外部 工程");
    const emptyDirectory = path.join(tempRoot, "空 工程文件夹");
    const logDirectory = path.join(tempRoot, "logs");
    const runtimeDirectory = path.join(tempRoot, "runtime");
    const mirrorDirectory = path.join(tempRoot, "mirrors");

    for (const directory of [
      projectDirectory,
      nestedDirectory,
      outsideDirectory,
      emptyDirectory,
      logDirectory,
      runtimeDirectory,
      mirrorDirectory
    ]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const projectA = path.join(projectDirectory, "甲 工程.project");
    const projectB = path.join(projectDirectory, "乙工程.PROJECT");
    const nestedProject = path.join(nestedDirectory, "C.project");
    const outsideProject = path.join(outsideDirectory, "外部.project");
    for (const projectFile of [projectA, projectB, nestedProject, outsideProject]) {
      fs.writeFileSync(projectFile, "smoke fixture\n", "utf8");
    }

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, "server.js")], {
      cwd: root,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        CODEX_CLIENT_WORKSPACE: tempRoot,
        CODEX_CLIENT_CODESYS_PROJECT: projectA,
        CODEX_CLIENT_CODESYS_EXPORT_CACHE: path.join(tempRoot, "codesys-exports"),
        CODEX_CLIENT_LOG_DIR: logDirectory,
        CODEX_CLIENT_HISTORY_MIRROR: path.join(mirrorDirectory, "history.json"),
        CODEX_CLIENT_MAINTENANCE_LOG_MIRROR: path.join(mirrorDirectory, "maintenance.md"),
        CODEX_CLIENT_ENGINEERING_MEMORY_MIRROR: path.join(mirrorDirectory, "engineering.md"),
        CODEX_CLIENT_RUNTIME_CODEX_HOME: runtimeDirectory,
        CODEX_CLIENT_DOCUMENT_CACHE: path.join(tempRoot, "document-cache"),
        PYTHON_COMMAND_MEMORY_PATH: path.join(tempRoot, "python-command-memory.json")
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      serverStdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      serverStderr += chunk;
    });

    await waitForServer(baseUrl, tempRoot, child, () => spawnError);

    const explicit = await postProjectList(baseUrl, {
      projectDirectory,
      projectPath: projectA
    });
    assert.equal(explicit.projects.length, 2, "explicit folder should return exactly its two direct projects");
    assert.deepEqual(
      sortedProjectNames(explicit),
      [path.basename(projectA), path.basename(projectB)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
      "Chinese, spaces, and uppercase .PROJECT should be recognized"
    );
    assert.ok(samePath(explicit.searchRoot, projectDirectory), "explicit folder should be preserved as searchRoot");
    assert.ok(samePath(explicit.currentProject, projectA), "explicitly selected A should remain current");
    assert.equal(currentProjects(explicit).length, 1, "explicit folder should have exactly one current project");
    assert.ok(samePath(currentProjects(explicit)[0].path, projectA), "A should be marked current");
    assert.ok(!explicit.projects.some((project) => samePath(project.path, nestedProject)), "nested C must not be returned");

    const legacy = await postProjectList(baseUrl, { projectPath: projectA });
    assert.equal(legacy.projects.length, 2, "legacy file input should scan A's sibling projects");
    assert.deepEqual(sortedProjectNames(legacy), sortedProjectNames(explicit));
    assert.ok(samePath(legacy.searchRoot, projectDirectory), "legacy file input should use its parent folder");
    assert.ok(samePath(legacy.currentProject, projectA), "legacy file input should retain A as current");

    const outside = await postProjectList(baseUrl, {
      projectDirectory,
      projectPath: outsideProject
    });
    assert.equal(outside.projects.length, 2, "an outside selection must not alter the folder project list");
    assert.ok(!samePath(outside.currentProject, outsideProject), "an outside project must never become current");
    assert.ok(
      outside.projects.some((project) => samePath(project.path, outside.currentProject)),
      "fallback current project must belong to the selected folder"
    );
    assert.ok(!outside.projects.some((project) => samePath(project.path, outsideProject)), "outside project must not be listed");

    const empty = await postProjectList(baseUrl, {
      projectDirectory: emptyDirectory,
      projectPath: ""
    });
    assert.equal(empty.projects.length, 0, "empty folder should return zero projects");
    assert.equal(empty.currentProject, "", "empty folder should not have a current project");
    assert.ok(samePath(empty.searchRoot, emptyDirectory), "empty folder should remain the response searchRoot");

    console.log(JSON.stringify({
      ok: true,
      port,
      assertions: {
        explicitDirectProjects: explicit.projects.length,
        legacySiblingProjects: legacy.projects.length,
        nestedExcluded: true,
        outsideCannotBeCurrent: true,
        emptyProjects: empty.projects.length,
        unicodeSpaceUppercaseExtension: true
      }
    }));
  } finally {
    await stopServer(child);
    removeCreatedTempRoot(tempRoot);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  if (serverStdout.trim()) {
    console.error("server stdout:\n" + serverStdout.trim());
  }
  if (serverStderr.trim()) {
    console.error("server stderr:\n" + serverStderr.trim());
  }
  process.exitCode = 1;
});
