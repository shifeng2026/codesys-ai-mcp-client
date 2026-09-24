# TaskHive 重点问题日志（KNOWN ISSUES）

**用途**：记录"症状模糊、但根因明确且**会复发**"的高影响故障，并给出**一条命令**的定位路径。
**规则**：每条问题必须写全「症状 / 30 秒定位 / 根因 / 为什么难查 / 修复位置 / 验证证据 / 复发信号」。
**新增问题**：复制文末模板追加，并在下表登记一行。

## 索引

| # | 症状 | 根因一句话 | 定位命令 | 状态 |
|---|---|---|---|---|
| 1 | 打开 TaskHive 后窗口内**什么都不显示**（白屏） | 累积的 `dsh-auth-*` Cookie 使请求头超过宿主 16KB 上限 → HTTP 431 → 空文档 | `node tools/inspect-workbench.mjs` | 已修复 2026-09-14 |
| 2 | **看不到模型的思考过程**（Think 行不出现，或只在结束后出现） | 先分清是「源头没给内容」还是「显示时机/渲染」问题 | `node tools/inspect-session.mjs --blocks` | 已定位：codex-cli 经第三方网关拿不到思考；pi-ai 路由可用 |
| 3 | 思考行一旦展开就**收不回去**（点收起又被自动展开） | TaskHive 的 disclosure seam 自动点击覆盖了用户操作，且重试计数被"匹配即清零" | 见下（读 `aria-expanded` 或看 seam 代码） | 已修复 2026-09-14 |
| 4 | **模型运行失败**（提问后整轮无产出） | 多数是 CLI 路由的请求超时撞上慢网关——先从会话事件读 `turn/end` 的 reason | `node tools/inspect-session.mjs --raw`（`turn/end` 的 `reason.error.message`） | 已修复 2026-09-14（超时 120s→300s，可覆盖） |
| 5 | 切到 **DeepSeek 模型**后，输入框的**模型选择消失/变成 "TaskHive"** | 品牌清理 seam 只按文本判断，把"模型名里的 DeepSeek"当成厂商品牌，隐藏了模型座位（或覆盖了它所在的行） | `node tools/inspect-branding.mjs` | 已修复 2026-09-14 |
| 6 | 启动长时间停在**"正在启动核心服务"**，偶尔直接以**"运行时未能就绪"**失败 | 就绪超时写死 90 s，而冷启动要读 244 MB / 31,767 个文件的运行时载荷，实测最慢 86.05 s（余量不足 4 %） | `Get-Content resources\app\logs\harness-runtime.log -Tail 6`（看 `ready elapsedMs`） | 已修复 2026-09-17（默认 90 s→180 s） |
| 7 | 输入框的**模型选择器消失**，且"设置里明明选着某个模型" | `models:set-visible` 没有守卫，可以把**当前默认路由正在用的模型**隐藏，使 `defaultRoute` 指向一个看不见的模型 | `node -e "const c=require('./profiles/model-catalog.json');console.log(c.defaultRoute,c.visibility[c.defaultRoute.providerId+'::'+c.defaultRoute.modelId])"`（在 `resources/app` 下执行；输出 `false` 即命中） | 已修复 2026-09-17（补守卫 + 契约断言） |
| 8 | 调 `taskhive_codesys_workbench` 取**工程快照**，`projectSnapshot` 恒为 `null`，但 `openObject` 正常刷新 | "已发布"记的是**意图**而不是**送达**：签名一变就推进标记，而发送是 900 ms 合并式防抖，被后一次挤掉就永不补发 | `Select-String -Path resources\app\plugins\installed\taskhive-surfaces\dsh\client.js -Pattern 'publishedSnapshotRef'`（命中=已回退） | 已修复 2026-09-18 |
| 9 | 会话栏删除会话提示**"宿主未响应，请重启 TaskHive 后重试"**，而**重启无效**；「会话记录」标签也读不到数据 | 客户端把会话路径拼在 **workbench 基址**后面，拼出宿主不认识的 URL → 每个请求都 404 | 对活着的 harness POST 两条路径对比：`/taskhive/api/sessions.list` = 200，`/taskhive/api/codesys.workbench/sessions.list` = 404 | 已修复 2026-09-18 |
| 10 | 工作台里改了对象，**切到别的对象后这份"待写入"就丢了**（内容变回磁盘原文，写入也不包含它），而树上的琥珀色徽章还在 | 编辑器草稿只有**两份全局字符串**，切换对象时被下一个对象的文本覆盖且无处保存；写入集合又只由"当前选中对象"构造 | `Select-String -Path resources\app\plugins\installed\taskhive-surfaces\dsh\client.js -Pattern 'draftsRef'`（找不到=已回退） | 已修复 2026-09-20 |

> 通用排查顺序：`logs/errors.log` → `logs/renderer-console.log` → `logs/harness-runtime.log` → `logs/desktop.log` → `tools/inspect-workbench.mjs`。

---

## 问题 #1：打开后窗口内"什么都没有"（HTTP 431）

### 症状（用户视角）

- TaskHive 能启动，进程在，日志里 Harness 显示 `ready`，**但窗口里没有任何内容**：没有会话、没有输入框、没有侧栏。
- 自动化冒烟在 `probe-harness-frames` / `probe-sidebar-plugin-labels` 阶段失败或卡住。
- `logs/renderer-console.log` **没有任何报错**（原因见下文"为什么难查"第 2 条）。

### 30 秒定位

```powershell
# 1) 带调试端口启动
TaskHive.exe --remote-debugging-port=9222
# 2) 一条命令给出结论
node resources\app\tools\inspect-workbench.mjs
```

看到 `VERDICT : WORKBENCH EMPTY (status 431)` 即命中本问题。
或直接看 `logs/errors.log`：启动自检会写入
`workbench rendered an empty document: HTTP 431 request headers too large — stale dsh-auth-* cookies (see docs/KNOWN-ISSUES.md issue #1)`。

### 根因

1. 宿主 DSH **每次启动铸造一个** `dsh-auth-<token>` Cookie（约 173 字节），作用域是 `127.0.0.1`。
2. **Cookie 忽略端口**：所有启动写入的都是同一主机下的 Cookie，且**从不过期、从不清理**。
3. 于是**每次请求都带上全部**历史 Cookie。
4. 一旦 `Cookie` 头超过宿主 Node 的请求头上限（默认 16KB），服务器对**每个**请求返回
   `431 Request Header Fields Too Large`，响应体为空 → 浏览器拿到一个空文档 → **白屏**。

### 为什么难查（三条关键经验，后续同类问题通用）

1. **命令行抓取会骗你。** `Invoke-WebRequest` / `curl` 不带 Cookie，返回 200 和 26KB 页面，
   看起来"服务完全正常"。必须在**带 Cookie 的浏览器上下文**里观察，才能看到 431。
   判断服务是否真的健康，要区分「服务能响应」与「浏览器能渲染」。
2. **渲染进程日志是哑的（已修）。** `app/main.js` 用的是 Electron 30 之前的位置参数签名
   `(event, level, message, line, sourceId)`，而 Electron 43 传的是 details 对象，
   导致 `level >= 2` 永远为假 —— **`renderer-console.log` 从来没有记录过任何渲染错误**。
   这次白屏全程零线索，正是这个原因。
3. **启动日志会误导。** `harness.runtime.ready` 只说明 HTTP 监听起来了，`main-window-created`
   只说明窗口对象建好了；两者都**不代表页面渲染成功**。

### 触发条件

**不需要任何代码改动。** 任何"多次启动"的累积都会命中；本次是当天 09:22–13:33 的多次启动
加上 4 个泄漏未退出的 smoke 实例，把 Cookie 总量推过了 16KB 阈值。
（另注：残留的 smoke 实例既累积 Cookie 又占资源，排查前先确认没有残留进程。）

### 修复（两层）

1. **根因修复** —— `app/main.js` 的 `createWindow()`，在 `loadURL` 之前清掉陈旧 Cookie，只保留本次启动的一个：

   ```js
   const workbenchSession = mainWindow.webContents.session;
   workbenchSession.cookies.get({ url: 'http://127.0.0.1' })
     .then((cookies) => Promise.all(cookies
       .filter((cookie) => String(cookie.name || '').startsWith('dsh-auth-'))
       .map((cookie) => workbenchSession.cookies.remove('http://127.0.0.1', cookie.name).catch(() => undefined))))
     .catch((error) => reportBootstrapProblem(`stale harness cookie cleanup failed: ${error?.message || error}`))
     .then(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(workbenchUrl); });
   ```

2. **自动报警** —— 同文件 `diagnoseBlankWorkbench()`，在 `did-finish-load` 后测量文档；
   若为空，就把导航状态、Cookie 数、`dsh-auth-*` 头长度写进 `logs/errors.log` 并指向本文件。
   即"下次再出现，日志自己会说出原因"。

### 验证证据（2026-09-14 实测）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 导航状态 `navStatus` | **431** | **200** |
| `document.body.innerHTML` 长度 | **0** | ≈111899 |
| `document.scripts.length` | **0** | 7 |
| `window.__ModuleLoader__` | 不存在 | 存在 |
| `__TASKHIVE_SURFACES_REGISTERED__` | false | **true** |
| Cookie 数 / `Cookie` 头字节 | 56 个 / ≈12768 | **1 个 / ≈228**（连续两次启动后仍为 1） |
| 完整 smoke（10 阶段） | 在第 2 阶段失败 | **全部完成**，`electron-smoke.json ok=true` |
| `logs/dsh-frame-probe.json` | 3795 字节（空 body） | **202800 字节** |
| `logs/ui-chat.png` | 未生成 | 重新生成（145KB） |
| 全量契约测试 | — | 28 个测试文件 exit 0 |

### 复发信号

- `logs/errors.log` 出现 `workbench rendered an empty document: HTTP 431 ...`
- `node tools/inspect-workbench.mjs` 报 `WORKBENCH EMPTY (status 431)`
- 若 Cookie 清理被回退：`dsh-auth` Cookie 数会随启动次数**单调增长**（可在工具输出里看到 `dsh-auth=N` 持续变大）。

### 先区分：几个相似但不同的现象

| 现象 | 区别 | 该看什么 |
|---|---|---|
| 窗口空白，但工具显示 `bodyHtml` 很大 | 页面渲染成功，属布局 / 插件面问题 | `logs/dsh-frame-probe.json`、`logs/ui-chat.png` |
| 页面显示 "authentication required" | URL 丢了 token（会有文字） | `harness.runtime.ready` 里的 `authUrl` |
| 窗口完全打不开 | Electron 主进程问题 | `logs/desktop.log`、`logs/errors.log` |
| 模型列表为空但界面正常 | 模型目录 / live 刷新问题 | `logs/errors.log` 中的 `模型目录...` 行 |

### 配套工具

- `tools/inspect-workbench.mjs` —— 一条命令输出：导航状态、文档渲染量、
  Cookie 负载、渲染进程报错，并给出 `WORKBENCH OK` / `WORKBENCH EMPTY` 结论。

---

## 问题 #2：看不到模型的思考过程

### 症状（用户视角）

- 提问后 Think 行（思考折叠行）完全不出现，或整段思考只在**回答完成那一刻**一起出现。
- 有时字号很小、只有一行——因为模型实际只思考了几十 token（见下"档位"）。

### 30 秒定位（先分清"源头"还是"显示"）

```powershell
node resources\app\tools\inspect-session.mjs --blocks      # 默认取最新会话
```

看每个 assistant turn 的 `blocks=[...]`：

- 若**没有 `reasoning(...)`** → **源头没给内容**，与界面/适配器无关（继续看"根因 A/B"）。
- 若有 `reasoning(N)` 但界面不显示 → 客户端渲染问题（看 `logs/renderer-console.log`）。
- 用 web-ai 模型发一句话可验证显示链路：它会发一条进度播报作为 reasoning 块，能看到 Think 行即说明显示正常。

### 根因（三种，互不排斥）

**A. 源头不提供思考内容（最常见，codex-cli + 第三方网关）**
本机 Codex CLI 自带元数据里 `gpt-5.6-sol` 的 **`default_reasoning_summary = "none"`** —— 默认既不请求也不转发思考摘要。
实测（2026-09-14）真实调用 `codex exec --json -c model_reasoning_summary=detailed`：
开关被接受（退出码 0），但事件里**只有** `thread.started / turn.started / item.completed(agent_message) / turn.completed`，
**没有任何 reasoning item**。该网关（`ai.discover-42.com`，`wire_api="responses"`）不转发思考摘要。
→ 这条路由**拿不到**思考，换路由（见"可用替代"）。

**B. 显示时机**：TaskHive 适配器原本把整块思考在**轮末**才发。2026-09-14 已**四条路由全部改为实时**：
`codex-cli` / `claude-code` 逐行竞速 + 增量发射；`catalog` / `anthropic` 改为 `stream: true` + SSE/NDJSON 解析，
按 delta 发射。若某路由仍只在轮末出现，先确认该网关是否真的流式——**网关忽略 `stream: true` 时按设计回落到
缓冲路径**（此时没有中间态可发，属正常）。

**C. 档位（effort）**：`codex-cli` 路由**没有把 UI 上的档位传给 CLI**（已知缺陷）——CLI 固定用 `config.toml` 的
`model_reasoning_effort`。档位低时模型只思考几十 token（实测 81 / 99 tokens），即使能拿到也几乎没内容。
修这个缺陷需要先验证 CLI 侧行为（实测 `model_reasoning_effort=high` 时该网关调用会挂住），不要在默认路由上盲改。

### 可用替代（要立刻看到实时思考）

用 `llm-pi-ai` 的 deepseek 路由（`settings.yaml` 里已配好）：DSH 原生适配器会把 provider 的 `thinking` 块映射为核心
`reasoning` 块并**流式**下发（`@deepseek-ai/dsh-llm-pi-ai` 发 `block-start{blockType:"reasoning"}` + `reasoning-delta`）。
TaskHive 自己的适配器改动**不适用于**这条路由。

### 复发信号

- `tools/inspect-session.mjs --blocks` 里 assistant turn 长期只有 `text(...)`，同时 usage 里却有 reasoning tokens
  → 就是"模型思考了但源头没转发"，属 A 类，不必再查界面。
- 若某条路由开始出现 `reasoning(N)`，说明源头已提供内容；此时若界面仍不显示，按 B/客户端问题查。

### 为什么难查

"没有思考"有三个完全不同的层次（源头 / 适配器时机 / 界面渲染），而它们从用户视角看起来一模一样。
**必须先从会话记录确认 content 里有没有 reasoning 块**，再谈后两层——这也是 `inspect-session.mjs` 存在的原因。

---

## 问题 #3：思考行一旦展开就收不回去

### 症状（用户视角）

- 流式思考期间点开 Think 行（"Deep diving..."）后，再点收起会被**立刻重新展开**，反复无效。
- 有时思考结束后也收不回去。

### 30 秒定位

```powershell
# 在窗口里直接读那个 disclosure 的真实状态（需要调试端口）
TaskHive.exe --remote-debugging-port=9222
# 然后对 [data-variant="think"] 的 trigger 读 aria-expanded，手动点一次再读：
#   值始终为 true（或立刻回到 true）→ 就是本问题
```

或直接看代码：`plugins/installed/taskhive-surfaces/dsh/client.js` 的 `syncDeepDivingDisclosures`。

### 根因

TaskHive 的 disclosure seam 会按 `shouldExpand = (data-state === 'running')` **强制**展开/收起，用 `trigger.click()` 纠正。
问题出在它的重试上限**形同虚设**：

```js
if (isExpanded === shouldExpand) { deepDivingAttempts.set(thinkRoot, { state, count: 0 }); continue }  // ← 匹配就把计数清零
...
if (count >= 2) continue
trigger.click()
```

自动点击成功后状态匹配 → 计数被清零 → 用户下一次手动折叠又从 count=0 开始 → 自动点击**永远抢在用户前面**重新展开。

### 为什么"现在"才明显（重要）

思考块以前是**轮末一次性到达**（`data-state="running"` 只闪一下），所以抢点击的窗口极短；
2026-09-14 把思考改为**实时流式**后，`running` 覆盖整个思考期，抢点击变成持续状态，症状才变成"一旦打开就收不回"。
即：**新功能暴露了既有缺陷**，不是流式本身的问题。

### 修复

`taskhive-surfaces/dsh/client.js`：

1. **手动点击永久优先**：在 trigger 上挂捕获相位的 click 监听，只认 `event.isTrusted === true` 的**真实点击**
   （seam 自己的 `trigger.click()` 是 `isTrusted=false`，不会误判），置 `dataset.taskhiveManualDisclosure`；
   之后该 disclosure 一律跳过自动驱动。标签文案在手动控制下改为描述**真实**展开状态。
2. **去掉"匹配即清零"**：重试计数只在 `state` 变化时重置，使每状态最多 2 次的重试上限真正生效
   （仍保留其防 MutationObserver 死循环的作用）。

### 验证证据（2026-09-14）

| 检查 | 结果 | 证据 |
|---|---|---|
| `skin-performance-contract.js`（新增 3 条断言） | 通过 | 断言只认真实点击、手动后停止自动驱动、且不得恢复"匹配即清零" |
| `npm test`（全量 28 个测试文件） | 通过 | 退出码 0 |
| 运行时实测 | **未做** | 需要真实思考块；codex 路由拿不到（见问题 #2），需在 pi-ai 路由上人工确认一次 |

### 更新（同日，第二次修复 —— 第一次修法不可靠）

**第一次修法（T059）为什么没解决**：它把"用户已手动操作"记在 **DOM 节点**上
（`dataset.taskhiveManualDisclosure` + 以节点为键的 `WeakMap` 重试计数）。而思考行在**流式期间会被 React 重建**
（每个 reasoning delta 都会让该子树重新渲染），标记与计数随之丢失 → 自动驱动继续抢点击 →
**"展开了依然收不回去"**。

**第二次修法（当前）**：让这个 seam **彻底不再点击思考行**（删除 `trigger.click()` 与全部重试簿记）。
展开与否完全由用户决定；折叠状态下该行本来就会渲染 running 摘要（DSH `ReasoningRow` 的 `collapsedContent`），
所以不自动展开**不丢任何进度信息**，也就从根本上不可能再与用户抢。

契约断言从"手动优先"改为更强的不变量：**该函数体内不得出现 `.click()`**，且重试簿记不得回归。

**仍未做**：运行时实测（需要页面上有真实思考行；codex 路由没有 reasoning 块）。若重启后仍无法折叠，
用 `TaskHive.exe --remote-debugging-port=9222` 启动，即可直接读该行 `aria-expanded` 与点击行为来定位。

### 复发信号（#3）

- Think 行再次"收不回去" → 首要检查该 seam 里**是否又出现了 `.click()`**（契约测试已硬断言禁止）。
- 若行本身能切换但立刻回弹，且 seam 确实没有点击 → 说明回弹来自别处（例如 DSH 自己的 turn-process 折叠，
  其开合状态按 `(turn, answerStep)` 存在 store 里，turn 推进时 answerStep 变化会让它重新展开）；
  此时用调试端口读 `aria-expanded` 与 `[data-variant]` 归属来区分是哪一行。

### 顺带发现的不一致（未改）

`probeDeepDivingDisclosure`（`app/main.js`）断言页面里**不得存在** `[data-taskhive-deep-diving]` 或
`[data-taskhive-public-reasoning]`，而该 seam 恰恰会给 Think 行打上这两个标记。目前 smoke 通过只是因为
**codex 路由没有任何思考块**，标记路径从未被走到；一旦有真实思考块，这条 smoke 断言就会失败。修它需要
先决定哪一侧是预期行为（改探针 or 改标记名，后者会破坏 1.0.2 公共 seam）。

---

## 问题 #4：模型运行失败（整轮无产出）

### 症状（用户视角）

- 提问后**没有任何回答**，界面提示模型运行失败；会话里连一条 assistant 消息都没有。

### 30 秒定位

```powershell
node resources\app\tools\inspect-session.mjs --raw        # 最新会话的全部事件
```

看两处：

- `turn/end` 的 `data.reason.error.message` —— **这就是真正的失败原因**（例如
  `Codex 模型在 120 秒内未完成`）。
- `assistant/attempt` 的 `data.stream[].chunk.finish.reason.failure.message` —— 同一原因的另一处记录。

有 `user/message` 与 `request/header`、但没有 `assistant/message` → 请求发出去了、模型侧没回来，属本类问题。

### 根因（本次实测）

**CLI 类路由的请求超时撞上慢网关。** 本机经 Codex CLI 走 `ai.discover-42.com`（`wire_api="responses"`），
一句"回复 OK"的真实耗时：

| effort | 耗时 |
|---|---|
| high | 46.2s |
| medium | 52.4s |
| low | 79.4s / >100s / >150s（同一提示重复三次，波动极大） |

而该路由原本写死 `MODEL_REQUEST_TIMEOUT_MS = 120000`（120 秒），于是**普通提问会随机失败**。

### 修复

`plugins/installed/taskhive-codex-model/dsh/index.js`：超时默认 **120s → 300s**，并支持按安装覆盖：

```js
const MODEL_REQUEST_TIMEOUT_MS = (() => {
  const configured = Number.parseInt(process.env.TASKHIVE_MODEL_TIMEOUT_MS || '', 10)
  return Number.isFinite(configured) && configured >= 10000 ? configured : 300000
})()
```

保留上限的意义在于"真正卡住的子进程不能永远占住这一轮"，而用户随时可以取消，所以放宽默认值是安全的。

### 排查时容易误判的两点

1. **不要先怀疑参数。** 本次同期新增了 `-c model_reasoning_effort=<档位>` 透传，看似可疑；但该模型自带元数据
   `supported_reasoning_levels` **明确包含 `low`**，且同一参数重复三次的结果是"超时/超时/79 秒成功"——
   属网关延迟波动，不是非法取值。
2. **不要只看 `errors.log`。** 模型侧失败不会写进 `logs/errors.log`（那是 Electron 主进程的启动日志），
   必须读会话事件。

### 复发信号

- `turn/end` 的 reason 为 `TIMEOUT`（消息形如 `... 在 N 秒内未完成`）→ 网关比 N 秒还慢，调大
  `TASKHIVE_MODEL_TIMEOUT_MS`，或换更快的路由（`llm-pi-ai` 的 deepseek 路由不经 CLI）。
- 若 reason 变成 `AUTH` / `MODEL_NOT_FOUND` / `TRANSPORT` 等，则**不是**超时问题，按对应 code 分流。

---

## 问题 #5：切到 DeepSeek 模型后输入框模型选择消失/变成 "TaskHive"

### 症状（用户视角）

- 输入框里的**模型选择器不见了**；有时原地只剩一个 "TaskHive" 字样，看起来像"模型选择变成了 TaskHive"。
- **切回非 DeepSeek 的模型（如 codex 的 GPT-5.5）就恢复正常** —— 这是本条最强的信号。
- 左栏/侧栏的 TaskHive 品牌仍然正常，其它界面也没有异常。

### 30 秒定位

```bash
# 1) 带调试端口启动（还没重启过就先重启，客户端脚本改动不会热更新到已打开窗口）
TaskHive.exe --remote-debugging-port=9222
# 2) 一条命令给出结论
node tools/inspect-branding.mjs
```

输出里看三行：

- `model controls (N)` —— 若为空，或某条带 `HIDDEN BY …`，模型座位已被隐藏。
- `nodes the vendor finder sees` —— 出现 `exact=false size=true` 的条目（典型是
  `BUTTON._7KE1Ra_trigger {"w":189,"h":28} text="DeepSeek V4 Flash"`）就是被误伤的模型座位。
- `VERDICT` —— 会直接给出 `NO VISIBLE MODEL CONTROL` 或 `VENDOR FINDER RISK`。

**不便开端口时的替代**：读 `logs/ui-branding-probe.json` 的 `brandAudit.deepSeekTextNodes`。
它会列出页面上每个可见的 DeepSeek 文本节点及其父节点；如果父节点是
`BUTTON` 且 `aria-label` 形如 `选择模型，当前 DeepSeek V4 Flash…`，那就是模型座位。

### 根因

输入框的**模型座位渲染的就是"所选模型自己的名字"**，所以选了 DeepSeek 模型之后，厂商名就出现在了一个**控件**里。
TaskHive 的皮肤 seam 要用 TaskHive 品牌替换厂商字样，而它的三条机制**只按文本判断**，于是把模型选择当成了品牌：

| # | 机制（修复前） | 后果 |
|---|---|---|
| 1 | `replaceComposerBrand` 命中输入框标语（`探索未至之境`）后执行 `container.innerHTML = brandSpanMarkup()` | 标语与模型座位**在同一行**，整行被覆盖 → 模型选择被删除，原地只剩 TaskHive 字标 |
| 2 | 通用 vendor finder 用 `/deepseek/i` 匹配**任意**含该词的节点（宽 40–360、高 <100），命中后把 `target.style.display='none'`，再插入 TaskHive 字标 | 模型座位/其所在行被隐藏并被替换（**已在真实 DOM 上证实**：模型座位是 189×28 的 BUTTON，逐条满足该谓词） |
| 3 | `hideResidualBrandText` 的裸词规则 `^(deepseek|harness)$` | 文本恰为 "deepseek" 的模型标签被直接隐藏 |

### 为什么难查

- **只在特定模型下出现**：默认路由（codex-cli）页面上根本没有 DeepSeek 文本，所以冒烟探针里
  `deepSeekTextNodes` 一直是空的，看起来"品牌清理没问题"。
- **失败发生在浏览器侧的客户端脚本**，不在主进程、不写 `errors.log`；不看真实 DOM 只能靠猜。
- 症状像"模型目录坏了"，容易被引到模型注册/热刷新那条完全不相干的路径上。

### 触发条件

任何"模型显示名里含 `DeepSeek`"的路由都会触发，例如
`deepseek-official/deepseek-v4-flash`（用户默认）、`deepseek-api/deepseek-chat`、
`ollama-local/deepseek-coder-v2`。与模型是否真的可用、API Key 是否配置无关。

### 修复（文件 + 代码位置）

`plugins/installed/taskhive-surfaces/dsh/client.js`：

1. 新增豁免名单
   `BRAND_SCRUB_EXEMPT = 'button,[role="button"],[role="combobox"],[aria-haspopup],[role="listbox"],[role="menu"],[role="dialog"],[aria-modal="true"],[data-slot*="model" i]'`
   —— **任何控件都不是品牌**。
2. `replaceComposerBrand` 改为只替换**命中的那个节点**（`original.innerHTML`），不再碰 `container`。
3. 新增严格厂商词表 `VENDOR_BRAND_TEXT = /^deepseek(?:\s+(?:harness|preview|beta))?$/i`；
   通用 vendor finder 由"包含 deepseek"改为"**就是**厂商词"，并要求该节点既不在豁免控件内、也不包含豁免控件。
4. `^(deepseek|harness)$` 分支隐藏前先 `node.closest(BRAND_SCRUB_EXEMPT)`。

### 验证证据（2026-09-14）

- **真实 DOM 取证**（隔离 packaged smoke，沿用用户默认模型 `deepseek-official/deepseek-v4-flash`）：
  `logs/ui-branding-probe.json` 的 `deepSeekTextNodes` 抓到
  `BUTTON._7KE1Ra_trigger`，`aria-label="选择模型，当前 DeepSeek V4 Flash，推理等级 Default"`，
  189×28，内含叶子节点 `DeepSeek V4 Flash` —— 旧谓词全部命中；修复后该按钮 `visible: true`，
  且 `composerBrandVisible: true / composerBrandText: "TaskHive"`（品牌替换照常生效）。
- `tests/brand-scrub-safety-contract.js`（15 项）：把 `VENDOR_BRAND_TEXT` 从源码抽出做**行为断言**
  —— 接受 `DeepSeek Harness` / `DeepSeek` / `deepseek`，拒绝 `DeepSeek V4 Flash` / `DeepSeek Chat` /
  `deepseek-reasoner` / `DeepSeek Coder V2`；并断言三条机制都带豁免、`replaceComposerBrand` 不再写 `container`。
- `npm test`（28 个测试文件）`exit=0`。

### 复发信号

- 又出现"某个模型下输入框选择器消失"，且该模型的显示名里含 DeepSeek → 直接跑 `tools/inspect-branding.mjs`。
- `inspect-branding.mjs` 的 `nodes the vendor finder sees` 里出现 `exact=false` 的条目 →
  有人又把"包含 deepseek"的宽松匹配加回来了（契约测试会同时失败）。
- 左栏品牌正常、只有输入框异常 → 优先怀疑第 1 条机制（同行覆盖），检查 `[data-taskhive-composer-brand="true"]` 的父节点里是否还有模型控件。

### 回归修复（同日，T064 的副作用 —— 对话标题又出现 DeepSeek 图标）

**症状**：T064 修好模型选择器之后，**对话界面的标题（hero headline）里又出现了 DeepSeek 图标**。

**根因**：DSH 的 `HeroShell` 把三样东西放在**同一个 `div.headline` 里**：

```js
div.headline
  ├─ span.fishHitbox  → renderSlot("conversation.hero.brand.mark", {size:34}, { fallback: HeroFish })  ← 厂商图标
  ├─ span.headlineText → t("hero.headline")                                                             ← "探索未至之境"
  └─ span.previewBadge → t("hero.preview")                                                              ← "预览版"
```

修复前的 `replaceComposerBrand` 做的是"把 container 的 innerHTML 整个换掉"（container = `div.headline`），
所以**厂商图标是被"顺手"删掉的**，不是被专门处理的。T064 把它改成"只重写命中的标语节点"之后，图标就回来了
—— 图标消失从来不是那条 seam 的功劳，只是它的附带损害。

**修复（两次；第一次不完整，记录教训）**：

1. **第一次（不完整）**：只把该槽位的厂商子节点 `display:none`，**不插自己的图标**，以为同行标语的 seam 会补上品牌。
   真实 DOM 证明这样不行：`span.fishHitbox` 是 `display:flex; width:34px`，子节点被隐藏后**留下一个 34×34 的空洞**
   （实测 `rect = {x:389,y:271,w:34,h:0}`），而标语的 seam 把 `<img 24px>` 写进了 `span.headlineText`
   —— 那是 `display:block` 的网格项，于是**图标叠在文字上方**（实测图标 y=260、文字 y=283）。用户看到的正是
   "TaskHive 图标不在正确位置"。
2. **最终修复**：把 TaskHive 图标**放进厂商刚腾出的那个槽位**，尺寸取 DSH 自己传给该槽位的 `size`：

   - 新增 `HERO_MARK_SIZE = 34` 与 `heroMarkMarkup()`（有真实图标用 `<img>`，没有则把中性字形缩放到 34）；
   - `ensureHeroBrandMark()`：隐藏厂商子节点（**不删除**，React 协调安全）→ 若我们的图标还不是 `IMG` 就
     `insertAdjacentHTML('beforeend', heroMarkMarkup())`（只删自己上一轮的占位）；
   - `replaceComposerBrand` 改为只写**文字标记** `brandWordmarkMarkup`（`<span data-taskhive-brand-text>TaskHive</span>`），
     不再把 `<img>` 塞进文字节点；
   - 全部挂进 `reconcileSidebarBrand()`，每轮 scrub / 品牌 mutation / 1200·3000·6000ms 重试都覆盖。

**验证证据（2026-09-14，隔离实例 + CDP 实测 DOM）**：

| 对象 | 修复前 | 修复后 |
|---|---|---|
| `span.fishHitbox` | `{x:389,y:271,w:34,h:0}` —— 空洞 | `{x:389,y:271,w:34,h:34}` —— 被我们的图标撑起 |
| 槽位 `conversation.hero.brand.mark` 子节点 | 只剩被隐藏的厂商 `<svg>` | `[<svg display:none>, <img 34×34 display:block>]` |
| TaskHive 图标 | 24×24，位于 `headlineText` 内、**叠在文字上方** | 34×34，`{x:389,y:271}`，即厂商图标原位 |
| `span.headlineText` | 图标 + 文字两行（h=56） | 仅 `TaskHive` 文字（h=32），与图标同一行 |
| `previewBadge` | `display:none` | `display:none`（不变） |

行内布局：`[TaskHive 图标 34px @x=389][TaskHive 文字 @x=433]`，与厂商原布局同构（原为 `[鱼 34px][探索未至之境]`）。

`tests/brand-scrub-safety-contract.js` 由 20 → 24 项（槽位选择器名、只隐藏厂商节点、只删自己的占位、
必须写入 `heroMarkMarkup()`、尺寸必须是 34、中性字形必须同尺寸替换、品牌步骤必须包含它、
`replaceComposerBrand` 必须只写文字不含第二个图标）；`npm test` 28 个测试文件 `exit=0`。

### 先区分：几个相似但不同的现象

| 现象 | 实际是什么 | 去哪看 |
|---|---|---|
| 模型**下拉列表为空**或点开报错 | 模型目录/热刷新问题，不是本条 | `tests/model-catalog-live-refresh-contract.js`、`logs/errors.log` |
| 座位显示的是**另一个模型名** | 路由/默认模型（`agent-default-model`）问题 | `~/.dsh/settings.yaml`、`profiles/model-catalog.json` |
| 座位**在**但点不开、被右栏压住 | 插件右侧栏覆盖问题 | 问题 #1 的配套工具 + T041 记录 |
| 整个窗口白屏 | 不是本条 | 问题 #1（HTTP 431） |

---

## 问题 #6：启动长时间停在"正在启动核心服务"，偶尔以"运行时未能就绪"失败

### 症状（用户视角）

- 打开 TaskHive 后启动画面停留很久（半分钟到一分多钟）才进入界面；机器越"冷"越慢。
- 偶尔直接失败：启动画面显示"核心服务启动失败"，`logs/errors.log` 出现
  `FATAL startup Error: Harness/DSH 运行时未能就绪（state=stopped）`。
- 成功与失败之间**没有可复现的操作差异**：同一个 exe、同一天，紧接着再开一次就只要 4 秒。

### 30 秒定位

```powershell
Get-Content resources\app\logs\harness-runtime.log -Tail 6
```

读每次的 `ready elapsedMs=`：

| 读数 | 含义 |
|---|---|
| ~4200–4700 | 正常（热启动） |
| 44000–86000 | **冷启动**（本条） |
| 没有 `ready` 且 `errors.log` 有"未能就绪" | 已经撞上超时（本条的最坏结果） |

判断是不是冷启动：看本次 `launch` 与**上一次** `ready` 之间的时间间隔 —— 空闲越久越慢。

### 根因

`app/harness-runtime.js` 的 `launch()` 把就绪等待写死为 **90,000 ms**。而 TaskHive 的运行时载荷是
**244 MB / 31,767 个文件 / 2,504 个链接**，冷文件缓存下把这个树读进内存本身就要几十秒。
本机 118 次就绪的实测分布：

| 指标 | 值 |
|---|---|
| 最快 / 最慢 / 平均 | 3,849 ms / **86,051 ms** / 13,123 ms |
| 超过 20 s 的次数 | **16** 次（86.1 / 82.3 / 79.0 / 78.9 / 75.2 / 74.3 / 73.7 / 71.4 / 70.9 / 69.7 / 66.3 / 62.2 / 61.8 / 61.7 / 54.4 / 44.3 s） |
| 紧邻的连续启动 | 4,197–4,609 ms（全部正常） |

最慢的 86.05 s 距离 90 s 上限只剩 **3,949 ms（不足 4 %）**。一旦越过，`launch()` 会 `stop()` 掉子进程并抛出，
`main.js` 不创建窗口、直接抛致命错误 —— 就是 `errors.log` 里那条"未能就绪"。

**关键判据：慢启动期间子进程没有任何输出。** `launch` 与 `ready` 之间是空的（本机 16 次慢启动全部如此），
所以这不是插件树重试 —— 后者一定会打印堆栈（对比 2026-09-12 那次 `DUPLICATE_ADAPTER` 失败，日志里是完整 Node 堆栈）。
那 16 次纯粹是冷文件缓存下的磁盘读取。

### 为什么难查

1. **失败与成功之间没有操作差异**：同一个 exe、同一天，重启一次就好；很容易被当成"偶发卡死"或"模型/网络问题"。
2. **日志会误导**：`harness.runtime.ready` 只说明 HTTP 起来了；慢的时候它**最终**还是会出现，只是晚几十秒。
3. **历史记录把人带偏**：master 文档里"21–82 秒冷启动"曾被归因于插件树重试（那确实是当时的原因，已由 `--expose-internals` 修掉）。
   本条是**另一个**原因，症状相同、都在同一行日志里，只看结论会以为已经修过了。

### 修复

`app/harness-runtime.js` —— 默认就绪超时 `90000` → `180000`：

```js
const readinessTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
  ? configuredTimeout
  : 180000;
```

- `TASKHIVE_DSH_START_TIMEOUT_MS` 覆盖逻辑不变（仍要求 ≥ 1000）。
- `main.js:4500` 的 `await harnessRuntime.start()` **没有**自己的第二道超时，所以这一个值就是全部预算；改这里即生效。
- 翻倍只是把"真正的守卫"变回守卫：真卡住（磁盘故障、杀软锁文件）仍会在 180 s 失败并如实报错，不会永久挂起。

### 验证证据（2026-09-17，修复后）

| 检查 | 结果 |
|---|---|
| `TaskHive.exe --smoke` | `logs/electron-smoke.json` → `ok:true`、`runtime.state=ready`、`mainAlive:true`、`splashAlive:false`、`windows:1`；`desktop.log` → `smoke-autoclose ok=true` |
| 本次 `ready elapsedMs` | **27,432 ms**（仍是偏冷启动；按旧上限算余量已经不大） |
| `node tests/run-contracts.js` | exit 0（37 个测试文件） |
| `node tools/harness-slot-closure.js --check` | `result: PASS`（本修复在 slot 之外，摘要未变） |
| `logs/errors.log` | 启动后无新增行 |

### 复发信号

- `errors.log` 再次出现"运行时未能就绪" → 说明**已经超过 180 s**。此时不要再调大超时，改查磁盘 / 杀软 / 系统缓存压力。
- `harness-runtime.log` 出现 `elapsedMs` 超过 ~100 s **且 `launch` 与 `ready` 之间没有任何子进程输出** → 还是冷启动这一条。
- 若慢启动的区间里**出现了 Node 堆栈**（如 `plugin tree failed to load`）→ 那是插件树问题，**不是**本条。

### 先区分：相似但不同的现象

| 现象 | 实际是什么 |
|---|---|
| `launch` 之后有 error 堆栈、没有 `ready` | 插件树加载失败（如 `DUPLICATE_ADAPTER`），不是本条 |
| `ready elapsedMs` 很小但界面仍白屏 | 问题 #1（HTTP 431） |
| 每一次启动都慢，不分冷热 | 不是本条（本条只慢"空闲后的第一次"） |

---

## 问题 #7：输入框模型选择器消失 —— 默认路由指向了被隐藏的模型

### 症状（用户视角）

- 输入框里的模型选择器不见了／显示不出当前模型；去设置页看"模型可见性"又**完全正常**（那个模型确实是自己勾掉的）。
- 与问题 #5 **症状相同、根因不同**：#5 是客户端把含 `DeepSeek` 的控件当成品牌隐藏掉；本条是**数据不一致**。

### 30 秒定位

```powershell
cd resources\app
node -e "const c=require('./profiles/model-catalog.json');const k=c.defaultRoute.providerId+'::'+c.defaultRoute.modelId;console.log('defaultRoute =',k,'| visible =',c.visibility[k])"
```

输出 `visible = false` 即命中：**默认路由指向了一个被隐藏的模型**。

### 根因

两个方向只有一个方向有守卫（都在 `app/main.js`）：

| 处理器 | 行为 |
|---|---|
| `models:select` | 设为默认路由**前**拒绝隐藏的模型：`模型已在设置中隐藏，不能作为默认路由` |
| `models:set-visible` | 只写 `visibility[...] = input?.visible === true`，**不检查它是不是当前默认路由** |

于是"先选为默认、再去设置里把它隐藏"就会留下 `defaultRoute` 指向不可见模型的状态。本机这份 catalog 正是如此：
`defaultRoute = codex-cli/gpt-5.5` 而 `visibility['codex-cli::gpt-5.5'] = false`
（master 文档 2026-09-15 已把它记为"一处真实不一致…供用户处置"，本条即其处置）。

### 为什么难查

- 状态躺在 `profiles/model-catalog.json` 里，界面只反映**结果**：设置页显示"这个模型被隐藏了"是**正确**的，
  看不出它同时还是默认路由。
- 症状与问题 #5 一模一样，很容易一路查到品牌清理那条完全不相干的路径上。
- 它还会让契约测试看起来"莫名其妙地失败"：`model-routing-contract.js` 原来硬断言
  `visibility['codex-cli::gpt-5.5'] === true`，而**用户合法的勾选**会让它失败 —— 这正是 2026-09-15 那次
  "与本轮无关的失败"的真身（该断言与它自己下方"visibility 是用户状态、契约不应钉住某个布尔值"的注释互相矛盾）。

### 修复（文件 + 代码位置）

1. `app/main.js` —— `models:set-visible` 在隐藏前检查是否等于当前 `defaultRoute`，是则拒绝并提示先切换模型
   （与 `models:select` 的守卫对称）。
2. `profiles/model-catalog.json` —— 把 `codex-cli::gpt-5.5` 的可见性恢复为 `true`，让**现存状态立即满足不变量**；
   **运行时行为不变**（仍然路由到 gpt-5.5），只是让选择器重新显示它。用户若确实想隐藏它，先在输入框换一个模型即可。
3. `tests/model-routing-contract.js` —— 把"钉住某个布尔值"换成**不变量断言**（默认路由不得指向隐藏模型、
   且必须存在于目录中），并新增一条断言要求 `models:set-visible` **保留**这条守卫。

### 验证证据（2026-09-17）

| 检查 | 结果 |
|---|---|
| `node tests/run-contracts.js` | **exit 0**（37 个测试文件全过；修复前 `model-routing-contract.js` 失败） |
| `TaskHive.exe --smoke` | `ok:true`；且启动重写 catalog 之后 `gpt-5.5` 可见性仍为 `true`、`defaultRoute` 一致 |
| `profiles/model-catalog.json` 直接读取 | `defaultRoute = codex-cli/gpt-5.5`，`visible = true` |

### 复发信号

- 又出现"某个模型下选择器消失"，且该模型在设置里被隐藏 → 跑上面的 30 秒定位。
- `model-routing-contract.js` 里又出现钉住某个 `visibility` 布尔值的断言 → 契约被退回成"钉状态"而不是"钉机制"。

### 先区分：与问题 #5 的差别

| 检查 | #5（品牌清理） | #7（默认路由被隐藏） |
|---|---|---|
| 页面里该模型的控件 | 存在，但被 `display:none` 或整行被覆盖 | 存在，但被从可见列表里过滤掉 |
| `defaultRoute` 的可见性 | `true` | **`false`** |
| 换回非 DeepSeek 模型 | 恢复正常 | 取决于新模型是否可见 |

---

## 问题 #8：工程快照永远读不到（`projectSnapshot` 恒为 `null`），但 `openObject` 正常

### 症状（用户视角）

- 调 `taskhive_codesys_workbench` 并传 `include:"project-snapshot"`，返回里 `projectSnapshot` **恒为 `null`**，
  附注是"工作台尚未发布工程快照（未绑定工程、尚未读取工程树，或工作台未打开）"。
- 但**同一份返回里 `openObject` 完全正常**：在工作台里切换对象，它立刻跟着变；`updatedAt` 也在刷新。
- 所以"工作台没绑定工程"这个解释明显不成立 —— 绑定、会话、发布通道全都是通的，
  只有**工程级快照**这一条路没有动静。切换打开对象不会顺带触发它（它本来就不该触发：签名只看工程对象）。

### 30 秒定位

问两个问题：

1. `openObject` 在不在变？**在变** → 发布通道正常，不要再去查绑定 / 会话 / 路由。
2. 从工作台绑定工程到你现在提问，中间**刷新过页面或重启过客户端**吗？**没有** → 命中本条。

确认修复是否还在（修复前会命中）：

```powershell
Select-String -Path resources\app\plugins\installed\taskhive-surfaces\dsh\client.js -Pattern 'publishedSnapshotRef'
```

### 根因

工程快照约 28,000 字符，所以客户端只在**工程对象签名变化**时附带它（T088 的设计，避免每次选区/输入都重发几十 KB）。
缺陷在于把「打算发」当成了「已经发出去」：

| # | 环节 | 事实 |
|---|---|---|
| 1 | 推进时机 | 客户端在**构造 payload 的那一刻**就推进"已发布签名"（`publishedSnapshotRef.current = projectSnapshotSignature`） |
| 2 | 发送方式 | 真正的发送是 **900 ms 合并式防抖**（`CODESYS_PUBLISH_GAP_MS`；`publishCodesysState` 先 `clearTimeout` 再 `setTimeout`，同一窗口内**后一次覆盖前一次**） |
| 3 | 后果 | 只要签名变化后的 900 ms 内还有**任何**一次发布，携带快照的那一份就被丢掉；而签名已推进 → 后续发布永远不再附带它 |
| 4 | 为什么没人发现 | 绑定/读取工程树本来就会连续触发多次发布（选中对象、编辑区文本载入、changeStates 变化…），900 ms 内碰撞几乎是必然 |
| 5 | 宿主侧 | `publishWorkbenchState` 是**字段合并**（`{...previous.state, ...state}`），"字段缺席"会保留旧值 —— 但旧值**从来没被写入过**，于是 `projectSnapshot` 永久停在 `null` |
| 6 | 续期救不回来 | T089 的 5 分钟心跳只重发 `codesysStateKeepAlive.state`，即**最后一次**发布的那份，恰恰是不带快照的那份 |
| 7 | 全程静默 | `void codesysWorkbenchApi('publish', ...)` 从不看响应；而 `codesysWorkbenchApi` 在非 2xx / JSON 解析失败 / fetch 抛错 / 超过宿主 `WORKBENCH_MAX_BODY_BYTES`（512 KB）被拒时一律 `return null`，`logs/` 里不留任何痕迹 |

一句话：**"已发布"记的是意图而不是送达，而发送是可被覆盖的防抖** → 一次碰撞 = 这次绑定永久失去工程快照。

### 为什么难查

- 附注文本把人引向"没绑定工程 / 没读工程树 / 工作台没打开"，而那三件事其实都是好的 —— `openObject` 就是反证。
- 有 T089 的续期心跳在，看起来"状态总会被重发"，但它重发的正是那份不含快照的状态。
- 发布失败完全静默，日志里查不到。
- **契约测试把错误实现锁死了**：`codesys-workbench-ui-contract.js` 原先直接断言
  `client.includes('...(snapshotChanged ? { projectSnapshot } : {}),')` 与
  `publishedSnapshotRef.current !== projectSnapshotSignature` —— 断言的是**字符串形状**而不是**行为**，
  等于写死了"不许修"。这与问题 #7 里"钉住用户可编辑状态"是同一类错误。

### 修复（文件 + 代码位置）

`plugins/installed/taskhive-surfaces/dsh/client.js`：

1. 对比对象由"上一次**打算**发送的签名"改为宿主**已确认**接收的签名
   （`codesysStateKeepAlive.publishedSignature`）。
2. 新增 `pendingSnapshot`：签名一变就入队；**只要还没被确认就继续附带**它
   （值为 `null` 时也必须附带 —— 见 T089：换绑工程后要靠这个显式 `null` 清掉上一个工程的代码）。
3. 新增**唯一发行出口** `sendCodesysState()`：在**实际发送的那一刻**把 pending 快照并进 payload；
   只有收到宿主确认（`value.accepted !== false`）才推进 `publishedSignature` 并清空 pending；
   失败/被拒则**保留**，由下一次发布或心跳自动重试。
4. 防抖发送与 5 分钟心跳**都改走这个出口**（否则心跳会把不含快照的那份原样重发）。
5. 两个标记从组件 `ref` 移到插件层存储：心跳与组件共享同一份判断，且工作台标签重挂载不丢。

`tests/codesys-workbench-ui-contract.js`：把钉字符串的两条断言换成**不变量**断言（与已确认签名比较 /
pending 未确认就继续附带 / 标记只能在确认后推进 / 防抖与心跳共用同一出口），并新增
`!client.includes('publishedSnapshotRef')` 防止回退。

### 验证证据（2026-09-18）

| 检查 | 结果 |
|---|---|
| `node --check`（按 CJS 与 ESM 各一次） | exit 0 |
| `node tests/run-contracts.js` | **exit 0**（37 个测试文件全过） |
| `codesys-workbench-ui-contract.js`、`-link-`、`-compact-layout-`、`codesys-project-tree-contract.js`、`skin-performance-contract.js` | 全部通过 |
| 逻辑复现（一次性模拟脚本：把 OLD / NEW 两条发布路径放进同一个 900 ms 覆盖式防抖 + 合并式宿主，跑同一串"绑定工程时的连续发布"） | **OLD**：`projectSnapshot = null` 而 `openObject = AppendLog ✓`（与用户报告完全一致）；**NEW**：两者都有；且**首次发送失败时心跳能补送成功** |
| 运行时实测 | **未做** —— 修复时用户的客户端已在运行（进程启动早于本次改动），需要重启/刷新后由用户在真实工作台上确认一次 |

### 复发信号

- `Select-String ... -Pattern 'publishedSnapshotRef'` 再次命中 → 修复被回退。
- 又出现"`openObject` 正常但 `projectSnapshot` 恒 null" → 先跑 30 秒定位第 2 问（中间是否刷新过页面）。
- `projectSnapshot` 有值但内容是**上一个工程**的 → 那是 T089 的换绑清空路径，检查值为 `null` 时是否仍被发送。

### 先区分：相似但不同的现象

| 现象 | 实际是什么 |
|---|---|
| `openObject` 也是 `null`，附注说"工作台尚未发布状态" | 真的没绑定/没打开，或宿主状态已过 15 分钟 TTL |
| `projectSnapshot` 有值但 `textTruncated: true` | **正常**：28,000 字符上限截断，用 `index` 字段核对缺哪些对象 |
| 快照内容是别的工作台的工程 | 多会话串台：发布时带的 `sessionId` 与提问会话不一致 |

---

## 问题 #9：删除会话报"宿主未响应，请重启 TaskHive 后重试"（但重启无效）

### 症状（用户视角）

- 会话栏里点「彻底删除」→ `宿主未响应，请重启 TaskHive 后重试。`
- 「会话记录」标签页也读不到数据 → `读不到会话记录：宿主插件可能还是旧版本，请重启 TaskHive。`
- **重启没有任何作用**，提示语把方向带偏了：它让你怀疑插件版本，而真实原因是 URL 拼错。

### 30 秒定位：直接问活着的 harness

```powershell
$port = (Select-String -Path resources\app\logs\harness-runtime.log `
  -Pattern 'ready elapsedMs=\d+ url=http://127\.0\.0\.1:(\d+)/' |
  Select-Object -Last 1).Matches[0].Groups[1].Value
foreach ($p in @('/taskhive/api/sessions.list','/taskhive/api/codesys.workbench/sessions.list')) {
  $r = Invoke-WebRequest "http://127.0.0.1:$port$p" -Method POST `
    -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
  "{0} -> HTTP {1}" -f $p, $r.StatusCode
}
```

正确路径 `200`、错误路径 `404 unknown workbench API method ""` 即命中本条。
（`list` 是只读的；**不要**用 `purge` 做探测。）

### 根因

宿主把两个命名空间挂在**同一个受信任前缀** `/taskhive/api` 下，并在**同一个 handler** 里按前缀分派：

| 命名空间 | 宿主前缀 | 方法 |
|---|---|---|
| workbench | `${WORKBENCH_ROUTE}/codesys.workbench.`（**以点结尾**） | `codesys.workbench.publish` / `.pending` |
| sessions | `${WORKBENCH_ROUTE}/sessions.` | `sessions.list` / `sessions.purge` |

客户端却把会话路径拼在 **workbench 基址**后面：

```js
const CODESYS_WORKBENCH_API = '/taskhive/api/codesys.workbench'
fetch(`${CODESYS_WORKBENCH_API}/sessions.${method}`)
// → /taskhive/api/codesys.workbench/sessions.list
```

`…workbench/sessions.list` 在 "workbench" 之后是**斜杠**，而宿主的前缀是 `…workbench.`（**点**），
于是 workbench 分支与 sessions 分支**都不匹配** → 落进 404 兜底。
那条 404 的 `method` 是**空串**，正是"两个前缀都没匹配上"的指纹。

客户端 `sessionRecordsApi()` 在任何失败（非 2xx / JSON 解析失败 / fetch 抛错）时一律 `return null`，
所以三处调用**全部**变成 `null`：

1. 面板读取 → `读不到会话记录：宿主插件可能还是旧版本…`
2. 面板删除 → `删除失败：宿主未响应…`
3. **会话栏「…」菜单里的「彻底删除」** → `宿主未响应，请重启 TaskHive 后重试。`

即 T092 的整个"真删除"功能**从未工作过**。

### 为什么难查

1. **提示语主动误导**：它指向"重启 / 插件版本旧"，而这两件事都不可能修好一个 URL 拼写错误。
2. **契约测试把一个子串当成了接线证据**：`session-records-purge-contract.js` 原先断言
   `client.includes('/sessions.${method}')` —— 而错误写法
   `` `${CODESYS_WORKBENCH_API}/sessions.${method}` `` **也包含**这个子串，
   于是这条断言对**正确与错误两种写法同时成立**，等于盖章放行。
   （与问题 #7、#8 的"契约断言的是形状而不是行为"是同一类错误。）
3. 该合同文件的其余断言都在测**纯函数**（真删文件、越界保护、v2/v3 日志名），
   路由接线只有那一行静态子串 —— 唯一能抓住它的地方恰好是失效的。

### 修复（文件 + 代码位置）

`plugins/installed/taskhive-surfaces/dsh/client.js`：两个基址改为**派生自同一个字面量**。

```js
const TASKHIVE_API_BASE = '/taskhive/api'
const CODESYS_WORKBENCH_API = `${TASKHIVE_API_BASE}/codesys.workbench`
const CODESYS_SESSIONS_API = `${TASKHIVE_API_BASE}/sessions`
```

会话请求改为 `fetch(`${CODESYS_SESSIONS_API}.${method}`)`。

- `tests/session-records-purge-contract.js`：把子串断言换成**基址断言**，并新增
  "任何请求都不得把会话路径拼在 workbench 基址后面"（锚定 `fetch(`，以免被解释性注释误伤）。
- `tests/codesys-workbench-link-contract.js`：原先把 `CODESYS_WORKBENCH_API` 的**字面量**钉死，
  改为断言它由 `TASKHIVE_API_BASE` 派生，并要求 sessions 基址同样存在。

### 验证证据（2026-09-18，活着的 harness 端口 62610）

| 检查 | 结果 |
|---|---|
| `POST /taskhive/api/sessions.list`（**新**写法算出的 URL） | **HTTP 200**，返回真实清单（`sessionCount` / `totalBytes` / `workspaces`） |
| `POST /taskhive/api/codesys.workbench/sessions.list`（**旧**写法） | **HTTP 404** `unknown workbench API method ""` |
| 从 client.js 真实常量推导 URL 后实测（而非手写路径） | 新 = 200 / 旧 = 404，与根因一致 |
| `node tests/run-contracts.js` | **exit 0**（37 个测试文件） |
| `session-records-purge-contract.js` / `codesys-workbench-link-contract.js` / `-ui-` / `codesys-permission-inject-contract.js` | 全部通过 |
| `node --check`（CJS + ESM 各一次） | exit 0 |

### 复发信号

- 又出现"宿主未响应 / 请重启 TaskHive"→ **先跑上面的双路径对照，不要真的去重启**。
- `session-records-purge-contract.js` 里再次出现只断言 `/sessions.${method}` 这类**子串**的写法
  → 合同重新失去鉴别力。
- `sessions.list` 返回 200、`sessions.purge` 却报错 → 那是 `confirm:true` 闸门或越界保护在正常拒绝，
  **不是**本条。

### 先区分：相似但不同的现象

| 现象 | 实际是什么 |
|---|---|
| `purge` 返回 400 `confirmation-required` | 正常：`purge` 必须显式 `confirm:true` |
| `purge` 返回 `skipped` 而不是 `deleted` | 目标目录里没有 `session.v*.jsonl*`（压根不是会话），或路径越界被保护拦下 |
| 行消失了但磁盘占用没变 | 不是本条：T092 的顺序是"**先删文件、后归档**"，行消失即代表磁盘已回收 |
| 会话栏里根本没有「彻底删除」菜单项 | T093 的 DOM 注入未命中（那一条有自己的定位规则） |

---

## 问题 #10：改了对象再切走，这份"待写入"就丢了（但树上徽章还在）

### 症状（用户视角）

- 在工作台里改了一个对象（手写，或改 AI 建议），树上是琥珀色、编辑器显示差异；
- **切到别的对象之后这份修改就没了**：切回来看到的是**磁盘上的原文**。
- 更隐蔽的是：**项目树那个琥珀色徽章不会消失**，状态栏"待确认 N 处"也仍然把它算进去 ——
  可是点「确认写入」时它**不会被写入**，写入之后徽章也不会变绿。

### 30 秒定位

```powershell
# 1) 草稿存储是否还在（修复被移除即回归）
Select-String -Path resources\app\plugins\installed\taskhive-surfaces\dsh\client.js -Pattern 'const draftsRef = React.useRef\(new Map\(\)\)'
```

对照 `setObjectDraft` / `clearObjectDrafts` / `previousKey && !sameObject` 这几处（见"修复"）。
**现场判据**：改一个对象 → 切走 → 切回，编辑器里是"你改的"还是"磁盘原文"；若是磁盘原文而徽章还在 → 命中本条。

### 根因

编辑器的草稿**只有一份**，存在两个**全局**字符串里（`client.js` 的 `editedDeclaration` / `editedImplementation`）。
切换对象时的重载 effect 只区分"是不是同一个对象"：

```js
const sameObject = loadedEditorRef.current.key === selectedKey
if (sameObject && (declarationTyped || implementationTyped)) { setAgentReloadAvailable(true); return }  // 同对象：保留
loadedEditorRef.current = { key: selectedKey, declaration: newDeclaration, implementation: newImplementation }
setEditedDeclaration(newDeclaration)   // ← 换对象：直接覆盖上一份草稿，而且没有任何地方保存过它
```

代码里**不存在**任何按对象存储草稿的结构。于是四件事同时发生：

| 环节 | 结果 |
|---|---|
| 草稿内容 | 被下一个对象的文本覆盖 → **上一份手写修改永久丢失** |
| `changeStates[A]` | 仍留在 ref 里（切换只动当前选中项）→ 树上是琥珀色，但编辑器里没有对应差异 |
| `effectiveChanges` | `manualChange` **只由当前选中对象构造** → A 不在写入集合里 |
| `changedObjectCount` | 仍把 A 算进去（它查 `changeStates`） |

→ **"显示的待写入数量"与"实际会被写入的集合"不一致**，而没被写进去的那个对象徽章永远不会变绿。
（**AI 提案本身不受影响**：它在 `proposal.changes` 里、按选中对象派生；丢的只有手写/编辑过的文本。）

### 为什么难查

- 徽章还在，所以看起来"没有丢"；丢的是编辑器里的文本，只在切回去的那一刻才暴露。
- **静默少写**：状态栏显示 N 处待确认，实际只写其中一部分，没有任何报错。
- 与 AI 建议混在一起：AI 提案切换不丢，只有手写过的才丢，容易被当成偶发。

### 修复（`plugins/installed/taskhive-surfaces/dsh/client.js`）

1. 新增**按对象 key** 的草稿表 `draftsRef` + `setObjectDraft` / `clearObjectDrafts` / `clearAllObjectDrafts`；
   key 与 `changeStates` 用**同一个表达式**（`item.__pendingKey || codesysObjectKey(item)`，GUID 优先 ⇒ 刷新后稳定）。
2. 重载 effect 改为**先存后取**：切走前把上一份草稿落表（仅当确实打过字），载入新对象时**草稿优先**于
   AI 建议 / 磁盘文本。textarea 绑定、diff、高亮、行号逻辑**都不动**。
3. `effectiveChanges` 改为由**全部草稿**构成（选中项以编辑器实时文本为准，其余取草稿表），
   使"待写入计数"与"写入集合"重新一致。
4. 草稿生命周期：写入成功清（`writtenKeys`）、`载入 AI 建议` 同步、回滚/重新绑定清空、
   读取刷新清孤儿、**改回原文即清除**。
5. 只发对象**确实拥有**的那一段 —— 给 GVL 发空 `implementation` 会让 CODESYS 抛
   `AttributeError: 'ScriptObject' object has no attribute 'textual_implementation'`。

### 验证证据（2026-09-20）

| 检查 | 结果 |
|---|---|
| 行为对照（把 client.js 的同一套步骤逐行镜像到 Node，old/new 两条路径同跑） | **NEW 7/7 PASS**；**OLD 精确复现**：切回 A 后编辑器是 `A := 1;`（磁盘原文）、A 不在写入集合里、S2 的写集合只有 `B_PRG` 而界面计数是 **2** |
| `node tests/run-contracts.js` | **exit 0**（37 个文件） |
| 新增契约断言（`codesys-workbench-ui-contract.js` 8 组 + `codesys-workbench-link-contract.js`） | 钉住"草稿按对象存储 / 先存后取 / 写入集合来自全部草稿 / 写入成功清草稿 / GVL 不发 implementation"，并**禁止旧形状回归** |

### 复发信号

- `Select-String … -Pattern 'draftsRef'` 找不到 → 修复被回退。
- 又出现"改 A → 切 B → 切回 A 是磁盘原文"或"待确认 N 处但只写了其中几个"。
- 写入后某个对象的琥珀色徽章**长期不消失** → 先看它是否出现在 `effectiveChanges` 里。

### 先区分：相似但不同的现象

| 现象 | 实际是什么 |
|---|---|
| 切走再切回，**AI 建议**也丢了 | 不是本条（AI 提案在 `proposal.changes` 里，不受切换影响）；查是否被新提案覆盖 |
| 徽章一直是琥珀色、编辑器里**没有**差异 | 很可能是本条的历史残留：徽章在、草稿已丢 |
| 写入后徽章仍是琥珀色但内容确实已落盘 | 该对象不在 `writtenKeys` 里 → 属本条（写入集合漏项） |

---

## 问题 #11：点了「登录」，设备连上了，但一个在线变量都不显示

### 症状（用户视角）

- 「现在登录上了，但是不显示在线变量状态，这个是还没有做还是不能实现？」
- 顶栏绿色徽标亮了、应用状态读得到，"在线值"那一列却是空的，**没有任何报错**。

### 30 秒定位

```powershell
cd 'C:\Users\29925\Documents\TaskHive1.0.3\resources\app'
# 1) 登录到底做了什么：必须能同时看到 connect() 和 login(Keep)
node -e "const t=require('fs').readFileSync('plugins/installed/codesys-monitor/online-session.cjs','utf8');const b=t.slice(t.indexOf('def do_login'),t.indexOf('def do_logout'));console.log(/onlineDevice'\]\.connect\(\)/.test(b)?'connect OK':'connect MISSING');console.log(/login\(OnlineChangeOption\.Keep/.test(b)?'Keep login OK':'Keep login MISSING -> 登录不会登录应用，在线值永远是空')"
# 2) 读值是否被登录态挡住
Select-String -Path 'plugins\installed\codesys-monitor\online-session.cjs' -Pattern "if not result\['isLoggedIn'\] or not expressions"
# 3) 轮询是否被整体关掉
Select-String -Path 'plugins\installed\taskhive-surfaces\dsh\client.js' -Pattern 'onlineLoggedIn \|\| !workbenchVisible'
```

### 根因

两层，缺一不可：

1. **登录没有登录应用。** `do_login` 只做 `onlineDevice.connect()`（建立设备连接），从不调用
   `application.login(...)`。而 `do_monitor` 的第一行就是 `if not result['isLoggedIn']: return`，
   于是登录得再成功也读不到值。**应用登录此前只有「下载」会做**，而「下载」= `login(Never)`
   = 强制完整下载，谁也不会为了看个值去点它。
2. **界面把整段取值轮询挂在 `isLoggedIn` 上**（`if (!jobId || !onlineLoggedIn || !workbenchVisible) return`），
   所以那些代码**从上线起一次都没执行过** —— 这不是"没实现"，是被门挡住了。

### 为什么难查

- 没有任何报错：连接成功、状态可读、界面正常，只是"值那一列是空的"。
- 两层门分别在 Python worker 和前端 effect 里，只看其中一层都会得出"这功能没做"的结论。
- 更隐蔽的是：`login()` 这个调用**本身就是"要不要传输程序"的开关**（见下表），所以"顺手加个 login"会直接把工程下载进设备 —— 让人不敢动这段代码，问题就一直留着。

### 修复（文件 + 代码位置）

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/online-session.cjs` | `do_login` = `connect()` + **`login(OnlineChangeOption.Keep, False)`**；新增 `loginMode`（`keep` / `transfer`）；`require_logged_in()` 只认 `transfer`（启停机械仍需「下载」） |
| `plugins/installed/codesys-monitor/online-session.cjs` | 变量名解析 `preferred_expression` / `expression_candidates`：PROGRAM 局部量必须 `Jog.permit`，GVL 全局量裸名可用；成功写法记住供批量读复用 |
| `plugins/installed/taskhive-surfaces/dsh/client.js` | 轮询单飞 + 值没变不重绘 + 慢读退避 + 不可见不读；声明区标题显示「在线值 / 在线中…」 |
| `app/main.js`、`app/codesys-online-authorization.js` | 监视按 `login` 能力授权（`download` 作退路）；Keep 登录不得进入应用层动作（`CODESYS_ONLINE_MONITOR_ONLY_LOGIN`） |

### 验证证据（2026-09-21，真实 PLC GCAN-PLC-521C，全程只读）

```
[2] 登录(Keep): connected=true | isLoggedIn=true | loginMode=keep | 应用状态=已停止（STOP）
[3] HR_STATUS="INT#107"  GVL.HR_STATUS="INT#107"   permit=""（无效的表达式）  Jog.permit="FALSE"
[2 Jog 第一轮] readMode=batch partial=false  permit="FALSE"  i="INT#0"  HR_STATUS="INT#107"
```

| 检查 | 结果 |
|---|---|
| `node cache/online-probe/keep-login-probe.js` | 登录后 `isLoggedIn=true`；`Keep` 未产生任何传输（应用状态与设备标志前后不变） |
| `node cache/online-probe/scope-probe.js` | 界面路径（带 `scope`）批量读到真值、零报错 |
| `node tests/run-contracts.js` | **exit 0**（35 项合同） |

### 复发信号

- 登录后徽标是「已连接」而不是「在线」→ `loginMode` 没回传或 `isLoggedIn` 仍为 false。
- 徽标是「在线」、声明区标题却一直是「在线中…」→ 看 `monitor` 返回的 `errors[].error`：
  `无效的表达式` = 变量名写法不对（本条的第二种根因），不是没登录。
- `loginMode` 恒为 `''` → `status` 没带 `loginMode`，界面无从区分两种登录。

### 先区分：相似但不同的现象

| 现象 | 实际是什么 |
|---|---|
| 徽标根本不出现 | 那是"没连接"（`onlineConnected=false`），不是本条 |
| 值列出现但全是空字符串 | 变量名解析失败（`无效的表达式`）→ 本条第二种根因；看 `errors` |
| 值列有值但不刷新 | 轮询被 `document.visibilityState` / `onlineBusyRef` 暂停，或慢读正在退避（最长 6 秒一次） |
| 登录要等 20–40 秒 | 正常：首次要启动常驻在线进程（约 700 MB 的 CODESYS），界面已有提示 |

---

## 问题 #12：扫描设备报 `EBUSY: resource busy or locked, open … online-worker.py`

### 症状（用户视角）

- 「扫描 PLC 设备」→「扫描失败：Error invoking remote method 'codesys:online-scan':
  Error: EBUSY: resource busy or locked, open
  `…\jobs\direct-…\online\online-worker.py`」。
- 重启后**第一次**点扫描就可能中；不重启时也时有时无。

### 30 秒定位

```powershell
cd 'C:\Users\29925\Documents\TaskHive1.0.3\resources\app'
# 1) 会话入口是否只有一个（没有 ensureOnlineSession 就是旧代码）
Select-String -Path 'plugins\installed\codesys-monitor\scriptengine.cjs' -Pattern 'async ensureOnlineSession|onlineSessionPending = pending'
# 2) 交换文件是否都带令牌（应看到 RUN_TOKEN，且没有固定名）
Select-String -Path 'plugins\installed\codesys-monitor\online-session.cjs' -Pattern 'RUN_TOKEN|online-worker-'
# 3) 现场取证：同一作业目录里是不是出现了两个 worker 脚本 / 两个 headless CODESYS
Get-ChildItem 'workspaces\codesys-scriptengine\jobs\*\online' -Filter 'online-worker*.py' | Select-Object FullName,LastWriteTime
Get-Process CODESYS | Where-Object { -not $_.MainWindowTitle } | Select-Object Id,StartTime
```

### 根因

**"确保在线会话存在"没有在途合并。** 一次启动要 20–40 秒，而 `openOnlineSession` 是
**start() 成功之后**才把会话挂到 `this.onlineSession`。这段窗口里任何第二个入口
（绑定工程后读目标的后台准备、「扫描设备」、「登录」）都会认为"没有会话"，
再起一个 CODESYS 去写**同一个固定文件名** `online-worker.py` —— 而第一个 CODESYS 正把它
开着，Windows 直接 EBUSY。

同源的第二层：那个目录里的命令文件 `online-command.json` 等也是固定名，一个"上次崩溃没退
干净、还在轮询命令"的旧进程会和新进程抢同一个命令文件 —— **同一条 login / download 会被
执行两次**（比 EBUSY 危险得多，只是在现场还没撞上）。

### 修复（文件 + 代码位置）

| 文件 | 改动 |
|---|---|
| `plugins/installed/codesys-monitor/scriptengine.cjs` | `ensureOnlineSession()`：**同步占坑再 await**，同一个 job 的并发调用共享一次启动；`prepareOnlineSession` / `runOnlineAction` 都走它 |
| 同上 | `onlineSessionGeneration` 代数守卫：启动期间被要求停止 → 那个会话 `stop('superseded-start')` 并抛 `CODESYS_ONLINE_START_SUPERSEDED` |
| 同上 | 工程副本按令牌命名：`snapshots/online-session-<token>.project` |
| `plugins/installed/codesys-monitor/online-session.cjs` | 脚本名与命令/就绪/进度/停止文件全部带运行令牌；`stop()` 在 kill 之后再等一次退出 |

### 验证证据（2026-09-21）

```
[2.1] ok reused=false pid=42972   [2.2] ok reused=true pid=42972   [2.3] ok reused=true pid=42972
[3] 三个并发 prepare 用时 42180 ms；不同 worker 进程数 = 1（期望 1）
[4] 释放: {"stopped":true,"graceful":true,"killed":false}
```

| 检查 | 结果 |
|---|---|
| `node cache/online-probe/concurrent-prepare-probe.js`（真实 CODESYS，同一个作业目录） | 三个并发只起 1 个 worker；42.2 秒 = 一次启动 |
| `node tests/codesys-online-session-concurrency-contract.js` | 通过（假 CODESYS 驱动真实会话生命周期） |
| `node tests/run-contracts.js` | **exit 0**（36 项合同） |

### 复发信号

- `scriptengine.cjs` 里又出现 `await this.stopOnlineSession('rebind')` 紧接 `openOnlineSession(` → 修复被回退。
- 任务管理器里出现**两个**没有窗口的 CODESYS 进程（每个约 1 GB）。
- 目录里同时存在两个 `online-worker-*.py` 且时间相近 → 又重复启动了。
- 更危险的信号：设备上同一条下载/登录被执行了两次 → 检查命令文件是否又变回固定名。

### 先区分：相似但不同的现象

| 现象 | 实际是什么 |
|---|---|
| 提示 `CODESYS_ONLINE_WORKER_FAILED` / 初始化失败 | 不是本条：worker 起来了但打不开工程，看 `online-worker.stderr.log` |
| 提示 `CODESYS_ONLINE_START_SUPERSEDED` | 是修复后的**正常**结果：启动期间被要求停止，已放弃这次启动，重试即可 |
| 扫描很慢但成功 | 正常：实时广播要等网关；缓存那一轮是秒回的 |
| 你自己开的 CODESYS 看不到设备 | 常驻在线进程占着网关 → 用工作台「释放在线会话」，或点「断开」 |

---

## 常见疑问 #1：上下文统计里出现两个不同的数字，哪个是真的？

输入框右下角那个上下文环（DSH 的 `ContextMeter`）有两层数值，它们**量的不是同一件事**：

| 位置 | 含义 | 数据来源 |
|---|---|---|
| **环形 + 悬停提示 + 面板抬头** `上下文已用 X%   ~已用 / 窗口` | 上下文占用 | 分子 = provider **上报**的真实 prompt 用量（`input + cacheRead + cacheWrite`，取自最近一次请求的 usage），再加"自那次请求以来新增内容"的估算（所以带 `~`）；分母 = 该路由**声明**的窗口（`request/context.contextWindow`），不是测量值 |
| **面板三行**：系统提示词 / 工具 / 对话消息 | 请求各部分的**估算** | 纯字符启发式（`chars ÷ 4`，`dsh-token-meter` 的 `estimateSystemTokens` / `estimateToolsTokens` / surface fold），只覆盖 **DSH 自己组装**的部分 |

**结论：抬头那一对才是真的**（DSH 自己就用它算压缩阈值 = 窗口 × 0.8）；百分比与右侧分数**永远一致**
（`X% = 已用 ÷ 窗口`）。三行只是"请求里各部分占多少"的估算，**三者之和不等于**抬头的分子 ——
在 CLI 路由（codex-cli / claude-code）上会**明显偏小**，因为那两条路由还会加上 **CLI 自己的系统提示与工具定义**
（实测 codex ≈ 36.7K tokens），这层 DSH 看不到也统计不到（见 T058）。

**本机实测**（用户会话 `session-199984e2`，路由 `codex-cli/gpt-5.6-sol`，声明窗口 272,000）：

| 位置 | 读数 |
|---|---|
| 抬头百分比 | **25%** |
| 抬头分数 | **~67.8K / 272K**（= `input 11,577` + `cacheRead 56,192`，provider 上报；`67769 / 272000 = 24.9%`） |
| 系统提示词 | ~1,802（7,191 字符） |
| 工具 | ~10,675（46 个工具，42,683 字符 JSON） |
| 对话消息 | ~1,164 |
| **三行合计** | **~13.6K** —— 只有抬头的 1/5，差额就是 CLI 自带的那层 |

**交叉验证**（会话 `session-95a97b9f`，路由 `deepseek-official/deepseek-v4-flash`，声明窗口 1,000,000）：
抬头为 `~792.4K / 1M` = **79%**（= `input 354` + `cacheRead 792,064`），与该次失败请求里 provider 自己报的
`793905 in the messages` 一致 —— 说明分子确实是真实值，只是"真实值 + 少量估算增量"。

**怎么用**：按抬头看占用。换到不经 CLI 的路由（如 `deepseek-official`、`deepseek-api`）时，三行与抬头会更接近，
因为那时请求里没有被 CLI 偷偷加上的那一层。

---

## 常见疑问 #2：模型档位（reasoning effort）切换真的生效吗？

**分两层，答案不一样。**

**① 参数透传：是。** 链路与取证：

| 环节 | 事实 |
|---|---|
| 选择器从哪来 | 由**适配器声明**的 `reasoning.efforts` 生成（`dsh-client-ui-model-selection`）；没有声明的路由**不显示齿轮** |
| 怎么进请求 | 选择 → `modelSelection` projection → agent 的 `options.reasoningEffort` → `buildRequest` 写入 `request/header.config.reasoningEffort` |
| 真实会话取证 | `session-199984e2`（codex-cli）：`config = {"provider":"codex-cli","model":"gpt-5.6-sol","reasoningEffort":"low","maxTokens":12000}`，且 `adapterDefaults` 只标记 `maxTokens` —— 档位被采纳（没有被适配器默认值顶掉） |
| codex 适配器 | 档位在 `EFFORTS` 内时追加 `-c model_reasoning_effort=<档位>`；不选时不加任何参数（契约用假 CLI 的**真实 argv** 断言） |
| claude 适配器 | `--effort <档位>`（本机 CLI 帮助确有 `--effort <level>`） |

**② 档位之间能否看出差别：在这条 codex 网关上不能。** 同一道"12 球天平"题各一次真实调用：

| 档位 | 耗时 | output_tokens | reasoning_output_tokens | reasoning item | 回答 |
|---|---|---|---|---|---|
| low | 41.0s | 5 | **0** | 0 | 3 |
| high | 37.3s | 5 | **0** | 0 | 3 |

参数确实送进去了、CLI 也接受（两次退出码 0），但该网关**不返回任何思考量**，所以输出层面没有可观测差异
（与 T058 一致：该网关 `default_reasoning_summary="none"`）。想真正看到档位差别，需换到会报告 reasoning 的路由。

**③ 哪些路由有档位**（其余路由适配器不声明 `reasoning`，UI 不显示、也确实不传）：

| 路由 | 档位 |
|---|---|
| `codex-cli` | low / medium / high / xhigh / max / ultra；默认按模型（gpt-6-astra=high、gpt-5.6-sol=low、gpt-5.5=medium…） |
| `claude-code` | 同上但不含 ultra，默认 medium |
| `deepseek-api` / `ollama-local` / 自定义 api / `anthropic-api` / `web-ai` | **无档位** |

**复发信号**：换了模型后齿轮消失 → 先看该适配器的 `resolveModel()` 有没有返回 `reasoning: { efforts }`；
选了档位没反应 → 先看真实会话的 `request/header.config.reasoningEffort` 是否等于所选值。

---

## 新增问题模板

```md
## 问题 #N：<一句话症状>

### 症状（用户视角）
### 30 秒定位（可复制命令）
### 根因
### 为什么难查
### 触发条件
### 修复（文件 + 代码位置）
### 验证证据（命令 + 实际输出前后对比）
### 复发信号
### 先区分：相似但不同的现象
```
