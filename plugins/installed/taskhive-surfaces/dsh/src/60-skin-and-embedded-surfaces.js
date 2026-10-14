    function iconPaths(id) {
      const paths = {
        codesys: [h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 1 }), h('path', { d: 'M8 21h8M12 17v4' })],
        'web-ai': [h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.4 3.1 5.2 3.1 8.5S14.1 18.1 12 20.5C9.9 18.1 8.9 15.3 8.9 12S9.9 5.9 12 3.5z' })],
        knowledge: [h('path', { d: 'M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 0z' }), h('path', { d: 'M5 4.5v15M8 19.5h11M9 9h6M9 12h6' })],
        charts: [h('path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' })],
        packages: [h('path', { d: 'm12 3 8 4.5v9L12 21l-8-4.5v-9z' }), h('path', { d: 'm4 7.5 8 4.5 8-4.5M12 12v9' })],
        settings: [h('circle', { cx: 12, cy: 12, r: 3 }), h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L7 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L7 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z' })],
      }
      return paths[id] || paths.packages
    }

    function surfaceIcon(id) {
      return h('span', {
        'aria-hidden': 'true',
        'data-taskhive-plugin-icon': id,
        style: { display: 'grid', placeItems: 'center', width: '16px', height: '16px', color: 'currentColor', flex: '0 0 auto' }
      }, h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false' }, ...iconPaths(id)))
    }

    function installTaskHiveSkin(ctx, openSessionRecordsTab) {
      if (document.getElementById('taskhive-harness-skin')) return
      const style = document.createElement('style')
      style.id = 'taskhive-harness-skin'
      // Preserve the upstream DSH theme. TaskHive adds surface-specific
      // styles below but does not recolor or replace the host workbench.
      style.textContent = ''
      style.textContent += `
/* Long conversations stay in the session store, but off-screen message rows
   must not participate in every composer keystroke's layout/paint pass. */
[data-conversation-scroll] [data-chat-flow-key]{content-visibility:auto;contain:layout style paint;contain-intrinsic-size:auto 120px}
[data-taskhive-codesys-workbench="true"]{box-sizing:border-box;display:grid!important;grid-template-rows:auto auto minmax(360px,1fr) auto auto auto auto;min-height:calc(100vh - 52px);gap:12px!important;padding:14px 12px 18px!important;color:var(--dsw-alias-label-primary,#171717)!important;background:var(--dsw-alias-bg-layer-1,#fff);font:13px/1.45 Inter,"Microsoft YaHei",system-ui,sans-serif}
.taskhive-codesys-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.taskhive-codesys-header-copy{min-width:0}.taskhive-codesys-header strong{display:block;font-size:15px;line-height:1.35;letter-spacing:-.01em}.taskhive-codesys-header small{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#666));font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.taskhive-codesys-project{display:grid;gap:8px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;padding:9px;background:var(--dsw-alias-bg-layer-2,#f7f7f7)}.taskhive-codesys-field-label{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#666));font-size:10px;font-weight:600}.taskhive-codesys-path{box-sizing:border-box;width:100%;height:34px;min-width:0;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:8px;padding:0 10px;color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-1,#fff);font:10.5px ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.taskhive-codesys-path:focus{border-color:var(--dsw-alias-brand-primary,#6b78e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#6b78e6) 14%,transparent)}.taskhive-codesys-project-actions{display:flex;flex-wrap:wrap;gap:5px}
.taskhive-codesys-write-panel{display:grid;gap:6px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;padding:10px;background:var(--dsw-alias-bg-layer-1,#fff);position:relative;z-index:2}.taskhive-codesys-write-panel.is-ready{border-color:var(--dsw-alias-state-success-primary,#2e8b57);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-success-primary,#2e8b57) 14%,transparent)}.taskhive-codesys-write-panel.is-blocked{border-color:var(--dsw-alias-state-warn-secondary,#e5bf67);background:var(--dsw-alias-state-warn-tertiary,#fffaf0)}.taskhive-codesys-write-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.taskhive-codesys-write-heading strong{font-size:12px}.taskhive-codesys-write-state{font-size:11px;font-weight:650;color:var(--dsw-alias-state-success-primary,#246b45)}.is-blocked .taskhive-codesys-write-state{color:var(--dsw-alias-state-warn-label,#815000)}.taskhive-codesys-write-detail{font-size:10px;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap}.taskhive-codesys-write-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.taskhive-codesys-confirm-write{min-width:190px;min-height:36px;font-size:12px}.taskhive-codesys-confirm-write:disabled{color:var(--dsw-alias-label-tertiary,#777);background:var(--dsw-alias-bg-layer-3,#ededed);border-color:var(--dsw-alias-border-l2,#d5d5d5)}
.taskhive-codesys-action{box-sizing:border-box;min-height:30px;border:1px solid transparent;border-radius:7px;padding:0 9px;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-button-tool-bar-fill,var(--dsw-alias-bg-layer-1,#fff));font:500 11px/1 Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease}.taskhive-codesys-action:hover:not(:disabled){color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-button-tool-bar-hover,var(--dsw-alias-interactive-bg-hover,#ededed))}.taskhive-codesys-action:focus-visible,.taskhive-codesys-treeitem:focus-visible,.taskhive-codesys-submit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6b78e6);outline-offset:1px}.taskhive-codesys-action:disabled{opacity:.38;cursor:not-allowed}
.taskhive-codesys-editor{display:grid;grid-template-columns:minmax(140px,.42fr) minmax(0,1fr);gap:8px;min-height:360px;height:100%}.taskhive-codesys-object-pane,.taskhive-codesys-code-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;background:var(--dsw-alias-bg-layer-1,#fff)}.taskhive-codesys-pane-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:35px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-separator-primary,var(--dsw-alias-border-l2,#dedede));color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-2,#f7f7f7);font-size:11px;font-weight:650}.taskhive-codesys-pane-heading small{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary,#888));font:9px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.taskhive-codesys-tree{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:5px}.taskhive-codesys-treeitem{box-sizing:border-box;width:100%;min-height:31px;margin:0 0 2px;border:0;border-left:2px solid transparent;border-radius:6px;padding:0 8px;color:var(--dsw-alias-label-secondary,#555);background:transparent;text-align:left;font:500 11.5px/1.2 Inter,"Microsoft YaHei",system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.taskhive-codesys-treeitem:hover{color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f7f7f7))}.taskhive-codesys-treeitem[data-selected="true"]{border-left-color:var(--dsw-alias-brand-primary,#6b78e6);color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-3,#ededed));font-weight:600}.taskhive-codesys-treeitem[data-changed="true"]{border-left-color:var(--dsw-alias-state-warn-primary,#d28a14);color:var(--dsw-alias-state-warn-label,#815000);background:var(--dsw-alias-state-warn-tertiary,#fff3c4);font-weight:650}
.taskhive-codesys-diff{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-1,#fff));font:10.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.taskhive-codesys-diff-row{display:grid;grid-template-columns:32px minmax(0,1fr);min-height:19px;border-bottom:1px solid var(--dsw-alias-separator-primary,var(--dsw-alias-border-l2,#eee))}.taskhive-codesys-diff-row[data-changed="true"]{background:var(--dsw-alias-state-warn-tertiary,#fff3c4);box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary,#d28a14)}.taskhive-codesys-line-number{padding:1px 5px;color:var(--dsw-alias-label-quaternary,#999);background:var(--dsw-alias-bg-layer-2,#f7f7f7);text-align:right;user-select:none}.taskhive-codesys-code-cell{min-width:0;padding:1px 7px;color:var(--dsw-alias-label-secondary,#444);white-space:pre-wrap;overflow-wrap:anywhere}.taskhive-codesys-diff-row[data-changed="true"] .taskhive-codesys-code-new{color:var(--dsw-alias-state-success-primary,#125c2e);background:color-mix(in srgb,var(--dsw-alias-state-success-secondary,#edfff2) 72%,transparent);font-weight:600}
.taskhive-codesys-composer{display:grid;gap:7px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;padding:9px;background:var(--dsw-alias-bg-layer-2,#f7f7f7)}.taskhive-codesys-composer-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.taskhive-codesys-composer-heading strong{font-size:11px}.taskhive-codesys-composer-heading small{color:var(--dsw-alias-label-tertiary,#777);font-size:9px}.taskhive-codesys-prompt{box-sizing:border-box;width:100%;min-height:76px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:8px;padding:8px 10px;color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-1,#fff);font:12px/1.5 Inter,"Microsoft YaHei",system-ui,sans-serif;resize:vertical;outline:none}.taskhive-codesys-prompt:focus{border-color:var(--dsw-alias-brand-primary,#6b78e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#6b78e6) 14%,transparent)}.taskhive-codesys-prompt:disabled{color:var(--dsw-alias-label-dimmed,#aaa);background:var(--dsw-alias-bg-layer-2,#f7f7f7)}.taskhive-codesys-submit{height:32px;border:1px solid color-mix(in srgb,var(--dsw-alias-button-info-fill,#6f86e8) 30%,transparent);border-radius:8px;padding:0 12px;color:var(--dsw-alias-label-primary-inverted,#fff);background:var(--dsw-alias-button-info-fill,#6f86e8);font:600 11.5px Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer}.taskhive-codesys-submit:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#5d74da)}.taskhive-codesys-submit:disabled{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));color:var(--dsw-alias-label-dimmed,#999);background:var(--dsw-alias-bg-layer-3,#ededed);opacity:1;cursor:not-allowed}.taskhive-codesys-assistant,.taskhive-codesys-proposal{max-height:200px;overflow:auto;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:9px;padding:9px;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-bg-layer-1,#fff);font-size:11px;white-space:pre-wrap}.taskhive-codesys-proposal{display:grid;gap:7px;max-height:none;border-color:var(--dsw-alias-state-warn-secondary,#e5bf67);background:var(--dsw-alias-state-warn-tertiary,#fffaf0)}.taskhive-codesys-status{min-height:18px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#666));font-size:10px;white-space:pre-wrap}.taskhive-codesys-safety{border-top:1px solid var(--dsw-alias-separator-primary,var(--dsw-alias-border-l2,#eee));padding-top:9px;color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary,#888));font-size:9px;line-height:1.5}
@media (prefers-reduced-motion:reduce){.taskhive-codesys-action{transition:none}}
.taskhive-codesys-code-editor{box-sizing:border-box;width:100%;min-height:160px;resize:vertical;overflow:auto;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:7px;padding:8px 10px;color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-1,#fff);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none;white-space:pre;tab-size:2}.taskhive-codesys-code-editor:focus{box-shadow:inset 0 0 0 2px var(--dsw-alias-accent-primary,#171717)}.taskhive-codesys-code-editor:disabled{color:var(--dsw-alias-label-tertiary,#777);background:var(--dsw-alias-bg-layer-2,#f7f7f7)}
 
/* ── T081 紧凑工作台：一行顶栏 + 一行命令条，其余全给对象树和代码编辑器 ──────
   The workbench used to spend four stacked bands around the editor — a header, a
   full 当前工程 card (label + path + wrapping action buttons), a 代码任务 composer
   with a 4-row textarea, and a 工程写入 panel with its own detail line and action
   row. The two bottom cards each reserved up to 132px. The user's report:
     "提高代码项目树的占用比例，把当前工程功能块移到 codesys 代码工作台同一行…
      缩小代码任务和工程写入功能块高度，可以改成一行显示，代码任务不需要保留
      输入框…空出来的区域都给代码编辑器"
   So the root grid is now three bands:
     行1 顶栏    = 标题 · 工程路径 · 刷新/选择/复制/定位/回退 · 联动与工程徽章
     行2 工作区  = 对象树 | 拖动条 | 代码编辑器（唯一可伸缩的行）
     行3 命令条  = 「代码任务」 | 「写入 · 可写入/等待 AI 改动/不可写入 + 原因 · 已核对 · 确认写入」
     行4 小字    = 运行状态（省略号） + 「ⓘ 安全边界」（全文在悬浮/焦点里）
   T082 收尾：第三行曾经是两个盒子（裸按钮 30px + 带框条 38px），高度与描边都不一致，
   所以永远对不齐；现在合成**一条**命令条（一个边框、一条基线、等高）。底部的状态与
   安全声明也从两行合并成一行（T081 时是两行小字）。
   T083 收尾：文案全部缩短（代码任务 · 交给 AI → 代码任务；工程写入 → 写入；
   已核对差异 → 已核对；确认写入工程（离线编译）→ 确认写入），并把不可写入的**原因**
   从固定宽度的状态词移到可伸缩的详情文字里，让默认 400px 侧栏下这条也能落在一行。
   被截掉的完整含义全部保留在各自的 title 里。
   Everything that used to be a block is now either inline in those bands or a title
   tooltip. Both the top bar and the command bar wrap instead of overflowing, so the
   narrowest Better Sidebar (280px) stays usable. */
[data-taskhive-codesys-workbench="true"]{height:100%!important;min-height:0!important;max-height:100%!important;overflow:hidden!important;display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr) auto auto!important;align-content:stretch;gap:6px!important;padding:8px!important;container-type:inline-size;container-name:taskhive-codesys}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-assistant,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-proposal,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-statusrow{grid-column:1 / -1}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header{grid-row:1}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor{grid-row:2;min-height:0!important;height:auto!important;display:grid!important;overflow:hidden!important}
/* T082 单条命令条：顶栏与命令条都允许换行，不再有"两个盒子各调各的"的高度错位。
   T083 把条内间距收到 5px，让缩短文案后的控件在默认 400px 侧栏下能落在一行。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar{grid-row:3;box-sizing:border-box;display:flex!important;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;min-height:38px;padding:3px 8px!important;border:1px solid var(--th-line);border-radius:8px!important;background:var(--th-surface-2)}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar.is-ready{border-color:var(--th-ok-line)!important;background:var(--th-surface)!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar.is-blocked{border-color:var(--th-warn-line)!important;background:var(--th-warn-tint)!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-assistant,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-proposal{max-height:64px;overflow:auto}
/* 顶栏内部：标题 + 工程（标签/路径/操作）+ 徽章，共用同一行并在必要时换行。 */
/* T084 顶栏内部：标题 + 路径 + 5 个工程操作 + 徽章，压到**一行**。
   宽度预算（按 CJK=1em、Latin≈0.55em 估算，默认 400px 侧栏 → 可用约 384px）：
     标题「代码工作台」62.5 + 路径(min 56) + 「刷新」34 + 「选择工程」54
     + 3 个图标 78 + 操作间距 16 + 联动徽章 45 + 顶栏间距 12 ≈ 357.5px ✅ 一行
   侧栏更窄时按下面两级继续降级；「必要时换行」只作为兜底，不再是常规表现。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header{display:flex!important;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:6px;min-width:0;overflow:visible}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy strong{display:block;font-size:12.5px;line-height:1.2;white-space:nowrap;letter-spacing:-.01em}
/* 会话号已由联动徽章表达（对话联动已就绪 / 对话未连接），窄栏里不再重复占宽。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy small{display:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project{display:flex!important;flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-field-label{flex:0 0 auto;font-size:9.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-path{flex:1 1 90px;height:28px;min-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions{display:flex;flex:0 1 auto;min-width:0;max-width:100%;flex-wrap:wrap;overflow:hidden;gap:4px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action{flex:0 0 auto;min-height:26px;padding:0 6px;font-size:10px;white-space:nowrap}
/* 本轮按用户要求反转：**默认只显示图标**（16 个功能在窄栏才放得下），
   容器够宽（≥820px）才把带标签的动作展开成文字。
   全文始终在 aria-label 与 title 里。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-text,
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-icononly{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:26px;min-height:26px;padding:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-label{display:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-text .taskhive-codesys-action-icon,
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-icononly .taskhive-codesys-action-icon{display:block}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-icononly{width:26px;min-height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-icon{display:block;flex:none;pointer-events:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-label{pointer-events:none}
/* Online (PLC) group. It renders only once a project is bound, and the path box
   compresses to pay for it so the top bar still fits on one line. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;padding-left:6px;margin-left:2px;border-left:1px solid var(--th-line)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-download:not(:disabled){border-color:var(--th-warn-line)!important;color:var(--th-warn)!important}
/* 能驱动机械 / 清保持变量的三项（写值 / 复位 / Force）用克制的红描边区分，
   与确认词弹窗呼应，但不用实心红块。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-danger:not(:disabled){border-color:#e4c4c1!important;color:#a3403a!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-danger:hover:not(:disabled){border-color:#d9a9a4!important;background:#fbeeed!important}
/* 登录成功 = 醒目的绿色标识；未连接时**不显示任何状态文字**。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;min-height:26px;padding:0 9px;border:1px solid var(--th-ok)!important;border-radius:999px;background:var(--th-ok)!important;color:#fff!important;font:650 10px Inter,"Microsoft YaHei",system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 0 0 2px var(--th-ok-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge:hover{filter:brightness(1.07)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge:focus-visible{outline:2px solid var(--th-ok);outline-offset:2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge .taskhive-codesys-online-dot{background:#fff}
/* 有强制生效 / 应用异常 / 保持变量不匹配时，绿色标识转为警告色 —— 不能只藏在 tooltip 里。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge.is-warning{border-color:#d9a9a4!important;background:#a3403a!important;box-shadow:0 0 0 2px #fbeeed}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge.is-warning:hover{filter:brightness(1.05)}
/* 「在线目标」弹层已删除；下面这几个类名保留下来只服务底部扫描面板里的控件：
   select / address / apply / cancel / scan（-panel/-title/-mode/-sim/-note 已随弹层移除）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-select,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-address{box-sizing:border-box;height:26px;min-width:0;border:1px solid var(--th-line);border-radius:6px;padding:0 6px;color:var(--th-ink);background:var(--th-surface);font:10.5px Inter,"Microsoft YaHei",system-ui,sans-serif}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-select{flex:0 1 auto;max-width:150px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-address{flex:1 1 110px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-address.is-port{flex:0 1 72px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-apply,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-cancel,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-scan{flex:0 0 auto;height:26px;padding:0 9px;border:1px solid var(--th-line);border-radius:6px;background:var(--th-surface);font:inherit;font-size:10px;color:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-scan:not(:disabled),[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-apply:not(:disabled){border-color:var(--th-brand-line);color:var(--th-brand-ink);font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-apply:disabled,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-cancel:disabled,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-scan:disabled{opacity:.5;cursor:default}
/* 扫描结果：一行一台设备，点一下即设为本次会话的在线目标。
   面板本身复用「编译输出」的 .taskhive-codesys-compile* 规则，这里只补列表行。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-body{max-height:200px;display:flex;flex-direction:column;gap:3px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row{display:flex;align-items:baseline;gap:8px;width:100%;min-height:26px;padding:3px 8px;border:1px solid var(--th-line);border-radius:6px;background:var(--th-surface);color:inherit;font:inherit;font-size:11px;text-align:left;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row:hover{border-color:var(--th-brand-line);background:var(--th-brand-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row:focus-visible{outline:2px solid var(--th-brand-line);outline-offset:1px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row.is-current{border-color:var(--th-brand-line);background:var(--th-brand-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row>strong{flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-address{flex:none;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--th-brand-ink)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-kind{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-pick{flex:none;color:var(--th-brand-ink);font-weight:650}
/* 手动指定目标那一行（网关 + 节点地址 + 用作目标）：与 IP 行同一套排布。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-manual{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:7px;border-top:1px dashed var(--th-line);flex-wrap:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-manual .taskhive-codesys-online-target-address{flex:1 1 120px}
/* IP 直连行：就长在扫描面板里（不需要先扫描）。控件本身复用「在线目标」面板的类名，
   这里只负责这一行的排布，不再自定义输入框外观。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:7px;border-top:1px dashed var(--th-line);flex-wrap:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip .taskhive-codesys-online-target-address{flex:1 1 140px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip .taskhive-codesys-online-target-address.is-port{flex:0 0 84px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip-label{flex:none;color:var(--th-ink-3);font-size:9px;font-weight:650;letter-spacing:.04em;text-transform:uppercase}
/* 绑定工程后隐藏路径框：它的值仍在 DOM 里（桌面探针照旧能读），完整路径移到
   在线组的 title 里。这三个在线图标（约 104px）就由此腾出，顶栏仍是一行。 */
[data-taskhive-codesys-workbench="true"][data-codesys-bound="true"] .taskhive-codesys-path{display:none}
/* T097: 联动徽章已移除（底部状态行负责这件事）。
   本轮：「离线工程 / 当前工程」徽章也按用户要求删除，标题统一为「工作台」。 */
/* T086: 「AI 审核」是顶栏里唯一"非工程管道"的动作，用品牌浅色描边与其它按钮区分，
   既不像主按钮那样抢焦点（那正是它在底部条里造成的割裂感），又一眼能认出是 AI 入口。
   同段位于模板字符串内，注释里禁止出现反引号。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai{border-color:var(--th-brand-line)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai:hover:not(:disabled){border-color:var(--th-brand)!important;background:var(--th-brand-tint)!important;color:var(--th-brand-strong)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai:disabled{opacity:.42}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai .taskhive-codesys-action-icon{width:14px;height:14px}
/* ── T084 顶栏分档：容器查询读的是工作台自身宽度，不是窗口宽度 ───────────────
   ≥620px 宽面板才显示「离线工程」徽章（路径本身已说明有没有绑定工程）；
   <380px 连「刷新 / 选择工程」也退化成图标；<340px（接近 280px 最小侧栏）再隐藏
   标题与徽章。每一档都留了余量，因此任一侧栏宽度下顶栏都是一行。 */
@container taskhive-codesys (max-width: 619px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-field-label{display:none}
  /* 唯一的折行例外：需要用户裁决"用哪个正在使用中的工程"时，那个下拉必须显示
     完整工程名与 PID，让它刻意独占一整行。 */
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-open-projects{flex:1 1 100%;max-width:none}
}
@container taskhive-codesys (min-width: 620px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-path{min-width:120px}
}
@container taskhive-codesys (max-width: 379px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions{gap:3px}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-path{flex-basis:70px;min-width:44px}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-online{padding-left:4px;gap:3px}
  /* 绿色标识收成一个 26px 绿点（颜色仍一眼可辨），把宽度让给 16 个功能图标。 */
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge{width:26px;padding:0;justify-content:center}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge-label{display:none}
}
@container taskhive-codesys (max-width: 339px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy{display:none}
}
/* 宽度足够：**有标签的**动作全部展开成文字。
   本轮用户口径原文：「工作台第一行的布局，在宽度合适的时候就应该显示字，但是现在宽度很大
   才会显示字」—— 上一版的 820px 是个"凭感觉留的大余量"，它和实测宽度之间留了一条 73px 的
   **死区**（747–820px：明明放得下全文字，却只显示图标）。现在门槛按**实测**取：
   tests/codesys-workbench-compact-layout-contract.js 里那套宽度模型算出全文字一行需要
   747px（标题 37.5 + 15 个文字动作 595 + 已登录徽章 48 + 15 个 4px 间距 60 + 6px 余量），
   所以门槛 = 747 + 13px 余量 = 760px：误差被那 13px 吸收，比 820px 提前 60px 出字。
   余量**钉在契约里**（≥ 实测值、≤ 实测值 + 30px），以后再想悄悄拉高门槛会直接红灯。
   :has() 让"有文字标签就显示文字、没有就保持图标"这条规则只写一次。 */
@container taskhive-codesys (min-width: 760px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action:has(.taskhive-codesys-action-label){width:auto;padding:0 6px}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action:has(.taskhive-codesys-action-label) .taskhive-codesys-action-icon{display:none}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-label{display:inline}
}
/* T090: 底部行的会话号在窄栏里省略，只留那个 ● / ○ —— 状态文字需要那点宽度。 */
@container taskhive-codesys (max-width: 439px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate-label{display:none}
}
/* T086 命令条内部：这条现在**只**管工程写入，所以没有分组竖线、也没有第二个主按钮。
   composer 已搬到顶栏，.taskhive-codesys-composer 在这里只剩一个透明容器（表单
   语义），它的按钮样式由顶栏那套 .taskhive-codesys-action-* 负责。
   详细原因与禁用理由依旧全部走 title。本段位于模板字符串内，注释里禁止出现反引号。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-composer{display:flex!important;flex:0 0 auto;align-items:center;border:0!important;border-radius:0!important;padding:0!important;background:transparent!important;gap:0!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-heading{flex:0 0 auto;font-size:10.5px;white-space:nowrap}
/* T083: 状态词现在只有「可写入 / 等待 AI 改动 / 不可写入」三种短词，固定宽度即可；
   不可写入的**原因**在下面那条可伸缩的 detail 里，它越窄越省略。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-state{flex:0 0 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-detail{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}
/* 本轮（写入行抽屉化）：那一行只在需要时出现，出现时第一个子元素就是"把手"。
   把手必须**零额外宽度**（否则会让上面那条可伸缩的"原因"被挤小）：padding/border 归零，
   内部间距沿用命令条原本的 5px，所以 标题 + 状态词 的占宽与改动前逐像素相同。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-handle{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-handle:focus-visible{outline:2px solid var(--th-brand-line);outline-offset:2px;border-radius:4px}
/* 收起的细节必须真的藏住：UA 的 [hidden]{display:none} 会被作者 display 规则盖掉
   （细节块自己是 flex 列），所以这里显式钉一条 !important。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-drawer[hidden]{display:none!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-drawer>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-review{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;font-size:9.5px;color:var(--th-ink-2);white-space:nowrap;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-review input{flex:0 0 auto;margin:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-confirm-write{flex:0 1 auto;min-width:0;min-height:30px;height:30px;padding:0 9px!important;font-size:10.5px!important;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane{display:flex;flex-direction:column;min-height:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane .taskhive-codesys-pane-heading{flex:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane .taskhive-codesys-diff{flex:0 1 42%;height:auto;min-height:42px;overflow:auto}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor{flex:1 1 58%;height:auto;min-height:80px}
/* T082 底部只留一行小字：状态占满剩余宽度并用省略号，安全边界收成右侧 ⓘ。
   读取工程时状态会追加「已等待 N 秒…」，那一句只在等待期间出现且必须完整可读，
   所以只有它存在时才允许换成两行。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-statusrow{display:flex!important;align-items:center;gap:6px;min-width:0}
/* T090: 底部行的"联动到哪个会话"指示。它是状态而不是内容，所以窄栏里只留那个点。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate{flex:0 0 auto;font-size:9.5px;line-height:1.3;white-space:nowrap;color:var(--th-brand-ink)}
/* 常驻的「在线目标」：登录/下载作用在哪台设备，平时就得看得见，不能只藏在悬浮提示里。
   窄栏里允许被压缩省略，但绝不换行（顶栏与底栏都必须保持各自一行）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--th-line);border-radius:999px;padding:0 7px;font-size:9.5px;line-height:1.5;color:var(--th-ink-2);background:transparent;font-family:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip:hover{border-color:var(--th-brand-line);color:var(--th-brand-ink)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip:focus-visible{outline:2px solid var(--th-brand-line);outline-offset:1px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip.is-picked{border-color:var(--th-brand-line);color:var(--th-brand-ink)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip.is-online{border-color:transparent;background:var(--th-online,var(--th-brand));color:#fff;font-weight:650}
/* 未连接时读到的"工程里配置的目标"：虚线灰底，和绿色"已连接"药丸明确区分 ——
   它表示"登录会作用到这里"，不是"现在连着这里"。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip.is-project{border-style:dashed;color:var(--th-ink-3)}
/* 扫描设备行上的来源标注：缓存轮 / 实时广播 / 回退，三种可信度必须一眼分开。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-source{flex:none;font-size:9px;line-height:1.4;white-space:nowrap;color:var(--th-ink-3)}
/* 共享连接提示：一行小字，只是提示；它不做任何决策。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-shared{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;line-height:1.3;color:var(--th-ink-3)}
/* 「扫描设备」绑定过设备之后就是「已绑定」：品牌描边 + 对勾图标。已连接时按钮虽然
   置灰，但绑定状态要留住（它现在是一条状态，不只是一次动作）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-scan.is-bound{border-color:var(--th-brand-line);background:var(--th-brand-tint);color:var(--th-brand-ink);font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-scan.is-bound:disabled{opacity:.72}
/* 在线动作进行中：登录要等 20–40 秒，放在最下面的状态栏里（和状态文字同一行）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-pending{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:min(340px,46vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid transparent;border-radius:999px;padding:0 8px;background:var(--th-brand-tint);color:var(--th-brand-ink);font-size:10px;font-weight:650;animation:taskhive-codesys-pending 1.6s ease-in-out infinite}
@keyframes taskhive-codesys-pending{0%,100%{opacity:.62}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-pending{animation:none}}
/* 目标面板里"尚未绑定"的引导行已随弹层删除（现在是面板里的两行控件本身）。 */
/* 「在线引擎是旧版本」提示：黄色告警胶囊，点不动不了任何东西，只说明为什么要重启。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-engine-stale{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--th-warn);border-radius:999px;padding:0 8px;background:#fff7e6;color:#8a5a00;font-size:10px;font-weight:650}
/* 渲染崩溃时的兜底界面：宁可显示错误文本，也不要一片空白。 */
[data-taskhive-codesys-workbench="true"].taskhive-codesys-crash{display:block;padding:16px;border:1px solid #e4c4c1;border-radius:11px;background:#fff7f6;color:#5c2b28;font:12px/1.6 Inter,"Microsoft YaHei",system-ui,sans-serif;overflow:auto}
.taskhive-codesys-crash>strong{display:block;margin-bottom:6px;font-size:13px}
.taskhive-codesys-crash-text{margin:0 0 8px;padding:8px 10px;border-radius:7px;background:#fff;border:1px solid #e4c4c1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.taskhive-codesys-crash-actions{display:flex;gap:8px;margin-top:10px}
.taskhive-codesys-crash-actions>button{height:28px;padding:0 10px;border:1px solid #d3dcfb;border-radius:6px;background:#eef2fe;color:#2f47b8;font:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-state{flex:0 0 auto;font-size:9.5px;line-height:1.3;white-space:nowrap;color:var(--th-ok)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-state.is-warning{color:#a3403a;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate.is-pending{color:var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate.is-idle{color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-status{flex:1 1 auto;min-width:0;min-height:0;font-size:9.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-status:has(.taskhive-codesys-busy-timer){white-space:normal;overflow:visible;text-overflow:clip}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-safety{flex:0 0 auto;padding:0!important;border:0!important;color:var(--th-ink-3);font-size:9px;line-height:1.3;white-space:nowrap;cursor:help}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-safety:focus-visible{outline:2px solid var(--th-brand);outline-offset:2px;border-radius:4px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treeitem[data-changed="true"]{border-left-color:var(--dsw-alias-state-warn-primary,#666);color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-state-warn-tertiary,#f7f7f7)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-diff-row[data-changed="true"]{background:var(--dsw-alias-state-warn-tertiary,#f7f7f7);box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary,#666)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-diff-row[data-changed="true"] .taskhive-codesys-code-new{color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-state-success-secondary,#ededed)}
// T082: the ready/blocked state moved from the inner 工程写入 card onto the single
// command bar, which owns the only border now; these stale selectors were left
// pointing at a class no longer in the markup and are removed.
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-proposal{border-color:var(--dsw-alias-state-warn-secondary,#cfcfcf);background:var(--dsw-alias-state-warn-tertiary,#f7f7f7)}
/* ── TaskHive theme ────────────────────────────────────────────────────────
   The previous revision forced black/white/gray with !important, described as:
     "Harness palette is black/white/gray only; these declarations
      intentionally win over any host theme variables"
   which made TaskHive's own surfaces look like a grayscale wireframe while the
   TaskHive shell is a blue-accented product.

   The palette below is taken from TaskHive's own brand asset rather than
   invented: assets/taskhive-icon-v3.svg is a #7168F6 → #3188EB gradient, and
   the shell (app/renderer/styles.css) already accents with #3569e8 / #315fbd /
   #edf3ff / #d5e0fb on #f7f8fb surfaces with #172033 ink. These tokens sit
   between the icon gradient and the shell accent so the embedded surface and the
   surrounding chrome read as one product. */
:root,[data-taskhive-codesys-workbench="true"]{
  --th-brand:#4f6ef2;
  --th-brand-strong:#3f5ce0;
  --th-brand-ink:#2f47b8;
  --th-brand-tint:#eef2fe;
  --th-brand-line:#d3dcfb;
  --th-surface:#ffffff;
  --th-surface-2:#f7f8fb;
  --th-surface-3:#eef1f7;
  --th-line:#dde2ec;
  --th-line-strong:#c8d0de;
  --th-ink:#1b2233;
  --th-ink-2:#4b5567;
  --th-ink-3:#79839a;
  /* 本轮 A 项（用户报障原文：「现在在线值看不出来，应该和原生ide一样有背景色」）：
     在线值就地画在代码里，只有灰蓝的字**看不出来"这一段是值"**。所以给值一块克制的
     底色（原生 CODESYS 在线视图也是"值有自己的底色"）。两个令牌，不是散落的字面色：
       · --th-value-bg          真值的底色：浅蓝（品牌色的极淡版），与代码底色
                                （--th-surface = #fff）和代码墨色（--th-ink = #1b2233）都不同；
       · --th-value-unknown-bg  未知破折号的底色：更淡的中性灰 —— **不许比真值显眼**。
     只有浅色一种主题：这份皮肤是单套 :root 调色板（全仓没有 prefers-color-scheme /
     [data-theme] 的深色分支），所以这两个令牌只需一组值。将来若加深色主题，改这里即可。 */
  --th-value-bg:#e8eefc;
  --th-value-unknown-bg:#f2f3f7;
  --th-ok:#2f7d5b;
  --th-ok-tint:#eaf6f0;
  --th-ok-line:#c4e2d3;
  --th-warn:#a86a12;
  --th-warn-tint:#fdf6e8;
  --th-warn-line:#efdab3;
  --th-danger:#c0392b;
  /* 本轮（用户口径原文：「错误行标红/警告行标黄」）：编译明细按严重级别着色。
     四个令牌一组，**颜色不写散在业务代码里** —— 渲染层只挂 is-error / is-warning
     这两个既有 class，涂色全部由这里的令牌 + 下面三条规则决定：
       · --th-error-ink  错误行的字：比 --th-danger 更深一档（#8c2418 对 #c0392b），
                         因为现在它压在一块淡红底上，深字才够对比；
       · --th-error-bg   错误行的底：极淡的红（--th-danger 的淡版），不是荧光红；
       · --th-warn-ink   警告行的字：比 --th-warn 更深一档（#754700 对 #a86a12），
                         同样是为了压在淡琥珀底上够对比；
       · --th-warn-bg    警告行的底：极淡的琥珀（--th-warn-line 的淡版）。
     可读性：淡底 + 深字，两条对比都在 7:1 以上（实测 错误 7.82:1 / 警告 7.39:1，都按 WCAG
     相对亮度算）；左侧另有一道 3px 色条（用 box-shadow inset 画，不占盒子尺寸，所以
     行高/换行/滚动**一格都不动**）。色相：错误红 6.2°、警告琥珀 36.4°，一眼分得开。
     深色主题：这份皮肤是单套浅色 :root 调色板（见上面 --th-value-bg 的说明：全仓没有
     prefers-color-scheme / [data-theme] 的深色分支），所以只有浅色一组值。
     将来若加深色主题，改这四个令牌即可。 */
  --th-error-ink:#8c2418;
  --th-error-bg:#fdeeec;
  --th-warn-ink:#754700;
  --th-warn-bg:#fdf7e8;
}
/* Outcome states are semantic, not monochrome: a ready command bar reads as
   success green, a blocked one as amber, and a changed file as brand blue.
   T082: the write state now lives on the single command bar, so the blocked
   colour is painted there instead of on the retired write-panel card. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-proposal{border-color:var(--th-warn-line)!important;background:var(--th-warn-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-state{color:var(--th-ok)!important}
[data-taskhive-codesys-workbench="true"] .is-blocked .taskhive-codesys-write-state{color:var(--th-warn)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-detail{color:var(--th-ink-2)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treeitem[data-changed="true"]{border-left-color:var(--th-brand)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-diff-row[data-changed="true"]{background:var(--th-brand-tint)!important;box-shadow:inset 3px 0 0 var(--th-brand)!important}
/* The editable textarea is a sibling emitted by the compact React tree. Lay
   it out as the lower half of the code column, never as a detached window or
   an overflowing third grid cell. */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor{grid-template-columns:minmax(132px,var(--th-tree-fr,0.52fr)) 9px minmax(170px,var(--th-code-fr,1fr))!important;grid-template-rows:minmax(0,42%) minmax(80px,58%)!important;gap:0!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-split-v{grid-column:2!important;grid-row:1 / span 2!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-object-pane{grid-column:1!important;grid-row:1 / span 2!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-code-pane{grid-column:3!important;grid-row:1 / span 2!important;min-height:0!important;display:flex!important;flex-direction:column!important}
/* Drag handles: the tree/editor divider and the 声明/实现 divider. Both let the
   user grow the code area by squeezing everything else, down to the clamps. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split{position:relative;flex:none;min-width:0;min-height:0;background:transparent;touch-action:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-v{width:9px;height:100%;cursor:col-resize}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-h{width:100%;height:9px;cursor:row-resize}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split::before{content:'';position:absolute;border-radius:2px;background:var(--th-line)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-v::before{left:4px;top:4px;bottom:4px;width:2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-h::before{top:4px;left:4px;right:4px;height:2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split:hover::before,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split:focus-visible::before{background:var(--th-brand)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split:focus-visible{outline:2px solid var(--th-brand);outline-offset:-2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;padding:0 9px;border-bottom:1px solid var(--th-line);background:var(--th-surface-2);color:var(--th-ink-2);font-size:10px;flex:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-state{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-changes{flex:none;color:var(--th-brand-ink);font-weight:650;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-body{display:grid;grid-template-columns:38px minmax(0,1fr);flex:1 1 auto;min-height:0;overflow:hidden;background:var(--th-surface)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-line-gutter{min-height:0;overflow:hidden;padding:8px 0;color:var(--th-ink-3);background:var(--th-surface-2);border-right:1px solid var(--th-line);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:right;user-select:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-line-gutter span{display:block;box-sizing:border-box;height:15.95px;padding-right:7px}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-code-pane>.taskhive-codesys-editor-body>.taskhive-codesys-editor-surface>.taskhive-codesys-code-editor{flex:1 1 auto!important;width:100%!important;height:100%!important;min-height:0!important;padding:8px 10px!important}
/* ── 对话联动状态与变更着色 ──────────────────────────────────────────────
   Blue = the model proposed it and it waits for the user, amber = the user
   typed it, green = it was written into the project this session. The same
   three colours drive the project tree, the open file's line highlight layer
   and the legend, so "what changed here" is readable at a glance. */
/* T097: chip 的药丸样式已随联动徽章一起删除；本轮「离线工程」徽章也删掉了。 */
/* ── T097 编译输出：折叠时一行，展开时给一个可滚动的消息区 ────────────────────
   它是工作台根网格的一个新直接子元素，自动获得一个隐式 auto 行，因此
   grid-template-rows 的两条契约串都不需要改。没有编译结果时整个 section 不渲染。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-compile{box-sizing:border-box;display:flex!important;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--th-line);border-radius:8px!important;background:var(--th-surface-2);padding:3px 8px!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-compile.is-open{background:var(--th-surface)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-head{display:flex!important;align-items:center;gap:6px;min-width:0;min-height:26px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-toggle{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:0;background:transparent;padding:0;font:inherit;font-size:10.5px;color:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-meta{flex:0 0 auto;font-size:9.5px;color:var(--th-ink-2);white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-copy,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-clear{flex:0 0 auto;height:22px;padding:0 8px;border:1px solid var(--th-line);border-radius:6px;background:var(--th-surface);font:inherit;font-size:10px;color:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-clear{padding:0 6px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-body{max-height:180px;overflow:auto;margin-top:3px;padding:4px 6px;border-radius:6px;background:var(--th-surface);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line{white-space:pre-wrap;word-break:break-word}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-error{color:var(--th-danger)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-warning{color:var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-info{color:var(--th-ink-2)}
/* T228 严重级别着色（用户口径原文：「错误行标红/警告行标黄」）：[Error] 行红、[Warning] 行
   黄，[Info] 行与口径说明行保持中性（不抢眼）。三条规则与上面三条**同一个选择器**
   （各单类），所以不吃 !important —— 谁最后写谁赢，is-error 与 is-warning 各自的那一条
   互不覆盖，is-info 不参与着色（仍是 --th-ink-2，与说明行、空报告行同一个颜色）。
   可读性：**淡底 + 深字**（--th-error-bg + --th-error-ink = 7.82:1；--th-warn-bg +
   --th-warn-ink = 7.39:1），不是高饱和荧光；左侧那道 3px 色条用 box-shadow inset 画 ——
   它不参与布局，所以**行高 / 内边距 / 换行 / 滚动行为一格都不动**（这三样这四条规则里
   一个字都没写），gutter 仍归容器的 padding 管，选中/复制出来的 textContent 逐字不变。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-error{background:var(--th-error-bg);color:var(--th-error-ink);box-shadow:inset 3px 0 0 var(--th-danger);border-radius:3px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-warning{background:var(--th-warn-bg);color:var(--th-warn-ink);box-shadow:inset 3px 0 0 var(--th-warn);border-radius:3px}
/* T227 明细视图：**全量平铺**（T225 的分组行 + 「展开查看全部 N 条」按钮已删除，所以
   \`.taskhive-codesys-compile-more\` 的三条规则也一并删掉 —— 没有那颗按钮了）。
   列表本身已经由 .taskhive-codesys-compile-body 的 max-height:180px / overflow:auto 兜住滚动；
   这里只给容器一个块级、可收缩的最小宽度。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-lines{display:block;min-width:0}
/* T226 口径说明：头部只有"错误 N · 警告 M"两个数，汇总与明细的差异（含载入上限）只在这里出现
   ——安静的一行，不抢注意力、没有徽章。T227：明细不再折叠，所以这几行**直接显示在明细列表上方**
   （不必先点开任何按钮；不需要解释时一行都不渲染）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-note{display:block;margin:0 0 3px;color:var(--th-ink-2);font-size:10px;white-space:pre-wrap;word-break:break-word}
/* ── 真实多级项目树：设备 → PLC 逻辑 → 应用 → POU / GVL / DUT / 库管理器 ── */
/* The object pane gained a filter toolbar AND a legend row, and the code pane a
   hint row, while the shared 1.0.2 rule still declared only two grid rows. The
   extra children landed in implicit rows BELOW the pane, so the tree was pushed
   out of view (clipped) and its rows/filters could not be clicked at all. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-object-pane{grid-template-rows:auto auto minmax(0,1fr) auto!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane{grid-template-rows:auto auto minmax(0,1fr) auto!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-toolbar{display:flex;flex-wrap:wrap;gap:4px;padding:5px 6px;border-bottom:1px solid var(--th-line);background:var(--th-surface-2)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-filter{min-height:20px;border:1px solid var(--th-line);border-radius:6px;padding:0 6px;color:var(--th-ink-2);background:var(--th-surface);font-size:9.5px;font-weight:600;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-filter:hover{color:var(--th-ink);background:var(--th-surface-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-filter.is-active{border-color:var(--th-brand-line);color:var(--th-brand-ink);background:var(--th-brand-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow{box-sizing:border-box;display:flex;align-items:center;gap:5px;width:100%;min-height:26px;margin:0 0 1px;border:0;border-left:2px solid transparent;border-radius:6px;padding:0 6px;color:var(--th-ink-2);background:transparent;font:500 11.5px/1.2 Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow:hover{background:var(--th-surface-2)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow.is-group{color:var(--th-ink);font-weight:600}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-selected="true"]{border-left-color:var(--th-brand)!important;color:var(--th-ink)!important;background:var(--th-brand-tint)!important;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow:focus-visible{outline:2px solid var(--th-brand);outline-offset:-2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="agent"]{border-left-color:var(--th-brand)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="manual"]{border-left-color:var(--th-warn)!important;color:var(--th-warn)!important;background:var(--th-warn-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="written"]{border-left-color:var(--th-ok)!important;color:var(--th-ok)!important;background:var(--th-ok-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="pending-create"]{border-left-color:var(--th-brand-strong)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-scope="subtree"]{border-left-style:dotted}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-twisty{flex:none;width:13px;height:13px;border:0;padding:0;color:var(--th-ink-3);background:transparent;font-size:9px;line-height:13px;text-align:center;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-twisty.is-leaf{cursor:default}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind{flex:none;width:9px;height:9px;border-radius:2px;background:var(--th-ink-3);box-shadow:inset 0 0 0 1px rgba(0,0,0,.14)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="device"]{background:#5b6b86}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="axis"],[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="axis-pool"]{background:#7d8aa6}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="application"]{background:#3f5ce0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="plc-logic"]{background:#6478e8}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="task"],[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="task-config"]{background:#2f9e8f}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="pou"]{background:#4f6ef2}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="gvl"]{background:#2f7d5b}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="dut"]{background:#8a5bd6}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="library-manager"]{background:#a86a12}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="folder"],[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="container"]{background:#9aa3b5}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="internal"]{background:#c9cedb}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-busy-timer{color:var(--th-brand-ink);font-weight:650}
/* The empty tree explains WHY it is empty and points at the single set of
   project controls above; it must not repeat those controls (field report:
   "为什么项目树里边会有检测工程和打开文件？工作台不是已经具备这个功能了？"). */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-empty{display:grid;gap:6px;justify-items:start;padding:12px 10px;color:var(--th-ink-2);font-size:11px;line-height:1.5}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-empty strong{color:var(--th-ink);font-size:12px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-empty-pointer{color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-open-projects{max-width:100%;min-height:30px;border:1px solid var(--th-warn-line);border-radius:7px;padding:0 6px;color:var(--th-warn);background:var(--th-warn-tint);font:500 10.5px Inter,"Microsoft YaHei",system-ui,sans-serif}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind-label{flex:none;color:var(--th-ink-3);font-size:8.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-count{flex:none;color:var(--th-ink-3);font-size:8.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-state.is-subtree{font-size:8px;opacity:.75}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-hint{padding:7px 10px;border-top:1px solid var(--th-line);color:var(--th-ink-2);background:var(--th-surface-2);font-size:10.5px;line-height:1.5}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-state{flex:none;font-size:9px;font-weight:650}
/* T081: 图例固定一行。原先是 flex-wrap:wrap，在 400px 侧栏里会折成 2–3 行，
   把对象树的可视高度吃掉约 45px——那正是用户要回来的空间。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend{display:flex;flex-wrap:nowrap;gap:8px;padding:4px 8px;border-top:1px solid var(--th-line);color:var(--th-ink-3);font-size:8.5px;white-space:nowrap;overflow:hidden}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span{display:inline-flex;align-items:center;gap:4px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="agent"]::before{background:var(--th-brand)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="manual"]::before{background:var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="written"]::before{background:var(--th-ok)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="pending-create"]::before{background:var(--th-brand-strong)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-reload-suggestion{min-height:22px;padding:0 8px;border-color:var(--th-brand-line);color:var(--th-brand-ink);background:var(--th-brand-tint);font-size:10px;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-surface{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;background:var(--th-surface)}
/* CODESYS' editor is 声明区 + 代码区, each numbered from line 1. The old layout
   was one grid (38px gutter + textarea) that concatenated both parts, so the
   implementation's line numbers were always offset by the declaration length.
   Each section is now its own gutter + textarea pair. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-body{display:flex!important;flex-direction:column;gap:6px;min-height:0;overflow:auto;background:transparent!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section{display:flex;flex-direction:column;min-height:0;border:1px solid var(--th-line);border-radius:8px;overflow:hidden;background:var(--th-surface)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;padding:0 8px;border-bottom:1px solid var(--th-line);background:var(--th-surface-2);color:var(--th-ink-2);font-size:10px;font-weight:650;flex:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-grid{display:grid;grid-template-columns:38px minmax(0,1fr);flex:1 1 auto;min-height:0;overflow:hidden}
/* 本轮（样式 A，用户报障原文：「在线值依然显示的太难看了，为什么不可以把在线值直接替换
   代码编辑区到变量？？？而且显示不全？我滚动到时候底下很多都没有加载」）：值不再占第三列，
   而是**就地**紧跟每一个变量 token（同一行、同一段流），所以这里再也没有 minmax(...) 固定
   值列、没有值列上的 overflow:hidden、没有省略号 —— 没有任何东西能裁掉一个值。
   镜像层与 textarea 共用同一套字体/行高/内边距，第 N 行永远对齐左边栏的第 N 行。
   ⚠ 盒子的 overflow 必须是 visible：这一层是靠在 syncScroll 里
   translate(-scrollLeft, -scrollTop) 跟随代码滚动的，而 overflow:hidden 会把**超出自身
   盒子**的内容就地裁掉 —— 平移就永远只能露出开头十几行，那正是"滚到底很多行没值"的成因。
   唯一的窗口裁剪交给上层 .taskhive-codesys-editor-surface 的 overflow:hidden。 */
/* ⚠ 这一层的文字颜色**必须是正文墨色**（--th-ink = #1b2233），不能是 transparent。
   用户报障原文：「开启在线值后会把原来的代码编辑区给覆盖掉，变成一片白和监控过来的值」。
   成因就是这里：打开开关时 textarea 的字被 .is-inline-mirrored 透明化（下面那条规则），
   而这一层又把**代码文字**也画成透明（color:transparent 由普通字符串段落继承），于是
   屏幕上只剩下那几个有自己颜色的值 span —— 代码整段消失，"一片白 + 值"。
   契约（本轮）：代码由**这一层**负责显示（正常前景色），只有值 span 用灰蓝（--th-ink-2）；
   这一段代码文字与 textarea 的对应行**逐字符相等**（值 span 之外一个字符都不差），
   字体/字号/行高/内边距/1px 边框抵消与 textarea 相同 ⇒ 第 N 行永远对齐第 N 行。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-online{position:absolute;top:0;right:0;bottom:0;left:0;box-sizing:border-box;border:1px solid transparent;padding:8px 10px;overflow:visible;pointer-events:none;user-select:none;color:var(--th-ink);background:transparent;white-space:pre;tab-size:2;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
/* ⚠ 这一层（和下面的底色层）都**故意不写** will-change:transform：它们的盒子只有一屏高，
   内容却有整份代码那么长（1000 行 ≈ 16000px）。overflow:visible 遇上 will-change 会让浏览器
   按内容尺寸建一张巨大的合成层（1000 行 × 700px × 4B ≈ 45MB，两个区 90MB），而一个
   scroll 同步的 transform 本来就不需要这个提示。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-line{display:block;box-sizing:border-box;height:15.95px}
/* 值：同字号，但有**克制的底色块**（--th-value-bg = #e8eefc）+ 左右各 3px 内边距 +
   2px 圆角 ⇒ 一眼就能看出"这一段是值"（原生 IDE 的在线值就是这个观感），不再是"只是一段
   更浅的灰蓝字"。底色令牌与代码墨色（--th-ink）、编辑区底色（--th-surface）都不同 ——
   契约里按令牌解析逐条比。
   ⚠ 值 span 仍然是同字号、同一段文字流里的一段（没有方框/边框/chip/括号）；内联元素的
   padding 不影响行高，所以镜像层每一行仍然是 15.95px，和 textarea 的行一一对应。
   ⚠ display:inline-block 是**必须**的：min-width 对非替换 inline 元素不生效，而每个值
   的稳定槽宽（min-width:calc(Nch + 6px)，由 50-codesys-workbench.js 逐值内联给出）正是
   "值一变不把后面的代码左右推"的全部依靠。inline-block 的基线就是它最后一行文字的基线，
   所以纵向对齐与行高都不变。
   ⚠ 只有**值自己有底色**：代码文字继承镜像层的 --th-ink（上面那条规则），值与代码既不同色
   也不同底 ⇒ "哪一段是值"永远看得出来（本轮契约：底色存在且 ≠ 背景、≠ 代码色）。
   ⚠ 这里一个能裁字的属性都没有（no overflow:hidden / text-overflow / white-space:nowrap）：
   min-width 只是下限，值比槽宽时盒子跟着长，长值永远完整可见。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-value{color:var(--th-ink-2);background:var(--th-value-bg);padding:0 3px;border-radius:2px;display:inline-block;box-sizing:border-box;font:inherit}
/* 未知（这里真的有变量、但面板还没观测到值）：压得更淡的一个破折号 + 更淡的中性底，
   不跟真值抢注意力（契约：未知的底色必须比真值的底色更淡）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-value.is-unknown{color:var(--th-ink-3);background:var(--th-value-unknown-bg);opacity:.6}
/* 值在镜像层里画，所以已登录（值就地显示）时 textarea 自己的字要让位（否则同一段代码被画两遍、
   内联值还会盖住后面的代码）。光标颜色单独保留 —— 光标仍然由 textarea 画。
   ⚠ 让位的**只有**"已登录、值正在显示"的那一种状态（.is-inline-mirrored 只在 showInline 时挂上）：
   未登录（或退出登录）这一层整个不渲染、这个类消失 ⇒ textarea 立刻恢复自己的正文颜色（原样）。
   代码文字的可见性因此有且只有两个来源：未登录 = textarea 自己画；已登录 = 镜像层画
   （--th-ink）。任何时候都**不存在**"两边都不画"的状态 —— 那就是用户看到的那片白。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor.is-inline-mirrored{color:transparent!important;caret-color:var(--th-ink)}
/* 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：那一枚「在线值 开/关」
   按钮**整段删除**了，所以它这一组四条样式规则（.taskhive-codesys-editor-online 的常态、
   [aria-pressed="true"]、.is-live 与 :disabled）也一起删除 —— 没有控件就没有样式。
   值显不显示只由登录状态决定；代码区里因此不再有任何"看不看值"的按钮。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section[data-editor-section="declaration"] .taskhive-codesys-editor-grid{min-height:86px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section[data-editor-section="implementation"] .taskhive-codesys-editor-grid{min-height:140px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-grid>.taskhive-codesys-editor-surface>.taskhive-codesys-code-editor{flex:1 1 auto!important;width:100%!important;height:100%!important;min-height:0!important;padding:8px 10px!important;background:transparent!important;resize:none!important}
/* The 1.0.2 rule paints a BLACK inset ring on focus
   (.taskhive-codesys-code-editor:focus{box-shadow:inset 0 0 0 2px #171717}),
   so simply clicking into the declaration/implementation flashed a black box
   ("点声明或实现会出现一个黑框，太突兀"). Clicking the code now paints NOTHING —
   the caret already says where you are; only keyboard focus keeps a ring. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor:focus{box-shadow:none!important;outline:none!important;border-color:var(--th-line)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor:focus-visible{outline:2px solid var(--th-brand)!important;outline-offset:-2px;box-shadow:none!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section:has(.taskhive-codesys-code-editor:focus-visible){border-color:var(--th-brand-line)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-body{flex:1 1 auto!important}
/* ⚠ 这一层的 overflow 必须是 visible，与上面内联值镜像层同一个原因：它是靠 transform
   跟随代码滚动的，而 overflow:hidden 会把超出自身盒子的行就地裁掉，于是"改动行"的底色
   在十几行之后就再也没有了 —— 平移永远露不出被裁掉的内容。窗口裁剪由上层 surface 负责。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-highlights{position:absolute;top:0;right:0;bottom:0;left:0;padding:8px 0;pointer-events:none;overflow:visible}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row{display:block;box-sizing:border-box;height:15.95px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row[data-line-state="agent"]{background:var(--th-brand-tint);box-shadow:inset 3px 0 0 var(--th-brand)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row[data-line-state="manual"]{background:var(--th-warn-tint);box-shadow:inset 3px 0 0 var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row[data-line-state="written"]{background:var(--th-ok-tint);box-shadow:inset 3px 0 0 var(--th-ok)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-surface>.taskhive-codesys-code-editor{position:relative;z-index:1;background:transparent!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane[data-codesys-editor-change-state="manual"] .taskhive-codesys-pane-heading{border-bottom-color:var(--th-warn)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane[data-codesys-editor-change-state="agent"] .taskhive-codesys-pane-heading{border-bottom-color:var(--th-brand)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane[data-codesys-editor-change-state="written"] .taskhive-codesys-pane-heading{border-bottom-color:var(--th-ok)!important}
 `
      document.head.appendChild(style)
      const nodesWithin = (root, selector) => {
        if (!root) return []
        const nodes = []
        if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) nodes.push(root)
        if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll(selector))
        return nodes
      }
      // ---------------------------------------------------------------------
      // TaskHive workbench skin (restored from the 1.0.2 client).
      //
      // The skin is ported onto the 1.0.3 incremental scan: every helper works
      // on the mutated root instead of re-reading `document.body *`, and each
      // helper gates on the cheap `textContent` before touching `innerText` or
      // `getBoundingClientRect`. The 1.0.2 full-page 250 ms interval is
      // deliberately NOT restored (see T029/T037) — restoring it would bring
      // back the streaming-input jank those tasks removed.
      // ---------------------------------------------------------------------
      const brandMarkup = (size, includeText = true) => `${taskhiveBrandIcon ? `<img data-taskhive-brand-icon="true" src="${taskhiveBrandIcon}" alt="" style="width:${size}px;height:${size}px;display:block;flex:0 0 auto">` : ''}${includeText ? '<span data-taskhive-brand-text="true" style="font-weight:650;font-size:15px">TaskHive</span>' : ''}`
      const brandSpanMarkup = () => `${taskhiveBrandIcon ? `<img data-taskhive-brand-icon="true" src="${taskhiveBrandIcon}" alt="" style="width:24px;height:24px;display:block">` : ''}<span data-taskhive-brand-text="true">TaskHive</span>`
      const brandSpanStyle = 'display:inline-flex;align-items:center;gap:8px;font-weight:650;font-size:17px;color:var(--th-ink,#1b2233)'
      // ── Sidebar brand ──────────────────────────────────────────────────────
      //
      // Verified markup in DSH 0.1.3-alpha.2 (dumped from the live frame):
      //
      //   div.hHd-Xa_logoRow
      //     button.hHd-Xa_brand.hHd-Xa_wide          (expanded)
      //       span.hHd-Xa_brandIdentity > span.hHd-Xa_brandMark
      //         div[data-slot="sidebar.brand.mark"]  <- vendor logo SVG lives here
      //     button.hHd-Xa_iconButton.hHd-Xa_toggle    (collapsed)
      //       span.hHd-Xa_railMark
      //         div[data-slot="sidebar.brand.mark"]  <- the SAME element, re-parented
      //
      // Two consequences drive this code:
      //   1. There is no `button[class*="_brand"]`-with-text to rewrite; the row
      //      is icon-only, and the vendor logo is what the user sees both
      //      expanded and collapsed.
      //   2. The brand region renders long after plugin init and React re-parents
      //      it on every collapse/expand, so reconciling it only during the
      //      initial document scan never applied. It now runs on every pass.
      const SIDEBAR_MARK_SELECTOR = '[data-slot="sidebar.brand.mark"]'
      // The mark sits beside the "TaskHive" wordmark (expanded) and alone in the
      // collapsed rail, so it is the app's identity in the chrome — it must be
      // the TaskHive program icon, not a vendor logo and not a generic panel
      // glyph. The host hands the real icon over as a data URL through
      // `taskhiveIcon` (main.js reads assets/taskhive-icon-v3-64.png), which is
      // the only channel that works here: this frame is served from
      // http://127.0.0.1:<port>/ and cannot reach the app's asset folder.
      const brandMarkSvg = '<svg data-taskhive-brand-mark="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path></svg>'
      const brandMarkMarkup = () => (taskhiveBrandIcon
        ? `<img data-taskhive-brand-mark="true" src="${taskhiveBrandIcon}" alt="" width="22" height="22" style="width:22px;height:22px;display:block;object-fit:contain">`
        // Until the bridge hands the icon over (alpha.2 strips the query param on
        // first paint) fall back to the neutral sidebar glyph rather than leaving
        // an empty slot. The delayed retries re-run this and swap the real icon in.
        : brandMarkSvg)
      // DSH renders the conversation hero's mark at 34px (`HeroShell` passes
      // `size: 34` to the slot and the vendor glyph is 34 x 25), so the TaskHive
      // mark that replaces it has to be 34px too — a 22px sidebar glyph there would
      // sit in a 34px hole and read as "the icon is in the wrong place".
      const HERO_MARK_SIZE = 34
      const heroMarkMarkup = () => (taskhiveBrandIcon
        ? `<img data-taskhive-brand-mark="true" src="${taskhiveBrandIcon}" alt="" width="${HERO_MARK_SIZE}" height="${HERO_MARK_SIZE}" style="width:${HERO_MARK_SIZE}px;height:${HERO_MARK_SIZE}px;display:block;object-fit:contain">`
        : brandMarkSvg.replace('width="22" height="22"', `width="${HERO_MARK_SIZE}" height="${HERO_MARK_SIZE}"`))
      // The hero headline is a `display:grid` row, so an icon written INTO its text
      // span stacks above the words instead of sitting beside them. The mark belongs
      // in the mark slot; the headline seam writes the wordmark alone.
      const brandWordmarkMarkup = '<span data-taskhive-brand-text="true">TaskHive</span>'
      const ensureSidebarBrandMark = () => {
        const marks = document.querySelectorAll(SIDEBAR_MARK_SELECTOR)
        if (!marks.length) return false
        // T091: brand EVERY matching slot, not just the first. `querySelector` picked
        // whichever came first, so when the expanded header and the collapsed rail were
        // both in the DOM the other one kept the vendor logo.
        for (const mark of marks) {
          // NEVER delete the vendor node. DSH renders this slot with a React
          // component (`OfficialBrandMark`), and removing a node React believes it
          // owns aborts its reconciliation: the client then fails to mount at all
          // and the whole sidebar disappears. Hiding it keeps the node in place, so
          // React still finds its child, while our icon sits beside it.
          //
          // T091: re-hiding runs on EVERY pass, before the "ours is already there"
          // check. Skipping it (the old early-return) left a re-created vendor child
          // visible next to our icon.
          for (const child of mark.children) {
            if (child.hasAttribute?.('data-taskhive-brand-mark')) continue
            child.style?.setProperty('display', 'none', 'important')
          }
          const ours = mark.querySelector('[data-taskhive-brand-mark="true"]')
          if (ours && ours.tagName === 'IMG') continue
          // Only ever remove OUR OWN placeholder when upgrading it to the real icon.
          if (ours) ours.remove()
          mark.insertAdjacentHTML('afterbegin', brandMarkMarkup())
          mark.dataset.taskhiveSidebarRail = 'true'
        }
        return true
      }
      const ensureSidebarGlyph = () => ensureSidebarBrandMark()
      // Replace any vendor brand text in the logo row. The row is icon-only in
      // this build, but the sidebar.brand.name slot can render a name, and the
      // user must never see "DeepSeek Harness" in TaskHive's chrome.
      const rebrandSidebarText = () => {
        const row = document.querySelector('[class*="logoRow"]')
        if (!row) return false
        for (const node of row.querySelectorAll('span,strong,small,b,div,h1,h2')) {
          if (node.children.length) continue
          const text = String(node.textContent || '').trim()
          if (!text || !/deepseek/i.test(text)) continue
          node.textContent = 'TaskHive'
          node.dataset.taskhiveBrandText = 'true'
        }
        return true
      }
      // The vendor wordmark is NOT text: `sidebar.brand.name` renders
      // "DeepSeek Harness" as an SVG of glyph outlines
      // (`<svg width="156" height="24" viewBox="26 0 156 24">`, aria-hidden), so
      // no text query can ever match it. Replace the slot's contents outright.
      const SIDEBAR_NAME_SELECTOR = '[data-slot="sidebar.brand.name"]'
      const ensureSidebarWordmark = () => {
        const slots = document.querySelectorAll(SIDEBAR_NAME_SELECTOR)
        if (!slots.length) return false
        // T091: every slot, for the same reason as the mark above.
        for (const slot of slots) {
          if (slot.querySelector('[data-taskhive-brand-wordmark="true"]')) continue
          slot.innerHTML = '<span data-taskhive-brand-wordmark="true" style="font:650 15px Inter,\'Microsoft YaHei\',system-ui,sans-serif;color:inherit;letter-spacing:.2px;white-space:nowrap">TaskHive</span>'
        }
        return true
      }
      // Hide the vendor glyph, never remove it — same React-reconciliation reason as
      // the sidebar mark — and put OUR mark in the slot it just vacated, so the
      // headline keeps the row shape DSH designed (slot, then headline text): an
      // empty slot leaves a 34px hole and the icon ends up out of place.
      const HERO_MARK_SELECTOR = '[data-slot="conversation.hero.brand.mark"]'
      const ensureHeroBrandMark = () => {
        const mark = document.querySelector(HERO_MARK_SELECTOR)
        if (!mark) return false
        for (const child of mark.children) {
          if (child.hasAttribute?.('data-taskhive-brand-mark')) continue
          child.style?.setProperty('display', 'none', 'important')
        }
        const ours = mark.querySelector('[data-taskhive-brand-mark="true"]')
        if (ours && ours.tagName === 'IMG') return true
        // Only ever remove OUR OWN placeholder when upgrading it to the real icon.
        if (ours) ours.remove()
        mark.insertAdjacentHTML('beforeend', heroMarkMarkup())
        return true
      }
      // One idempotent brand step, called from every scrub pass, from brand-shaped
      // mutations and from the delayed retries. The name says "sidebar" for history:
      // it now covers every vendor-mark slot the client renders.
      const reconcileSidebarBrand = () => {
        ensureSidebarGlyph()
        ensureSidebarWordmark()
        rebrandSidebarText()
        ensureHeroBrandMark()
      }
      // Keep a usable, non-interactive brand row: the native control already
      // carries aria-label/title for "new session" / "collapse sidebar", so do
      // not overwrite them (doing so broke the toggle's accessible name).
      const ensureBrandButton = () => reconcileSidebarBrand()
      const hideComposerDuplicate = (button, text, dialogOpen) => {
        if (!button || button.closest('[aria-modal="true"]')) return
        if (dialogOpen && button.closest('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]')) return
        const accessLabel = String(button.getAttribute('aria-label') || button.getAttribute('title') || '')
        if (/(?:Workspace\s*Write|Read\s*Only|Full\s*access)/i.test(`${text} ${accessLabel}`)) {
          button.dataset.taskhiveComposerDuplicate = 'permission'
          button.dataset.taskhiveComposerPermission = 'true'
          button.style.setProperty('display', 'none', 'important')
          return
        }
        if (/^(?:Workspace\s+Write|Read\s+Only|Full\s+access)$/i.test(text) || /(?:访问模式|access\s+mode).*(?:Workspace\s+Write|Read\s+Only|Full\s+access)/i.test(accessLabel)) {
          button.dataset.taskhiveComposerDuplicate = 'permission'
          button.dataset.taskhiveComposerPermission = 'true'
          button.style.setProperty('display', 'none', 'important')
        }
      }
      const dismissInternalPreviewNotice = () => {
        const button = [...document.querySelectorAll('button,[role="button"]')].find((node) => /^(继续|continue)$/i.test(String(node.textContent || '').trim()))
        const dialog = button?.closest('[role="dialog"],[aria-modal="true"]')
        if (!button || !dialog || !/(内测|测试版本|预览版|免责声明|preview|beta|DeepSeek\s+Harness)/i.test(String(dialog.textContent || ''))) return
        dialog.style.setProperty('display', 'none', 'important')
        window.__TASKHIVE_INTERNAL_NOTICE_REMOVED__ = true
        button.click()
      }
      // The brand scrubbers below exist to remove the VENDOR's chrome words
      // ("DeepSeek Harness", the vendor logo). They must never touch a CONTROL:
      // the composer's model seat renders the SELECTED MODEL's own name, so
      // choosing a DeepSeek model puts the vendor's name inside the model
      // selector — and a text-only test hid that selector or replaced its row
      // with the TaskHive wordmark (reported as "after switching the model to
      // deepseek the input-box model picker disappeared and became taskhive").
      // Content that names a model is content, not branding.
      const BRAND_SCRUB_EXEMPT = 'button,[role="button"],[role="combobox"],[aria-haspopup],[role="listbox"],[role="menu"],[role="dialog"],[aria-modal="true"],[data-slot*="model" i]'
      // The vendor wordmark and nothing else. A model label such as
      // "DeepSeek V4 Flash", "DeepSeek Chat" or "deepseek-reasoner" must not match:
      // only the bare vendor name (optionally followed by its product qualifier).
      const VENDOR_BRAND_TEXT = /^deepseek(?:\s+(?:harness|preview|beta))?$/i
      const COMPOSER_BRAND_TEXT = /^(探索未至之境|Explore the unexplored|Explore the unknown)$/i
      const replaceComposerBrand = (candidates) => {
        const original = candidates.find((node) => {
          const raw = String(node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!raw || raw.length > 40 || !COMPOSER_BRAND_TEXT.test(raw)) return false
          const text = String(node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!COMPOSER_BRAND_TEXT.test(text)) return false
          const rect = node.getBoundingClientRect()
          return rect.width > 80 && rect.width < 520 && rect.height > 20 && rect.height < 120 && rect.x > window.innerWidth * 0.2
        })
        if (!original) return
        // Replace the matched NODE, never its container. The tagline shares its row
        // with the composer's controls, so overwriting the whole container deleted
        // the model seat and left the brand wordmark where the picker used to be.
        if (!original.parentElement) return
        original.dataset.taskhiveComposerBrand = 'true'
        if (!original.querySelector('[data-taskhive-brand-text="true"]') || original.querySelector('[data-taskhive-brand-icon="true"]')) {
          original.innerHTML = brandWordmarkMarkup
        }
      }
      // Keep the native Harness reasoning disclosure as the single progress
      // surface.  The provider has already chosen which reasoning summary is
      // user-visible; this bridge only controls presentation and never creates
      // or logs a hidden chain-of-thought stream.
      const syncDeepDivingDisclosures = (root = document) => {
        for (const thinkRoot of nodesWithin(root, '[data-variant="think"]')) {
          const trigger = thinkRoot.querySelector('button[aria-expanded],[role="button"][aria-expanded]')
          if (!trigger) continue
          const state = thinkRoot.getAttribute('data-state') === 'running' ? 'running' : 'complete'
          thinkRoot.dataset.taskhiveDeepDiving = 'true'
          const publicSummary = state === 'running'
            ? '阶段：正在分析 · 检查对象：当前任务 · 工具动作：由 Harness 调度 · 下一步：等待结果'
            : '阶段：分析完成 · 证据：已返回公开结果 · 下一步：查看回答'
          const body = thinkRoot.querySelector('[class*="thinkBody"]')
          if (body && body.textContent !== publicSummary) {
            body.textContent = publicSummary
            body.dataset.taskhivePublicReasoning = 'true'
          }
          const summaryNode = thinkRoot.querySelector('[class*="summary"]')
          if (summaryNode && summaryNode.textContent !== publicSummary) {
            summaryNode.textContent = publicSummary
            summaryNode.dataset.taskhivePublicReasoning = 'true'
          }

          const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const value = String(walker.currentNode.nodeValue || '').trim()
            if (/^(Think|Deep diving(?:\.\.\.|…))$/i.test(value)) {
              if (value !== 'Deep diving...') walker.currentNode.nodeValue = 'Deep diving...'
              break
            }
          }

          // Presentation only: whether the row is open is the USER's decision. The
          // seam used to force it open while the model was thinking (and closed when
          // it finished) by clicking the trigger. That cannot be made reliable: the
          // disclosure is re-created by React while reasoning streams, so any
          // node-scoped "the user toggled this" marker is lost and the drive reopened
          // the row after every manual collapse. The collapsed row already renders the
          // running summary line (ReasoningRow's `collapsedContent`), so leaving the
          // toggle alone loses no progress information and cannot fight the user.
          const isExpanded = trigger.getAttribute('aria-expanded') === 'true'
          trigger.setAttribute('title', isExpanded ? '点击收起关键思路' : '展开关键思路')
          trigger.setAttribute('aria-label', isExpanded ? 'Deep diving... 关键思路已展开，点击收起' : 'Deep diving... 关键思路已折叠，点击展开')
        }
      }
      const RESIDUAL_LABEL = /^(deepseek\s+harness|预览版|Harness-first automation workspace|标准模式|工作执行模式|Agent 预设|deepseek|harness)$/i
      const hideResidualBrandText = (root) => {
        for (const node of nodesWithin(root, 'a,button,[role="button"],span,div,h1,h2,header')) {
          // Cheap gate: `innerText` and `getBoundingClientRect` force layout,
          // so only pay for nodes that can possibly carry one of these labels.
          const raw = String(node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!raw || raw.length > 40 || !RESIDUAL_LABEL.test(raw)) continue
          const text = String(node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!RESIDUAL_LABEL.test(text)) continue
          if (/^deepseek\s+harness$/i.test(text)) {
            if (node.getBoundingClientRect().width >= 260) continue
            node.style.display = 'none'
            if (!document.querySelector('[data-taskhive-workbench-brand]')) {
              const brand = document.createElement('span')
              brand.style.cssText = brandSpanStyle
              brand.innerHTML = brandSpanMarkup()
              node.parentElement?.insertBefore(brand, node)
            }
            continue
          }
          if (/^预览版$|^Harness-first automation workspace$/i.test(text)) { node.style.display = 'none'; continue }
          if (!node.closest('[role="dialog"],[aria-modal="true"]') && /^(标准模式|工作执行模式)$/i.test(text)) {
            node.style.setProperty('display', 'none', 'important')
            const button = node.closest('button,[role="button"]')
            button?.style.setProperty('display', 'none', 'important')
            button?.parentElement?.style.setProperty('display', 'none', 'important')
            continue
          }
          if (/^Agent 预设$/i.test(text)) {
            node.style.setProperty('display', 'none', 'important')
            node.closest('button,[role="button"],a')?.style.setProperty('display', 'none', 'important')
            continue
          }
          // "deepseek" alone is BOTH the vendor word and a model family name, so
          // the text test is not enough: a model seat that renders "deepseek" was
          // hidden by this branch. Controls are never branding.
          if (/^(deepseek|harness)$/i.test(text) && !node.closest(BRAND_SCRUB_EXEMPT)) node.style.display = 'none'
        }
      }
      const backfillAccessibleNames = (root) => {
        for (const control of nodesWithin(root, 'button,a,[role="button"],[role="tab"],select,input,textarea,summary')) {
          const fallback = String(control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
          // The accessible NAME is what matters; the `title` attribute also pops
          // the native tooltip. Inside the workbench that tooltip lands on the
          // code the user is editing (a dark box the moment they click in), so
          // the workbench keeps `aria-label` only.
          const tooltipAllowed = !control.closest?.('[data-taskhive-codesys-workbench="true"]') && !control.hasAttribute('data-no-native-tooltip')
          if (fallback && !control.getAttribute('title') && tooltipAllowed) control.setAttribute('title', fallback)
          if (fallback && !control.getAttribute('aria-label') && !control.closest('label')) control.setAttribute('aria-label', fallback)
        }
      }
      // ── T093 会话行「…」菜单里的「彻底删除」─────────────────────────────────
      // DSH 把会话菜单项**写死**在 dsh-client-ui-workspace 里（重命名 / 分叉 / 归档），
      // 那个包只声明了 `sidebar.workspaces` 与两个 directoryFlow 插槽，**没有给会话菜单
      // 留扩展点**；会话行本身也只有 role="treeitem" 与哈希类名，**没有会话 id 属性**
      // （id 只出现在拖拽数据里）。所以这一项只能注入 DOM，并且必须靠"行标题 → 会话 id"
      // 的**唯一**匹配来定位目标。为了不猜样式，这里**克隆菜单里现成的「归档会话」项**
      // 再改文字——结构、类名、悬停行为自动一致。
      const SESSION_MENU_ARCHIVE_LABEL = /^(?:归档会话|Archive session)$/i
      // T128 / INV-2：用户要求与 1.0.3 形态一致——「归档会话」下面那一项就叫**「删除会话」**
      // （早前叫「彻底删除」）。位置与行为不变：克隆归档项插在其后，先删文件再归档。
      const SESSION_DELETE_LABEL = '删除会话'
      const sessionMenuDelete = { row: null, busy: false }
      const sessionSummariesById = () => {
        const byId = getOptionalService(ctx, 'sessions')?.list?.getSnapshot?.()?.byId
        return byId && typeof byId === 'object' ? byId : {}
      }
      // 行标题必须取**直接子节点**里的 title 槽：HoverCard 的内容也挂在同一个容器里，
      // 用后代选择器会读到悬浮卡片的预览文字（实测就把标题读成了别的东西，于是匹配失败）。
      const sessionRowTitle = (row) => {
        if (!row) return ''
        for (const child of row.children || []) {
          if (/title/i.test(String(child.className || ''))) return String(child.textContent || '').trim()
        }
        return ''
      }
      // T093b: DSH 的会话行**只在 onDragStart 里**把 node.id 写进 dataTransfer —— DOM 上
      // 没有任何 id 属性。所以这里合成一次 dragstart/dragend 把 id 直接取出来，**完全不依
      // 赖标题**。标题会真实撞车（实测「1」「新会话」这类标题可以对应多个会话），仅靠标题
      // 匹配会长期卡在安全闸门上。
      const probeSessionIdByDrag = (row) => {
        try {
          if (!row || typeof DragEvent !== 'function' || typeof DataTransfer !== 'function') return ''
          const transfer = new DataTransfer()
          row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
          const id = String(transfer.getData('text/plain') || '').trim()
          row.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }))
          return id
        } catch { return '' }
      }
      // 先试精确的 drag 通道；拿不到再退回"唯一标题匹配"。两条路都必须唯一，0 个或多个
      // 一律拒绝——猜错就是删错一个不可恢复的会话。
      const resolveSessionByRow = (row) => {
        const byId = sessionSummariesById()
        const dragged = probeSessionIdByDrag(row)
        if (dragged && byId[dragged]) {
          const summary = byId[dragged]
          if (summary?.running === true) return { ok: false, reason: '会话正在运行' }
          return { ok: true, id: dragged, title: sessionRowTitle(row) || String(summary.displayTitle || dragged), summary }
        }
        const title = sessionRowTitle(row)
        if (!title) return { ok: false, reason: '读不到这一行的标题' }
        const matches = Object.entries(byId).filter(([, summary]) => {
          const labels = [summary?.displayTitle, summary?.title].map((value) => String(value || '').trim()).filter(Boolean)
          return labels.includes(title)
        })
        if (matches.length !== 1) {
          return { ok: false, reason: matches.length ? `标题「${title}」同时对应 ${matches.length} 个会话` : `标题「${title}」对不上任何会话记录` }
        }
        const [id, summary] = matches[0]
        if (summary?.running === true) return { ok: false, reason: '会话正在运行' }
        return { ok: true, id, title, summary }
      }
      const closeOpenSessionMenu = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }
      const runSessionDeleteFromMenu = async (row) => {
        if (sessionMenuDelete.busy) return
        const resolved = resolveSessionByRow(row)
        if (!resolved.ok) {
          // 安全闸门命中：一句话说清，然后把「会话记录」标签打开（那里按会话目录名操作，
          // 不依赖任何 DSH 运行时标记）。
          await noticeDialog('无法删除', `无法定位该会话（${resolved.reason}），已取消。`)
          try { openSessionRecordsTab?.() } catch { /* 打不开也不影响"没删"这个结果 */ }
          return
        }
        const active = String(getOptionalService(ctx, 'sessions')?.list?.getSnapshot?.()?.current || '')
        if (resolved.id === active) { await noticeDialog('无法删除', '这是当前打开的会话。'); return }
        const accepted = await showTaskHiveDialog({
          title: '删除会话', confirm: true, danger: true, acceptLabel: '删除',
          message: `确认删除「${resolved.title}」？`,
        })
        if (!accepted) return
        sessionMenuDelete.busy = true
        try {
          // T094: 先删文件、再归档——顺序反过来会出现"行消失了但磁盘没回收"的假象。
          const result = await sessionRecordsApi('purge', { targets: [{ session: resolved.id }], confirm: true, activeSessionId: active })
          if (!result) { await noticeDialog('删除失败', '宿主未响应，请重启 TaskHive 后重试。'); return }
          const done = result.deleted[0]
          if (!done) { await noticeDialog('未删除', `${result.skipped[0]?.reason || '未知原因'}。`); return }
          try { await archiveSessionFromContext(ctx, resolved.id) } catch { /* 文件已删，归档失败只影响列表刷新 */ }
          await noticeDialog('已删除', `回收 ${formatSessionBytes(done.bytes)}。`)
        } finally { sessionMenuDelete.busy = false }
      }
      const injectSessionDeleteMenuItem = () => {
        // T128 实测根因（第三次，也是真正的原因）：DSH 0.2 的菜单项结构是
        //   <button role="menuitem"><span class="_itemLabel_…">归档会话</span><span>Ctrl+Alt+A</span></button>
        // 原锚点用 `/^归档会话$/` 全等匹配**节点文本**，且选择器列表
        // `[role="menuitem"],button,[role="button"],li,div` **不含 span**：
        //   · `[role="menuitem"]` 的 textContent 是「归档会话Ctrl+Alt+A」→ 全等不成立；
        //   · 纯文本的 `<span>` 又不在选择器里 → 永远匹配不到。
        // 实测证据：菜单打开后 `[data-taskhive-session-delete]` 始终不存在。
        // 改为按「以 归档会话 开头」匹配菜单项本身，再克隆整项插到它后面。
        const archiveItem = [...document.querySelectorAll('[role="menuitem"]')]
          .find((node) => /^(?:归档会话|Archive session)/i.test(String(node.textContent || '').trim()))
        if (!archiveItem) return false
        const list = archiveItem.parentElement
        if (!list || list.querySelector('[data-taskhive-session-delete="true"]')) return false
        const clone = archiveItem.cloneNode(true)
        clone.setAttribute('data-taskhive-session-delete', 'true')
        clone.removeAttribute('aria-keyshortcuts')
        // 标签：把克隆里那个纯文本「归档会话」换成「删除会话」，并清掉快捷键提示节点，
        // 保留图标与结构（结构与悬停行为自动与原生项一致）。
        const leafLabel = [...clone.querySelectorAll('*')].find((node) => node.children.length === 0 && /^(?:归档会话|Archive session)/i.test(String(node.textContent || '').trim()))
        if (leafLabel) leafLabel.textContent = SESSION_DELETE_LABEL
        else clone.textContent = SESSION_DELETE_LABEL
        for (const node of clone.querySelectorAll('*')) {
          if (node === leafLabel || node.children.length !== 0) continue
          const t = String(node.textContent || '').trim()
          if (/^(?:Ctrl|Alt|Shift|⌘|\+|[A-Z])/.test(t) || /Ctrl\+/.test(t)) node.textContent = ''
        }
        clone.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const row = sessionMenuDelete.row
          closeOpenSessionMenu()
          void runSessionDeleteFromMenu(row)
        }, true)
        list.insertBefore(clone, archiveItem.nextSibling)
        return true
      }
      // 记住"最后点过的那一行会话"。会话菜单的触发按钮既不暴露会话 id，也没有稳定的
      // 本地化 aria-label，所以用点击上下文来绑定行——与语言无关，也不需要解析标题以外的
      // 任何东西。
      const rememberSessionRow = (event) => {
        const row = event.target?.closest?.('[class*="sessionRow"]')
        if (row) sessionMenuDelete.row = row
        // T128 实测修正（第二次）：会话操作菜单是**点击之后**才渲染的，而 observer 的那一趟
        // 往往在菜单出现之前就结束了，所以只靠 scrub 里的条件永远赶不上。这里在点击会话行
        // 或它的操作按钮之后安排几次延迟注入，覆盖菜单渲染时机。注入函数幂等，重复调用安全。
        const label = String(event.target?.getAttribute?.('aria-label') || '')
        if (row || /操作|归档会话/.test(label)) {
          for (const delay of [0, 120, 400, 900]) {
            setTimeout(() => { try { injectSessionDeleteMenuItem() } catch { /* 注入失败不影响点击本身 */ } }, delay)
          }
        }
      }
      document.addEventListener('click', rememberSessionRow, true)

      const scrub = (root = document, isDocument = root === document) => {
        const dialogOpen = Boolean(document.querySelector('[aria-modal="true"]'))
        // T093: 会话行「…」菜单里的「彻底删除」。只在刚点过会话行之后才做，避免每次
        // scrub 都全文档查菜单。
        // T128 实测修正：原先只认 `sessionMenuDelete.row`，而点开菜单时 observer 的这一趟
        // 可能已经跑过，于是「删除会话」永远不会出现（CDP 实测：菜单里只有取消置顶/重命名/
        // 分叉会话/归档会话，`[data-taskhive-session-delete]` 不存在）。改为**只要会话操作
        // 菜单当前是打开的**就补注入一次；注入函数自身有幂等判断，重复调用无副作用。
        const sessionMenuOpen = Boolean(document.querySelector('[role="menu"]'))
        if (sessionMenuDelete.row || sessionMenuOpen) injectSessionDeleteMenuItem()
        // Runs on EVERY pass, not only the first document scan. The sidebar brand
        // renders after plugin init and React re-parents the mark on each
        // collapse/expand, so a one-shot document scan reliably missed it — which
        // is why the vendor logo and its name stayed visible. These are three
        // querySelector calls plus a text compare over one small row, so the cost
        // is negligible next to the root-scoped work below.
        reconcileSidebarBrand()
        if (isDocument) dismissInternalPreviewNotice()
        for (const button of nodesWithin(root, 'button,[role="button"],a')) {
          const title = String(button.getAttribute('title') || '')
          const label = String(button.getAttribute('aria-label') || '')
          const text = String(button.textContent || '').trim().replace(/\s+/g, ' ')
          hideComposerDuplicate(button, text, dialogOpen)
          if (!button.closest('[role="dialog"],[aria-modal="true"]') && (/Agent 预设/.test(title) || /^标准模式$/.test(text))) {
            button.style.setProperty('display', 'none', 'important')
            for (const child of button.querySelectorAll('*')) child.style.setProperty('display', 'none', 'important')
          }
          if (/^Agent 预设$/.test(text) || /Agent 预设/.test(label)) button.style.setProperty('display', 'none', 'important')
        }
        const candidates = root.nodeType === Node.ELEMENT_NODE
          ? [root, ...root.querySelectorAll('*')]
          : [...root.querySelectorAll?.('*') || []]
        replaceComposerBrand(candidates)
        const branded = candidates.find((node) => {
          const raw = String(node.textContent || '').trim().replace(/\s+/g, ' ')
          // VENDOR branding only. `/deepseek/i` used to match any node that merely
          // mentioned the vendor — including the composer's model seat showing
          // "DeepSeek …" — hid its row (target.style.display = 'none' below) and
          // inserted a TaskHive wordmark in its place.
          if (!VENDOR_BRAND_TEXT.test(raw)) return false
          if (node.closest(BRAND_SCRUB_EXEMPT) || node.querySelector(BRAND_SCRUB_EXEMPT)) return false
          const rect = node.getBoundingClientRect()
          return rect.width > 40 && rect.width < 360 && rect.height < 100
        })
        if (branded && !document.querySelector('[data-taskhive-workbench-brand]')) {
          const target = branded.parentElement || branded
          target.style.display = 'none'
          const brand = document.createElement('span')
          brand.style.cssText = brandSpanStyle
          brand.innerHTML = brandSpanMarkup()
          target.parentElement?.insertBefore(brand, target)
        }
        hideResidualBrandText(root)
        if (isDocument) {
          const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
          if (dialog && /设置|settings/i.test(String(dialog.textContent || ''))) {
            const modelButtons = [...dialog.querySelectorAll('button,[role="button"]')].filter((node) => /^(模型|models?)$/i.test(String(node.textContent || '').trim()))
            if (modelButtons.length > 1) modelButtons[0].style.setProperty('display', 'none', 'important')
          }
        }
        backfillAccessibleNames(root)
        syncDeepDivingDisclosures(root)
      }
      let scrubScheduled = false
      let scrubTimer = null
      const pendingRoots = new Set()
      const scheduleScrub = (root = document, initial = false) => {
        if (!root) return
        if (initial || root === document) {
          pendingRoots.clear()
          pendingRoots.add(document)
        } else if (![...pendingRoots].some((pending) => pending === document || pending.contains?.(root))) {
          for (const pending of [...pendingRoots]) if (root.contains?.(pending)) pendingRoots.delete(pending)
          pendingRoots.add(root)
        }
        if (scrubScheduled) return
        scrubScheduled = true
        const run = () => {
          scrubScheduled = false
          scrubTimer = null
          const roots = [...pendingRoots]
          pendingRoots.clear()
          for (const pending of roots) scrub(pending, pending === document)
        }
        scrubTimer = typeof requestIdleCallback === 'function'
          ? requestIdleCallback(run, { timeout: 1200 })
          : setTimeout(run, 1000)
      }
      scheduleScrub(document, true)
      // The sidebar can mount without emitting a mutation we observe (slow first
      // paint, hydration). These retries touch only the small brand row, so they
      // are cheap even though they are unconditional.
      const brandRetries = [1200, 3000, 6000].map((delay) => setTimeout(reconcileSidebarBrand, delay))
      // Alpha.2 strips `taskhiveIcon` from the normalized URL. Re-run the skin
      // once the bridge hands the host-owned icon back, otherwise the restored
      // TaskHive brand would render without its glyph.
      if (!taskhiveBrandIcon) void resolveTaskhiveBrandIcon().then((icon) => { if (icon) scheduleScrub(document, true) })
      window.__TASKHIVE_SYNC_DEEP_DIVING__ = () => syncDeepDivingDisclosures(document)
      const relevantSelector = 'a,button,[role="button"],header,[data-variant="think"],[class*="brand" i]'
      // The brand mark and wordmark live inside DSH's React tree, so every
      // re-render (notably a sidebar collapse/expand) recreates the vendor nodes
      // and discards our replacement. The scheduled idle scrub re-applies it, but
      // that leaves a window in which the vendor logo and wordmark are visible.
      // Reconciling synchronously here — the observer callback runs as a
      // microtask right after React commits — closes that window. It is three
      // querySelector calls, so it is cheap enough to do on every brand mutation.
      const brandTouched = (node) => Boolean(node?.matches?.('[class*="brand" i],[data-slot^="sidebar.brand"]')
        || node?.closest?.('[class*="logoRow"],[class*="brand" i]')
        || node?.querySelector?.('[data-slot^="sidebar.brand"],[class*="brand" i]'))
      // T091: 我们注入的品牌节点被 React 丢掉时，这次 childList 变更**只有
      // removedNodes**，没有 addedNodes —— 旧循环只看 addedNodes，于是
      // reconcileSidebarBrand() 再也不会被调用。而 vendor 节点是被 React 复用的
      // （它身上还留着我们上次加的 display:none!important），结果就是一个**空槽**：
      // 图标和文字一起消失，直到下一次"有新增"的渲染才恢复。
      const isOurBrandNode = (node) => {
        if (node?.nodeType !== Node.ELEMENT_NODE) return false
        const OWNED = '[data-taskhive-brand-mark],[data-taskhive-brand-wordmark],[data-taskhive-brand-text],[data-taskhive-brand-icon]'
        return node.matches?.(OWNED) === true || Boolean(node.querySelector?.(OWNED))
      }
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (mutation.target.matches?.(relevantSelector) || mutation.target.closest?.('[class*="brand" i]')) { reconcileSidebarBrand(); scheduleScrub(mutation.target) }
            continue
          }
          for (const node of mutation.removedNodes) {
            if (!isOurBrandNode(node) && !brandTouched(node)) continue
            // Re-inject only; keep the scrub scoped to the brand row. Escalating to
            // `document` here would restore the whole-page innerText/layout pass that
            // T029/T037 removed.
            reconcileSidebarBrand()
            const container = document.querySelector('[class*="logoRow"]') || document.querySelector(SIDEBAR_MARK_SELECTOR)?.parentElement
            if (container) scheduleScrub(container)
            break
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue
            if (brandTouched(node)) reconcileSidebarBrand()
            const brandRoot = node.matches(relevantSelector)
              ? node
              : node.closest?.(relevantSelector) || node.querySelector(relevantSelector)
            if (brandRoot) scheduleScrub(brandRoot)
            // Keep the icon/image cleanup local to the added subtree. Escalating
            // to `document` here re-introduced the whole-page innerText and
            // layout scrub on every streamed image (T029/T037 regression).
            else if (node.matches?.('img,svg') || node.querySelector?.('img,svg')) scheduleScrub(node.parentElement || node)
          }
        }
      })
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'aria-expanded', 'class'],
      })
      // T091: a sidebar collapse/expand is a layout change that also re-parents the
      // brand; the observer cannot see the re-parent itself when React keeps both the
      // slot and its vendor child, so re-assert on resize. Three querySelector calls,
      // no timer — this does NOT reintroduce T069's periodic engine work.
      const onBrandResize = () => reconcileSidebarBrand()
      window.addEventListener('resize', onBrandResize)
      document.addEventListener('visibilitychange', onBrandResize)
      window.__TASKHIVE_SKIN_DISPOSE__ = () => {
        observer.disconnect()
        document.removeEventListener('click', rememberSessionRow, true)
        window.removeEventListener('resize', onBrandResize)
        document.removeEventListener('visibilitychange', onBrandResize)
        for (const timer of brandRetries) clearTimeout(timer)
        if (scrubTimer !== null) {
          if (typeof cancelIdleCallback === 'function') cancelIdleCallback(scrubTimer)
          else clearTimeout(scrubTimer)
        }
        scrubTimer = null
        pendingRoots.clear()
        delete window.__TASKHIVE_SYNC_DEEP_DIVING__
      }
    }

    function WebModelSelect() {
      const [models, setModels] = React.useState([])
      const [selected, setSelected] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let disposed = false
        Promise.resolve(window.taskhive?.listModels?.()).then((catalog) => {
          if (disposed) return
          const provider = catalog?.providers?.find((item) => item.id === 'web-ai' && item.state === 'ready')
          setModels(provider?.models || [])
          setSelected(catalog?.browserRoute?.modelId || '')
        }).catch(() => { if (!disposed) setModels([]) })
        return () => { disposed = true }
      }, [])
      if (!models.length) return null
      const labels = { 'deepseek-web': 'DeepSeek', 'kimi-web': 'Kimi', 'doubao-web': '豆包', 'yuanbao-web': '腾讯元宝', 'qwen-web': '通义千问', 'chatgpt-web': 'ChatGPT', 'claude-web': 'Claude', 'gemini-web': 'Gemini' }
      const change = async (event) => {
        const modelId = event.target.value
        if (!modelId || busy || !window.taskhive?.selectModel) return
        setBusy(true)
        try {
          await window.taskhive.selectModel({ providerId: 'web-ai', modelId })
          setSelected(modelId)
          openSurface('web-ai')
        } finally { setBusy(false) }
      }
      return h('select', {
        value: selected,
        disabled: busy,
        onChange: change,
        'data-taskhive-web-model': 'true',
        'aria-label': '切换网页 AI 模型',
        title: '网页 AI：选择后在中央浏览器打开，不作为 Harness 自动推理模型',
      }, h('option', { value: '' }, '网页 AI'), ...models.map((modelId) => h('option', { key: modelId, value: modelId }, `网页 · ${labels[modelId] || modelId}`)))
    }

    // Surface chrome (Settings / 模型 / 知识库 tabs). These previously
    // fell back to near-black and transparent, which is what made the embedded
    // settings pages read as monochrome wireframes. The TaskHive brand accent
    // now carries the interactive affordances.
    // T096b: no bold anywhere in this table — the session panel and the settings
    // surfaces must read as one and the same interface. Weight is carried by the
    // --dsw-alias-* colour ladder and 1px separators instead.
    const surfaceStyles = {
      column: { display: 'grid', gap: '12px', color: 'var(--dsw-alias-label-primary, var(--th-ink))', font: '13px/1.5 Inter,"Microsoft YaHei",system-ui,sans-serif' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle, var(--th-line))' },
      button: { height: '30px', padding: '0 10px', border: '1px solid var(--th-brand-line)', borderRadius: '6px', background: 'var(--th-brand-tint)', color: 'var(--th-brand-ink)', font: 'inherit', fontWeight: 400, cursor: 'pointer' },
      input: { height: '32px', minWidth: 0, padding: '0 9px', border: '1px solid var(--dsw-alias-border-subtle, var(--th-line))', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1, var(--th-surface))', color: 'inherit', font: 'inherit' },
    }

    function DirectorySettingsItem() {
      const [directories, setDirectories] = React.useState({ entries: [] })
      const [draft, setDraft] = React.useState({ id: '', name: '', path: '', gitUrl: '' })
      const [message, setMessage] = React.useState('')
      const reload = () => Promise.resolve(window.taskhive?.listDirectories?.()).then((value) => setDirectories(value || { entries: [] })).catch((error) => setMessage(error.message))
      React.useEffect(() => { void reload() }, [])
      const update = (id, field, value) => setDirectories((current) => ({ ...current, entries: (current.entries || []).map((entry) => entry.id === id ? { ...entry, [field]: value } : entry) }))
      const save = async (entry) => { try { setDirectories(await window.taskhive.saveDirectory({ ...entry, previousId: entry.id })); setMessage(`已保存：${entry.name}`) } catch (error) { setMessage(error.message) } }
      const remove = async (entry) => { try { setDirectories(await window.taskhive.removeDirectory(entry.id)); setMessage(`已删除：${entry.name}`) } catch (error) { setMessage(error.message) } }
      const add = async () => { try { setDirectories(await window.taskhive.saveDirectory(draft)); setDraft({ id: '', name: '', path: '', gitUrl: '' }); setMessage('目录项已添加') } catch (error) { setMessage(error.message) } }
      const restore = async () => { try { setDirectories(await window.taskhive.restoreDirectories()); setMessage('已恢复默认目录') } catch (error) { setMessage(error.message) } }
      const fieldStyle = { display: 'grid', minWidth: 0, gap: '4px', color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '12px' }
      const inputStyle = { ...surfaceStyles.input, width: '100%', boxSizing: 'border-box' }
      const actionsStyle = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }
      const cardStyle = { display: 'grid', minWidth: 0, gap: '9px', padding: '10px', border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.22))', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1, transparent)' }
      const fieldsStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', minWidth: 0, gap: '8px' }
      return h('details', { 'data-taskhive-settings-directories': 'true', style: { padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.2))' } },
        h('summary', { title: '展开并编辑 TaskHive 工作目录与 Git 仓库地址', style: { cursor: 'pointer', fontWeight: 400, userSelect: 'none' } }, '工作目录与仓库'),
        h('div', { 'data-directory-list': 'true', style: { display: 'grid', minWidth: 0, gap: '8px', marginTop: '10px' } },
          ...(directories.entries || []).map((entry) => h('section', { key: entry.id, 'data-directory-row': entry.id, style: cardStyle },
            h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(86px,auto) minmax(140px,1fr) auto', minWidth: 0, gap: '8px', alignItems: 'center' } },
              h('code', { title: entry.id, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '12px' } }, entry.id),
              h('label', { style: fieldStyle }, h('span', null, '名称'), h('input', { style: inputStyle, value: entry.name, 'aria-label': `${entry.id} 名称`, onChange: (event) => update(entry.id, 'name', event.target.value) })),
              h('span', { 'data-directory-actions': 'true', style: actionsStyle },
                h('button', { type: 'button', style: surfaceStyles.button, title: '保存目录项', onClick: () => save(entry) }, '保存'),
                h('button', { type: 'button', style: surfaceStyles.button, title: '删除目录项', onClick: () => remove(entry) }, '删除'))),
            h('div', { style: fieldsStyle },
              h('label', { style: fieldStyle }, h('span', null, '绝对路径'), h('input', { style: inputStyle, value: entry.path, title: entry.path, 'aria-label': `${entry.id} 绝对路径`, onChange: (event) => update(entry.id, 'path', event.target.value) })),
              h('label', { style: fieldStyle }, h('span', null, 'Git 仓库地址'), h('input', { style: inputStyle, value: entry.gitUrl || '', placeholder: 'https:// / ssh:// / git@ / file://', 'aria-label': `${entry.id} Git 地址`, onChange: (event) => update(entry.id, 'gitUrl', event.target.value) }))))),
          h('section', { 'data-directory-row': 'new', style: { ...cardStyle, borderStyle: 'dashed' } },
            h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(100px,.7fr) minmax(150px,1fr) auto', minWidth: 0, gap: '8px', alignItems: 'end' } },
              h('label', { style: fieldStyle }, h('span', null, 'ID'), h('input', { style: inputStyle, value: draft.id, placeholder: 'custom-id', 'aria-label': '新目录 ID', onChange: (event) => setDraft({ ...draft, id: event.target.value }) })),
              h('label', { style: fieldStyle }, h('span', null, '名称'), h('input', { style: inputStyle, value: draft.name, placeholder: '显示名称', 'aria-label': '新目录名称', onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
              h('span', { 'data-directory-actions': 'true', style: actionsStyle }, h('button', { type: 'button', style: surfaceStyles.button, title: '添加自定义目录项', onClick: add }, '添加'))),
            h('div', { style: fieldsStyle },
              h('label', { style: fieldStyle }, h('span', null, '绝对路径'), h('input', { style: inputStyle, value: draft.path, placeholder: 'C:\\absolute\\path', 'aria-label': '新目录绝对路径', onChange: (event) => setDraft({ ...draft, path: event.target.value }) })),
              h('label', { style: fieldStyle }, h('span', null, 'Git 仓库地址'), h('input', { style: inputStyle, value: draft.gitUrl, placeholder: '可选 Git 地址', 'aria-label': '新目录 Git 地址', onChange: (event) => setDraft({ ...draft, gitUrl: event.target.value }) }))),
          h('div', { style: { ...actionsStyle, justifyContent: 'space-between' } },
            message ? h('span', { role: 'status', style: { color: 'var(--dsw-alias-label-secondary, #666)' } }, message) : h('span'),
            h('button', { type: 'button', style: surfaceStyles.button, title: '恢复八个默认工作目录', onClick: restore }, '恢复默认')))))
    }

    function ModelCatalogSection() {
      const [catalog, setCatalog] = React.useState(null)
      const [draft, setDraft] = React.useState({ providerId: '', name: '', modelId: '', kind: 'api', endpoint: '', apiKey: '', protocol: 'openai' })
      // Per-provider credential drafts, keyed by provider id. Kept separate from
      // `catalog` so a typed key is never round-tripped back from the host (the
      // host only ever sends a mask).
      const [credentials, setCredentials] = React.useState({})
      const [message, setMessage] = React.useState('')
      const reload = () => Promise.resolve(window.taskhive?.listModels?.()).then(setCatalog).catch((error) => setMessage(error.message))
      React.useEffect(() => { void reload() }, [])
      const toggle = async (providerId, modelId, visible) => { try { await window.taskhive.setModelVisible({ providerId, modelId, visible }); setMessage('已保存；模型目录将在约 1 秒后刷新（Harness 需要重新载入模型表），刷新后新勾选的模型会出现在输入框模型选择中'); await reload() } catch (error) { setMessage(error.message) } }
      const add = async () => {
        try {
          const result = await window.taskhive.addCustomModel({ ...draft, visible: true })
          setDraft({ providerId: '', name: '', modelId: '', kind: 'api', endpoint: '', apiKey: '', protocol: 'openai' })
          setMessage(result?.state === 'ready'
            ? '自定义模型已加入目录并可用于对话'
            : `自定义模型已加入目录，但仍是 ${result?.state || 'unconfigured'}：请补全服务地址与 API Key`)
          await reload()
        } catch (error) { setMessage(error.message) }
      }
      const remove = async (providerId) => { try { await window.taskhive.removeCustomModel(providerId); await reload() } catch (error) { setMessage(error.message) } }
      // Saving a credential restarts the Harness so the key reaches its
      // environment; report that plainly because it briefly drops the session.
      const saveCredential = async (provider) => {
        const entry = credentials[provider.id] || {}
        try {
          const result = await window.taskhive.setModelCredential({
            providerId: provider.id,
            endpoint: entry.endpoint === undefined ? undefined : entry.endpoint,
            apiKey: entry.apiKey === undefined ? undefined : entry.apiKey,
          })
          setCredentials({ ...credentials, [provider.id]: {} })
          setMessage(`${provider.name}：${result.state === 'ready' ? '已就绪' : '仍缺少服务地址或 API Key'} · Harness 已重启以载入凭据`)
          await reload()
        } catch (error) { setMessage(error.message) }
      }
      const credentialDraft = (provider) => credentials[provider.id] || {}
      const setCredentialDraft = (provider, patch) => setCredentials({ ...credentials, [provider.id]: { ...credentialDraft(provider), ...patch } })
      const isConfigurable = (provider) => ['api', 'local'].includes(provider.kind)
      return h('section', { 'data-taskhive-model-settings': 'true', style: surfaceStyles.column },
        h('div', null, h('h2', { style: { margin: 0, font: 'inherit', fontSize: '13px', fontWeight: 400 } }, '模型'), h('p', { style: { margin: '5px 0 0', color: 'var(--dsw-alias-label-secondary, #666)' } }, '统一管理 Codex、Claude、DeepSeek 等 API、本地与网页模型；勾选项才会进入输入框模型目录。API Key 只保存在本机并只注入 Harness 子进程环境，不会回传界面。')),
        ...(catalog?.providers || []).map((provider) => h('section', { key: provider.id, style: { padding: '0 12px', border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.22))', borderRadius: '8px' } },
          h('div', { style: surfaceStyles.row }, h('span', null, h('strong', null, provider.name), h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, `${provider.state} · ${provider.authentication || '未声明认证'} · ${provider.vision?.state === 'ready' ? '视觉已就绪' : provider.kind === 'web' ? '网页模型不接管视觉' : '视觉未接入'}`)), provider.custom ? h('button', { type: 'button', style: surfaceStyles.button, title: '删除自定义模型提供方', onClick: () => remove(provider.id) }, '删除') : null),
          ...(provider.models || []).map((modelId) => h('label', { key: modelId, style: { ...surfaceStyles.row, cursor: 'pointer' }, title: '控制此模型是否出现在输入框模型选择中' }, h('span', null, modelId), h('input', { type: 'checkbox', checked: catalog.visibility?.[`${provider.id}::${modelId}`] !== false, onChange: (event) => toggle(provider.id, modelId, event.target.checked), 'aria-label': `${modelId} 在输入框显示` }))),
          // Credential row. The advertised endpoint is a real value read back
          // from the catalog, so a configured provider shows what it will call.
          isConfigurable(provider) ? h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.4fr) auto', gap: '7px', padding: '6px 0 10px' } },
            h('input', {
              style: surfaceStyles.input,
              value: credentialDraft(provider).endpoint ?? provider.endpoint ?? '',
              placeholder: '服务地址，例如 https://api.deepseek.com',
              'aria-label': `${provider.name} 服务地址`,
              title: 'OpenAI 兼容或 Anthropic 兼容的基础地址',
              onChange: (event) => setCredentialDraft(provider, { endpoint: event.target.value }),
            }),
            h('input', {
              style: surfaceStyles.input,
              type: 'password',
              value: credentialDraft(provider).apiKey ?? '',
              placeholder: provider.hasApiKey ? `已保存 ${provider.apiKeyMasked || '•'}（输入以替换）` : `API Key（环境变量 ${provider.apiKeyEnv || '-'}）`,
              'aria-label': `${provider.name} API Key`,
              title: '仅保存在本机 profiles/api-credentials.json，并注入 Harness 子进程环境',
              onChange: (event) => setCredentialDraft(provider, { apiKey: event.target.value }),
            }),
            h('button', { type: 'button', style: surfaceStyles.button, title: '保存服务地址与 API Key，并重启 Harness 使其生效', 'data-taskhive-save-credential': provider.id, onClick: () => saveCredential(provider) }, '保存凭据'),
          ) : null,
        )),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr)) auto', gap: '7px', paddingTop: '6px' } },
          h('input', { style: surfaceStyles.input, value: draft.providerId, placeholder: 'Provider ID', 'aria-label': '自定义 Provider ID', onChange: (event) => setDraft({ ...draft, providerId: event.target.value }) }),
          h('input', { style: surfaceStyles.input, value: draft.name, placeholder: '显示名称', 'aria-label': '自定义模型显示名称', onChange: (event) => setDraft({ ...draft, name: event.target.value }) }),
          h('input', { style: surfaceStyles.input, value: draft.modelId, placeholder: 'Model ID', 'aria-label': '自定义 Model ID', onChange: (event) => setDraft({ ...draft, modelId: event.target.value }) }),
          h('select', { style: surfaceStyles.input, value: draft.kind, 'aria-label': '自定义模型类型', onChange: (event) => setDraft({ ...draft, kind: event.target.value }) }, h('option', { value: 'api' }, 'API'), h('option', { value: 'local' }, '本地')),
          h('button', { type: 'button', style: surfaceStyles.button, title: '添加自定义模型', onClick: add }, '添加'),
        ),
        // Custom API endpoints need the same two fields the adapter reads.
        draft.kind === 'api' ? h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)', gap: '7px' } },
          h('input', { style: surfaceStyles.input, value: draft.endpoint, placeholder: '服务地址，例如 https://api.openai.com/v1', 'aria-label': '自定义模型服务地址', onChange: (event) => setDraft({ ...draft, endpoint: event.target.value }) }),
          h('input', { style: surfaceStyles.input, type: 'password', value: draft.apiKey, placeholder: 'API Key（可留空后补）', 'aria-label': '自定义模型 API Key', onChange: (event) => setDraft({ ...draft, apiKey: event.target.value }) }),
          h('select', { style: surfaceStyles.input, value: draft.protocol, 'aria-label': '自定义模型协议', title: '协议决定请求格式：OpenAI 兼容 / Anthropic 兼容', onChange: (event) => setDraft({ ...draft, protocol: event.target.value }) }, h('option', { value: 'openai' }, 'OpenAI 兼容'), h('option', { value: 'anthropic' }, 'Anthropic 兼容')),
        ) : null,
        message ? h('div', { role: 'status', style: { color: 'var(--dsw-alias-label-secondary, #666)' } }, message) : null,
      )
    }

    function PluginInventoryTab() {
      const [items, setItems] = React.useState([])
      const [source, setSource] = React.useState('')
      const [message, setMessage] = React.useState('')
      const reload = () => Promise.resolve(window.taskhive?.listPlugins?.()).then(setItems).catch((error) => setMessage(error.message))
      React.useEffect(() => { void reload() }, [])
      const toggle = async (item) => { try { if (item.state === 'disabled') await window.taskhive.enablePlugin(item.id); else await window.taskhive.disablePlugin(item.id); await reload() } catch (error) { setMessage(error.message) } }
      const uninstall = async (item) => { try { await window.taskhive.uninstallPlugin(item.id); await reload() } catch (error) { setMessage(error.message) } }
      // T136：改完位置后立即让客户端重注册入口（左栏/右栏/隐藏），否则下拉"看起来生效、
      // 实际左栏入口还在、右栏也没有东西"。
      const place = async (item, placement) => { try { await window.taskhive.setPluginPlacement({ id: item.id, placement }); await window.__TASKHIVE_REFRESH_PLACEMENTS__?.(); await reload() } catch (error) { setMessage(error.message) } }
      const install = async () => { if (!source.trim()) return; try { await window.taskhive.installPlugin({ source: source.trim() }); setSource(''); await reload() } catch (error) { setMessage(error.message) } }
      return h('section', { 'data-taskhive-plugin-inventory': 'true', style: surfaceStyles.column },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '8px' } }, h('input', { style: surfaceStyles.input, value: source, placeholder: 'Git 地址或本地插件目录', 'aria-label': '插件来源', onChange: (event) => setSource(event.target.value) }), h('button', { type: 'button', style: surfaceStyles.button, title: '安装本地或 Git 插件', onClick: install }, '安装')),
        ...items.map((item) => h('div', { key: item.id, 'data-plugin-row': item.id, 'data-plugin-source': item.sourceKind || 'local', 'data-plugin-type': item.type || 'background', 'data-plugin-health': item.health || item.state, style: surfaceStyles.row },
          h('span', null,
            h('strong', null, item.name || item.id),
            h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, `${item.id} · v${item.version || '-'} · ${item.sourceKind || 'local'} · ${item.type === 'surface' ? '界面插件' : item.type === 'settings' ? '设置插件' : '后台插件'} · ${item.health === 'healthy' ? '健康' : item.health || item.state}`),
            h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, item.entryConfigurable ? `入口：${item.placement === 'right' ? '右侧栏' : item.placement === 'hidden' ? '隐藏' : '左侧栏'}` : '入口：无侧栏界面'),
          ),
          h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            item.entryConfigurable ? h('select', { value: item.placement || 'left', 'aria-label': `${item.name || item.id} 入口位置`, title: '选择插件在左侧栏、右侧栏显示或隐藏', onChange: (event) => place(item, event.target.value), style: surfaceStyles.input },
              h('option', { value: 'left' }, '左侧栏'), h('option', { value: 'right' }, '右侧栏'), h('option', { value: 'hidden' }, '隐藏')) : null,
            h('button', { type: 'button', style: surfaceStyles.button, title: item.protected ? '系统插件不可停用' : item.state === 'disabled' ? '启用插件' : '停用插件', disabled: item.protected, onClick: () => toggle(item) }, item.state === 'disabled' ? '启用' : '停用'),
            h('button', { type: 'button', style: surfaceStyles.button, title: item.protected ? '系统插件不可卸载' : '卸载并保留备份', disabled: item.protected, onClick: () => uninstall(item) }, '卸载'),
          ),
        )),
        message ? h('div', { role: 'status' }, message) : null,
      )
    }
