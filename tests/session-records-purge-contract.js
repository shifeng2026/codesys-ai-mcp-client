'use strict'

// T092 — 会话记录「真删除」的合同。
//
// 背景：DSH 只有「归档会话」（`uiWorkspace.archiveSession`）——归档后侧栏不再显示，
// 但记录文件与磁盘占用都保留；DSH 的任何 UI 包里 `deleteSession` / `removeSession`
// 的出现次数是 0，没有删除 API。用户要求"真删文件、回收磁盘"，于是这一层落在文件层，
// 因此它是**破坏性**代码：静态断言不够，必须在临时 DSH_HOME 上真跑一遍。
//
// 存储布局（实测）：<DSH home>/sessions/<工作区分桶>/<会话 id>/session.v3.jsonl.zstd

const assert = require('assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PLUGIN = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js')
const CLIENT = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js')

function makeSession(root, bucket, session, bytes, logName = 'session.v3.jsonl.zstd') {
  const dir = path.join(root, 'sessions', bucket, session)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, logName), Buffer.alloc(bytes, 7))
  return dir
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-sessions-'))
  const sessionsRoot = path.join(home, 'sessions')
  fs.mkdirSync(sessionsRoot, { recursive: true })

  const bucket = '--C-Users-demo-project--'
  const doomed = '11111111-1111-4111-8111-111111111111'
  const active = '22222222-2222-4222-8222-222222222222'
  const notASession = '33333333-3333-4333-8333-333333333333'

  makeSession(home, bucket, doomed, 4096)
  makeSession(home, bucket, active, 2048)
  // A directory inside the root that is NOT a session (no session.v3.jsonl*).
  fs.mkdirSync(path.join(sessionsRoot, bucket, notASession), { recursive: true })
  fs.writeFileSync(path.join(sessionsRoot, bucket, notASession, 'notes.txt'), 'not a session')
  // A bystander OUTSIDE the sessions root that a naive path join could reach.
  const outside = path.join(home, 'outside-victim')
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'must survive')

  process.env.DSH_HOME = home
  const plugin = await import(pathToFileURL(PLUGIN).href)
  const client = fs.readFileSync(CLIENT, 'utf8')

  // ── 1. 根目录与列表 ──────────────────────────────────────────────────────
  assert.strictEqual(plugin.dshSessionsRoot(), sessionsRoot, 'the sessions root must honour DSH_HOME')
  const listed = plugin.listSessionRecords()
  assert.strictEqual(listed.root, sessionsRoot)
  assert.strictEqual(listed.exists, true)
  assert.strictEqual(listed.sessionCount, 2, `only real session directories may be listed (got ${listed.sessionCount})`)
  assert.strictEqual(listed.totalBytes, 4096 + 2048)
  const rows = listed.workspaces.flatMap((group) => group.sessions)
  assert(rows.some((row) => row.session === doomed) && rows.some((row) => row.session === active), 'both sessions must be listed')
  assert(!rows.some((row) => row.session === notASession), 'a directory without session.v3.jsonl must not be listed')

  // ── 2. 拒绝非法名字（不得穿越目录）────────────────────────────────────────
  const traversal = plugin.purgeSessionRecords([
    { workspace: bucket, session: '..' },
    { workspace: '..', session: doomed },
    { workspace: bucket, session: 'a/b' },
    { workspace: bucket, session: 'a\\b' },
    { workspace: 'C:', session: doomed },
  ], {})
  assert.strictEqual(traversal.deleted.length, 0, 'no traversal-shaped target may ever be deleted')
  assert.strictEqual(traversal.skipped.length, 5)
  assert(traversal.skipped.every((item) => item.reason === 'invalid-name'), 'traversal targets must be rejected as invalid-name')
  assert(fs.existsSync(path.join(outside, 'keep.txt')), 'a bystander outside the sessions root must survive')

  // ── 3. 拒绝当前活动会话 ──────────────────────────────────────────────────
  const activeAttempt = plugin.purgeSessionRecords([{ workspace: bucket, session: active }], { activeSessionId: active })
  assert.strictEqual(activeAttempt.deleted.length, 0)
  assert.strictEqual(activeAttempt.skipped[0].reason, 'active-session', 'the active session must be refused (DSH may hold its write handle)')
  assert(fs.existsSync(path.join(sessionsRoot, bucket, active, 'session.v3.jsonl.zstd')), 'the active session must still be on disk')

  // ── 4. 拒绝不是会话的目录 ────────────────────────────────────────────────
  const notSessionAttempt = plugin.purgeSessionRecords([{ workspace: bucket, session: notASession }], {})
  assert.strictEqual(notSessionAttempt.deleted.length, 0)
  assert.strictEqual(notSessionAttempt.skipped[0].reason, 'not-a-session-directory', 'a directory without a session log must be refused')
  assert(fs.existsSync(path.join(sessionsRoot, bucket, notASession, 'notes.txt')), 'the refused directory must be untouched')

  // ── 5. 合法目标：删除并统计回收 ──────────────────────────────────────────
  const purge = plugin.purgeSessionRecords([{ workspace: bucket, session: doomed }], { activeSessionId: active })
  assert.strictEqual(purge.deleted.length, 1, `expected one deletion, got ${JSON.stringify(purge)}`)
  assert.strictEqual(purge.freedBytes, 4096)
  assert(!fs.existsSync(path.join(sessionsRoot, bucket, doomed)), 'the deleted session directory must be gone')
  assert(fs.existsSync(path.join(sessionsRoot, bucket, active, 'session.v3.jsonl.zstd')), 'deleting one session must not touch another')

  const after = plugin.listSessionRecords()
  assert.strictEqual(after.sessionCount, 1)
  assert.strictEqual(after.totalBytes, 2048)

  // ── 6. 根目录不存在时不得乱删 ────────────────────────────────────────────
  fs.rmSync(sessionsRoot, { recursive: true, force: true })
  const missing = plugin.purgeSessionRecords([{ workspace: bucket, session: doomed }], {})
  assert.strictEqual(missing.deleted.length, 0)
  assert.strictEqual(missing.skipped[0].reason, 'sessions-root-missing')
  assert.strictEqual(plugin.listSessionRecords().exists, false)

  // ── 6b. T093: 只给会话 id 时必须唯一解析（会话行的「…」菜单拿不到分桶）────
  fs.mkdirSync(sessionsRoot, { recursive: true })
  const bucketB = '--C-Users-demo-other--'
  makeSession(home, bucket, doomed, 1024)
  const byIdOnly = plugin.purgeSessionRecords([{ session: doomed }], {})
  assert.strictEqual(byIdOnly.deleted.length, 1, `a session id alone must resolve when unique (got ${JSON.stringify(byIdOnly)})`)
  assert.strictEqual(byIdOnly.deleted[0].workspace, bucket, 'the resolved bucket must be reported back')
  assert.strictEqual(byIdOnly.freedBytes, 1024)

  // 同一个 id 出现在两个分桶 -> 拒绝，绝不猜
  makeSession(home, bucket, doomed, 512)
  makeSession(home, bucketB, doomed, 512)
  const ambiguous = plugin.purgeSessionRecords([{ session: doomed }], {})
  assert.strictEqual(ambiguous.deleted.length, 0, 'an ambiguous session id must never be deleted')
  assert.strictEqual(ambiguous.skipped[0].reason, 'ambiguous-session')
  assert(fs.existsSync(path.join(sessionsRoot, bucket, doomed)), 'the ambiguous candidate must survive')
  assert(fs.existsSync(path.join(sessionsRoot, bucketB, doomed)), 'the other ambiguous candidate must survive too')

  const unknown = plugin.purgeSessionRecords([{ session: '99999999-9999-4999-8999-999999999999' }], {})
  assert.strictEqual(unknown.deleted.length, 0)
  assert.strictEqual(unknown.skipped[0].reason, 'session-not-found')

  // ── 6c. T094: 日志版本号不是固定的（现场实测：CLI profile 用 v3，TaskHive 应用自己的
  //        profile 用 v2）。只认 v3 会让应用真实的会话全部"找不到"。──────────────
  const v2Bucket = '--C-Users-demo-v2--'
  const v2Session = '44444444-4444-4444-8444-444444444444'
  makeSession(home, v2Bucket, v2Session, 2048, 'session.v2.jsonl.zstd')
  const withV2 = plugin.listSessionRecords()
  assert(
    withV2.workspaces.flatMap((group) => group.sessions).some((row) => row.session === v2Session),
    'a session.v2 log must be listed, not just v3 — the app profile writes v2',
  )
  const v2Purge = plugin.purgeSessionRecords([{ session: v2Session }], {})
  assert.strictEqual(v2Purge.deleted.length, 1, `a v2 session must be deletable (got ${JSON.stringify(v2Purge)})`)
  assert.strictEqual(v2Purge.freedBytes, 2048)

  // ── 7. 路由与客户端接线（静态）──────────────────────────────────────────
  const source = fs.readFileSync(PLUGIN, 'utf8')
  assert(source.includes("const sessionPrefix = `${WORKBENCH_ROUTE}/sessions.`"), 'the sessions routes must live under the same trusted prefix')
  assert(source.includes("if (body?.confirm !== true)"), 'purge must refuse without an explicit confirm:true')
  assert(source.includes("code: 'confirmation-required'"), 'the refusal must be a typed error')
  assert(source.includes('rmSync(dirReal, { recursive: true, force: true })'), 'the purge must delete the session DIRECTORY, not just the log file')
  assert(source.includes('dirReal !== rootReal && !dirReal.startsWith(`${rootReal}${sep}`)'), 'every deletion must be re-checked against the realpath of the sessions root')
  // 这一条原来写的是 client.includes('/sessions.${method}') —— 那只是个**子串**，
  // 连错误的 `${CODESYS_WORKBENCH_API}/sessions.${method}` 也能满足它，于是它把一个真实的
  // 404 放行了（现场表现：删除时报"宿主未响应，请重启 TaskHive 后重试"）。改为断言**基址**。
  assert(client.includes('const CODESYS_SESSIONS_API = `${TASKHIVE_API_BASE}/sessions`'), 'the sessions route must be built from the shared API base')
  assert(client.includes('fetch(`${CODESYS_SESSIONS_API}.${method}`'), 'the client must call the sessions route on that base')
  // Anchor on the CALL, not on the bare substring: the comment above the constants
  // explains the wrong shape on purpose, and a substring check would forbid explaining it.
  assert(!client.includes('fetch(`${CODESYS_WORKBENCH_API}/sessions.'), 'no request may be built by appending the sessions path to the workbench base (that made every call 404)')
  assert(client.includes("h(SessionRecordsPanel, { ctx })"), 'the panel must be mounted through a registered tab')
  assert(client.includes("id: 'taskhive:sessions', title: '会话记录'"), 'the tab must be registered through the official registerTab API')
  assert(!/archiveSession[\s\S]{0,200}window\.confirm/.test(client), 'the panel must not archive without the user confirmation that precedes it')
  assert(client.includes('当前打开的会话不能删除'), 'the panel must explain why the active session is not selectable')

  // ── 8. T093: 会话行「…」菜单里的「彻底删除」──────────────────────────────
  // DSH 的会话菜单项写死在 dsh-client-ui-workspace 里，没有插槽；会话行也没有 id 属性，
  // 所以这一项只能注入 DOM，并且必须靠"标题 → 会话 id"的唯一匹配定位目标。
  assert(client.includes('const SESSION_MENU_ARCHIVE_LABEL = /^(?:归档会话|Archive session)$/i'), 'the injection must fingerprint the SESSION menu by its archive item, not by generic menu markup (the Menu primitive is shared with the workspace menu)')
  assert(client.includes("clone.setAttribute('data-taskhive-session-delete', 'true')"), 'our item must be marked so re-injection stays idempotent')
  assert(client.includes('const clone = archiveItem.cloneNode(true)'), 'the item must be CLONED from the existing archive item so styling/hover come for free instead of being guessed')
  assert(client.includes('label.textContent = SESSION_DELETE_LABEL'), 'only the label text may change on the clone')
  assert(client.includes('list.insertBefore(clone, archiveItem.nextSibling)'), 'the item must be inserted next to the archive entry (a session menu is open)')
  assert(client.includes('if (matches.length !== 1) {'), 'the title→session mapping must REQUIRE a unique match')
  assert(client.includes('return { ok: false, reason: matches.length ? `标题「${title}」同时对应 ${matches.length} 个会话`'), 'the refusal must state how many sessions share that title')
  assert(client.includes("if (summary?.running === true) return { ok: false, reason: '会话正在运行' }"), 'a running session must be refused')
  assert(client.includes('if (resolved.id === active)'), 'the currently open session must be refused in the menu path too')
  assert(client.includes('message: `确认删除「${resolved.title}」？`'), 'the menu confirm must only ask for confirmation')
  assert(client.includes("sessionRecordsApi('purge', { targets: [{ session: resolved.id }], confirm: true, activeSessionId: active })"), 'the menu path must go through the same confirm:true purge route')
  assert(client.includes("document.addEventListener('click', rememberSessionRow, true)"), 'the row must be bound by click context (locale-independent), not by a localized aria-label')
  assert(client.includes("document.removeEventListener('click', rememberSessionRow, true)"), 'the click listener must be disposed with the skin')
  assert(client.includes('if (sessionMenuDelete.row) injectSessionDeleteMenuItem()'), 'the injection must only run after a session row was clicked (no per-scrub document-wide menu query)')

  // ── 9. T093b: 定位必须走精确通道，标题只作退路 ────────────────────────────
  // 现场实测：菜单项注入成功，但定位失败并弹出"标题不唯一"——因为标题会真实撞车
  // （「1」「新会话」这类标题能对应多个会话），而且 HoverCard 的内容与行挂在同一容器里，
  // 用后代选择器会读到悬浮卡片的预览文字。
  assert(client.includes('const probeSessionIdByDrag = (row) =>'), 'the exact session id must be probed from the row, not inferred from its title')
  assert(client.includes("row.dispatchEvent(new DragEvent('dragstart'"), 'the probe must synthesise dragstart, because DSH only writes node.id into dataTransfer there')
  assert(client.includes("transfer.getData('text/plain')"), 'the id must come from the same channel DSH itself uses for reordering')
  assert(client.includes("row.dispatchEvent(new DragEvent('dragend'"), 'the probe must end the synthetic drag it started')
  assert(client.includes('if (dragged && byId[dragged])'), 'a probed id must be validated against the session list before use')
  assert(client.includes('for (const child of row.children || []) {'), 'the title fallback must read a DIRECT child of the row')
  assert(client.includes("if (/title/i.test(String(child.className || ''))) return String(child.textContent || '').trim()"), 'the title fallback must match the row\'s own title slot only, never the hover-card preview')
  assert(client.includes('openSessionRecordsTab?.()'), 'a refusal must open the guaranteed path instead of dead-ending')
  assert(client.includes("installTaskHiveSkin(ctx, () => service.openTab({ type: 'taskhive:sessions'"), 'the skin must receive the tab opener')

  // ── 10. T094: 应用内对话框（不许再用浏览器原生弹窗）+ 先删文件后归档 ──────
  // 用户口径："我要的是 harness 长出了新皮肤，不要给我把弹窗做成其他 ui"。
  assert(client.includes('function showTaskHiveDialog(options = {})'), 'the plugin must render its own dialog instead of using native browser dialogs')
  assert(client.includes("root.style.cssText = 'position:fixed;inset:0;z-index:2147483600;"), 'the dialog must be an in-page overlay, not a native popup')
  assert(client.includes("setAttribute('aria-modal', 'true')"), 'the dialog must be a real modal for assistive tech')
  assert(client.includes("if (event.key === 'Escape')"), 'the dialog must support Escape')
  assert(client.includes("root.addEventListener('mousedown', (event) => { if (event.target === root) dismiss(false) })"), 'the dialog must support click-outside dismissal')
  assert(!client.includes('window.alert(') && !client.includes('window.confirm('), 'no native alert/confirm may remain anywhere in the plugin')
  assert(source.includes('/^session\\.v\\d+\\.jsonl(?:\\.zstd)?$/i'), 'the host must accept any session.v<N> log version, not just v3')
  // 顺序：先删文件、后归档。反过来会造成"行消失了但其实只归档了"的假象。
  assert(client.includes('for (const row of result.deleted)'), 'archiving must only happen for sessions whose FILES were actually deleted')
  assert(!client.includes('for (const row of selectedRows) { try { await uiWorkspace.archiveSession'), 'the panel must not archive before purging')
  assert(!client.includes('await ctx.uiWorkspace.archiveSession(resolved.id) } catch { /* 归档是尽力而为，失败也继续删文件 */ }'), 'the menu path must not archive before purging either')
  assert(client.includes('宿主未响应，请重启 TaskHive 后重试'), 'a null response must be explained accurately instead of blaming the route generically')

  // ── 11. T095: 确认框只说确认，面板要有真正的外观 ──────────────────────────
  // 用户口径："删除会话界面做的太粗糙了，而且只需要提示确认删除就行，不要有无关文本"。
  assert(client.includes('message: `确认删除选中的 ${selectedRows.length} 个会话？`'), 'the panel confirm must only ask for confirmation')
  assert(!client.includes('这不是归档'), 'the "not archiving" explanation must be gone from the dialog')
  assert(!client.includes('已取消删除，未改动任何文件'), 'refusals must be one short line, not a paragraph')
  assert(!client.includes('存储根目录'), 'the storage root must not be printed as body text')
  assert(client.includes("className: 'th-sess-sum', title: data?.root || ''"), 'the storage root belongs in a tooltip')
  assert(client.includes('function installSessionPanelStyle()'), 'the panel must get a real stylesheet instead of inline-styled boxes')
  assert(client.includes("'data-taskhive-sessions': 'true'"), 'the panel root must be styleable by that stylesheet')
  assert(client.includes('data-selected'), 'rows must expose a selected state for styling')
  assert(client.includes("className: 'th-sess-actions'"), 'the delete action must live in its own action bar')
  assert(client.includes('[data-taskhive-sessions="true"] .th-sess-row:hover{background:'), 'the stylesheet must define hover feedback')
  assert(client.includes('[data-taskhive-sessions="true"] .th-sess-row[data-selected="true"]{background:'), 'the stylesheet must highlight selected rows')
  assert(client.includes('.th-sess-btn:focus-visible{outline:2px solid'), 'the stylesheet must keep a visible keyboard focus ring')

  process.stdout.write('session records purge contract passed\n')
}

main().catch((error) => {
  process.stderr.write(`session records purge contract failed: ${error?.stack || error}\n`)
  process.exitCode = 1
})
