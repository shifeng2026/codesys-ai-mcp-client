'use strict'

// 测试临时目录的**唯一**出口（T198 第②项）。
//
// 为什么要有它：契约进程里到处是
//   `fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-x-'))`
// 建完就没人管。真机上 %TEMP% 已经累积到 **4,084 个 `taskhive-*` 目录 / 78.61 MB**
// （T197 实测）。T197 只修了占比最大的那一路（`tests/lib/probe-harness.js` 每次进程建 14 个），
// 其余调用点仍在漏：T198 改前实测**跑一轮全绿的契约**（73/73）仍会新留 **3 个** ——
//   `taskhive-reload-handoff-*` / `taskhive-sessions-*` / `taskhive-tree-*`
// 正好就是"建了却没有任何 `rmSync`"的那三个文件。它们不是每次都失败，而是**永远不会**回收。
//
// 形态（照抄 probe-harness 里已经被验证过的那一套，不再造第二套）：
//   · 每个目录登记进**本进程**的清单；
//   · `process.on('exit')` 时**只在 `process.exitCode === 0`（成功）时**回收 —— 失败保留，
//     方便翻证据；`process.on('exit')` 里只能同步调用，`fs.rmSync` 是同步的；
//   · 回收失败不抛、不改退出码（文件可能还被 CODESYS / PowerShell 原生宿主占着）。
//
// 三条边界：
//   · **只删本进程用这个函数建的目录**：清单是进程内的数组，`%TEMP%` 里会话前既有的
//     `taskhive-*` 目录（以及别的工具建的目录）一个都不碰；
//   · 不接管调用方自己的 `rmSync`：调用方想早点删就删，重复删（`force`）是安全的；
//   · 不用它去建"跑完还要看"的目录 —— 那种目录的失败保留语义由调用方自己决定。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tracked = []
let hooked = false

function hookExitCleanup () {
  if (hooked) return
  hooked = true
  process.on('exit', () => {
    // 失败保留：process.exitCode 非 0（含未捕获异常那条路径）时什么都不删。
    if (process.exitCode) return
    for (const dir of tracked) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 删不掉就留着，不能影响退出码 */ }
    }
  })
}

/**
 * Create a fresh directory under the OS temp directory and register it to be
 * removed when this process exits successfully.
 *
 * @param {string} [prefix] basename prefix (`mkdtempSync` appends 6 random chars)
 * @param {{ logs?: boolean }} [options] `logs: true` also creates `<dir>/logs`
 * @returns {string} absolute path of the new directory
 */
function createTempDir (prefix = 'taskhive-', options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), String(prefix)))
  tracked.push(dir)
  hookExitCleanup()
  if (options.logs) fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  return dir
}

module.exports = { createTempDir }
