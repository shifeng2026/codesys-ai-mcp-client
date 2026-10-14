    async function codesysWorkbenchApi(method, payload) {
      // Small same-origin JSON call to the host plugin half. A stopped Harness or
      // an older host without the route must never break the workbench UI.
      try {
        const response = await fetch(`${CODESYS_WORKBENCH_API}.${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
        })
        if (!response.ok) return null
        const parsed = await response.json().catch(() => null)
        return parsed && parsed.ok === true ? parsed.value : null
      } catch { return null }
    }
    const codesysWorkbenchMirror = { state: null, listeners: new Set() }
    // T092: 会话记录维护通道。与工作台同一套"同源 JSON POST 到宿主插件"的做法。
    async function sessionRecordsApi(method, payload) {
      try {
        const response = await fetch(`${CODESYS_SESSIONS_API}.${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
        })
        if (!response.ok) return null
        const parsed = await response.json().catch(() => null)
        return parsed && parsed.ok === true ? parsed.value : null
      } catch { return null }
    }
    function formatSessionBytes(value) {
      const bytes = Math.max(0, Number(value) || 0)
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }
    function formatSessionTime(value) {
      const time = Number(value) || 0
      if (!time) return '—'
      const date = new Date(time)
      const pad = (part) => String(part).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    // T096: 与「设置」界面同一套质感。基准取自本插件自己的设置面（`surfaceStyles`）：
    //   font: 13px/1.5 · 次级文字 12px · 行用下边框分隔而不是盒子 · 按钮 font:inherit
    //   （品牌浅底描边、30px 高）· 卡片 border rgba(127,127,127,.22) + radius 8px。
    // 用户口径："注意字体不要太大，不要加粗字体，和设置界面的 ui 风格和质感保持一致"，
    // 所以这份表里**没有任何 font-weight 大于 500**，字号也不超过 13px。
    // T096b: 口径是整条界面统一的，不是只针对会话面板——设置面（`surfaceStyles` 与
    // 「模型 / 工作目录」两个自定义分节）此前自己就留着 600 和 18px 标题，等于面板在
    // 对齐一个比它更粗、更大的"基准"。这里把基准本身收敛到同一口径：按钮与分节标题
    // 一律 400，模型页标题从 18px 收到 13px，占位靠 --dsw-alias-* 颜色和分隔线，不靠粗体。
    const SESSION_PANEL_CSS = `
[data-taskhive-sessions="true"]{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,var(--th-ink,#171717));font:13px/1.5 Inter,"Microsoft YaHei",system-ui,sans-serif}
[data-taskhive-sessions="true"] .th-sess-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-subtle,var(--th-line,#e6e6e6))}
[data-taskhive-sessions="true"] .th-sess-title{font:inherit;color:var(--dsw-alias-label-primary,var(--th-ink,#171717))}
[data-taskhive-sessions="true"] .th-sess-sum{color:var(--dsw-alias-label-secondary,#666);font-size:12px;cursor:help}
[data-taskhive-sessions="true"] .th-sess-tools{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
[data-taskhive-sessions="true"] .th-sess-btn{height:30px;padding:0 10px;border:1px solid var(--th-brand-line,#d3dcfb);border-radius:6px;background:var(--th-brand-tint,#eef2fe);color:var(--th-brand-ink,#2f47b8);font:inherit;cursor:pointer}
[data-taskhive-sessions="true"] .th-sess-btn:hover:not(:disabled){border-color:var(--th-brand,#4f6ef2);background:var(--th-brand-tint,#eef2fe);color:var(--th-brand-strong,#3f5ce0)}
[data-taskhive-sessions="true"] .th-sess-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--th-brand,#4f6ef2));outline-offset:1px}
[data-taskhive-sessions="true"] .th-sess-btn:disabled{opacity:.45;cursor:not-allowed}
[data-taskhive-sessions="true"] .th-sess-btn-danger{border-color:#e4c4c1;background:transparent;color:#a3403a}
[data-taskhive-sessions="true"] .th-sess-btn-danger:hover:not(:disabled){border-color:#d9a9a5;background:#fdf4f3;color:#8f322c}
[data-taskhive-sessions="true"] .th-sess-list{min-height:0;overflow:auto;padding:12px;display:grid;gap:12px;align-content:start}
[data-taskhive-sessions="true"] .th-sess-group{border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.22));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-taskhive-sessions="true"] .th-sess-group-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2,var(--th-surface-2,#f7f8fb));border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.18))}
[data-taskhive-sessions="true"] .th-sess-group-name{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-sessions="true"] .th-sess-group-meta{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;white-space:nowrap}
[data-taskhive-sessions="true"] .th-sess-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.16))}
[data-taskhive-sessions="true"] .th-sess-row:last-child{border-bottom:0}
[data-taskhive-sessions="true"] .th-sess-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--th-surface-3,#eef1f7))}
[data-taskhive-sessions="true"] .th-sess-row[data-selected="true"]{background:var(--th-brand-tint,#eef2fe)}
[data-taskhive-sessions="true"] .th-sess-row[data-active="true"]{cursor:default}
[data-taskhive-sessions="true"] .th-sess-row[data-active="true"] .th-sess-id{color:var(--dsw-alias-label-tertiary,#8a8a8a)}
[data-taskhive-sessions="true"] .th-sess-row input{margin:0}
[data-taskhive-sessions="true"] .th-sess-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary,#666)}
[data-taskhive-sessions="true"] .th-sess-time,[data-taskhive-sessions="true"] .th-sess-size{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;white-space:nowrap}
[data-taskhive-sessions="true"] .th-sess-size{min-width:64px;text-align:right}
[data-taskhive-sessions="true"] .th-sess-badge{flex:none;border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.28));border-radius:999px;padding:0 6px;margin-left:6px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font:12px/1.5 inherit}
[data-taskhive-sessions="true"] .th-sess-empty{padding:12px;color:var(--dsw-alias-label-secondary,#666)}
[data-taskhive-sessions="true"] .th-sess-error{margin:12px 12px 0;padding:8px 10px;border:1px solid #e4c4c1;border-radius:8px;background:#fdf4f3;color:#a3403a;font-size:12px}
[data-taskhive-sessions="true"] .th-sess-actions{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-subtle,var(--th-line,#e6e6e6))}
[data-taskhive-sessions="true"] .th-sess-actions-info{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
[data-taskhive-sessions="true"] .th-sess-actions .th-sess-btn-danger{margin-left:auto}
`
