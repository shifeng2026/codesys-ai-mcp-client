    function installSessionPanelStyle() {
      if (document.getElementById('taskhive-sessions-style')) return
      const style = document.createElement('style')
      style.id = 'taskhive-sessions-style'
      style.textContent = SESSION_PANEL_CSS
      document.head.appendChild(style)
    }

    // ── T094 应用内对话框 ───────────────────────────────────────────────────
    // 用户口径："我要的是 harness 长出了新皮肤，不要给我把弹窗做成其他 ui"。`window.alert`
    // / `window.confirm` 是浏览器原生弹窗，和 TaskHive 皮肤不是一套东西，所以这里做一个
    // 自己的：样式沿用主进程关闭确认框同一组 `--dsw-alias-*` 令牌（8px 圆角、1px 边框、
    // 同一字体与间距），带焦点管理、Esc 取消、点遮罩取消。
    function showTaskHiveDialog(options = {}) {
      const confirmMode = options.confirm === true
      return new Promise((resolve) => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const root = document.createElement('div')
        root.setAttribute('data-taskhive-dialog', 'true')
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:rgba(17,17,17,.28);backdrop-filter:blur(2px);font-family:Inter,"Microsoft YaHei",system-ui,sans-serif'
        const panel = document.createElement('section')
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-modal', 'true')
        panel.style.cssText = 'width:min(460px,calc(100vw - 48px));overflow:hidden;border:1px solid var(--dsw-alias-border-subtle,rgba(23,23,23,.14));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 20px 56px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#171717)'
        const body = document.createElement('div')
        body.style.cssText = 'padding:16px 18px 14px'
        const title = document.createElement('h2')
        // T096: 字号与字重对齐「设置」界面（13px/1.5、不加粗），不要做成大标题。
        title.style.cssText = 'margin:0;font:inherit;font-size:13px;font-weight:400;color:var(--dsw-alias-label-primary,#171717)'
        title.textContent = String(options.title || 'TaskHive')
        const text = document.createElement('p')
        text.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:13px'
        text.textContent = String(options.message || '')
        body.append(title, text)
        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-subtle,#e4e4e4)'
        const buttonStyle = 'height:30px;padding:0 10px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid var(--th-brand-line,#d3dcfb);background:var(--th-brand-tint,#eef2fe);color:var(--th-brand-ink,#2f47b8)'
        const dismiss = (value) => {
          document.removeEventListener('keydown', onKey, true)
          root.remove()
          if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
          resolve(value)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); dismiss(false); return }
          if (event.key !== 'Tab') return
          const focusable = [cancel, accept].filter(Boolean)
          if (focusable.length < 2) return
          const next = document.activeElement === focusable[0] ? focusable[1] : focusable[0]
          event.preventDefault(); next.focus()
        }
        let cancel = null
        let accept = null
        if (confirmMode) {
          cancel = document.createElement('button')
          cancel.type = 'button'
          cancel.textContent = String(options.cancelLabel || '取消')
          cancel.style.cssText = buttonStyle
          cancel.addEventListener('click', () => dismiss(false))
          actions.append(cancel)
        }
        accept = document.createElement('button')
        accept.type = 'button'
        accept.textContent = String(options.acceptLabel || (confirmMode ? '确认' : '确定'))
        accept.style.cssText = options.danger
          // T096: 危险动作也让按钮保持设置界面的质感——统一的 30px 高、font:inherit、
          // 克制的红描边，而不是一大块实心红。
          ? `${buttonStyle};border-color:#e4c4c1;background:transparent;color:#a3403a`
          : buttonStyle
        accept.addEventListener('click', () => dismiss(true))
        actions.append(accept)
        panel.append(body, actions)
        root.append(panel)
        root.addEventListener('mousedown', (event) => { if (event.target === root) dismiss(false) })
        document.addEventListener('keydown', onKey, true)
        document.body.append(root)
        accept.focus()
      })
    }
    const noticeDialog = (title, message) => showTaskHiveDialog({ title, message, acceptLabel: '确定' })

    // ── CODESYS「扫描网络」弹窗 ─────────────────────────────────────────────

    // ── 危险在线动作的弹窗（写变量 / 复位 / Force）──────────────────────────
    // 这三项能驱动机械或清掉保持变量，所以除了工作台授权之外还要**逐字输入确认词**。
    // 弹窗同时承载参数：复位要选类型，写值/Force 要填表达式与目标值。
    // 返回 null（取消）或 { phrase, assignments, resetOption, forceKill }。
    function showCodesysOnlineDangerDialog(options = {}) {
      return new Promise((resolve) => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const expectedPhrase = String(options.phrase || '')
        const resetMode = options.resetMode === true
        const rows = Array.isArray(options.assignments) ? options.assignments.slice(0, 60) : []
        const root = document.createElement('div')
        root.setAttribute('data-taskhive-dialog', 'true')
        root.setAttribute('data-codesys-danger-dialog', 'true')
        root.setAttribute('data-codesys-danger-capability', String(options.capability || ''))
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:rgba(17,17,17,.42);backdrop-filter:blur(2px);font-family:Inter,"Microsoft YaHei",system-ui,sans-serif'
        const panel = document.createElement('section')
        panel.setAttribute('role', 'alertdialog')
        panel.setAttribute('aria-modal', 'true')
        panel.setAttribute('aria-label', String(options.title || '危险操作'))
        panel.style.cssText = 'display:flex;flex-direction:column;width:min(560px,calc(100vw - 48px));max-height:min(78vh,600px);overflow:hidden;border:1px solid #e4c4c1;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 20px 56px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#171717)'
        const body = document.createElement('div')
        body.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-height:0;padding:16px 18px 12px'
        const title = document.createElement('h2')
        title.style.cssText = 'margin:0;font:inherit;font-size:13px;font-weight:400;color:#a3403a'
        title.textContent = String(options.title || '危险操作')
        const warn = document.createElement('p')
        warn.setAttribute('data-codesys-danger-warning', 'true')
        warn.style.cssText = 'margin:0;white-space:pre-wrap;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#666)'
        warn.textContent = (options.lines || []).join('\n')
        body.append(title, warn)

        let resetSelect = null
        let forceKillBox = null
        if (resetMode) {
          resetSelect = document.createElement('select')
          resetSelect.setAttribute('data-codesys-danger-reset', 'true')
          resetSelect.setAttribute('aria-label', '复位类型')
          resetSelect.style.cssText = 'height:30px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:6px;padding:0 8px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
          for (const [value, label] of [['warm', '热复位（Warm）—— 保留保持变量'], ['cold', '冷复位（Cold）—— 清空保持变量'], ['original', '原始复位（Original）—— 恢复出厂初值']]) {
            const option = document.createElement('option')
            option.value = value
            option.textContent = label
            resetSelect.append(option)
          }
          const killLabel = document.createElement('label')
          killLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666)'
          forceKillBox = document.createElement('input')
          forceKillBox.type = 'checkbox'
          forceKillBox.setAttribute('data-codesys-danger-forcekill', 'true')
          killLabel.append(forceKillBox, document.createTextNode('force_kill（强制结束当前应用，不等它自己停）'))
          body.append(resetSelect, killLabel)
        }

        const assignmentInputs = []
        if (rows.length) {
          const list = document.createElement('div')
          list.setAttribute('data-codesys-danger-assignments', 'true')
          list.style.cssText = 'max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f7f7f7)'
          for (const row of rows) {
            const line = document.createElement('div')
            line.style.cssText = 'display:flex;align-items:center;gap:6px'
            const name = document.createElement('input')
            name.value = String(row.expression || '')
            name.setAttribute('data-codesys-danger-assignment', 'true')
            name.setAttribute('aria-label', '表达式')
            name.style.cssText = 'flex:1 1 55%;min-width:0;height:26px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:6px;padding:0 6px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
            const equals = document.createElement('span')
            equals.textContent = '='
            equals.style.cssText = 'flex:none;color:var(--dsw-alias-label-secondary,#666)'
            const value = document.createElement('input')
            value.value = String(row.value || '')
            value.setAttribute('aria-label', '目标值')
            value.setAttribute('data-codesys-danger-value', 'true')
            value.placeholder = row.current ? `当前 ${row.current}` : '目标值'
            value.style.cssText = 'flex:1 1 45%;min-width:0;height:26px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:6px;padding:0 6px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
            line.append(name, equals, value)
            list.append(line)
            assignmentInputs.push({ name, value })
          }
          body.append(list)
        }

        const phraseLabel = document.createElement('label')
        phraseLabel.style.cssText = 'display:flex;flex-direction:column;gap:4px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666)'
        phraseLabel.append(document.createTextNode(`请输入确认词「${expectedPhrase}」后「执行」才会启用：`))
        const phraseInput = document.createElement('input')
        phraseInput.setAttribute('data-codesys-danger-phrase', 'true')
        phraseInput.setAttribute('aria-label', '确认词')
        phraseInput.autocomplete = 'off'
        phraseInput.style.cssText = 'height:30px;border:1px solid #e4c4c1;border-radius:6px;padding:0 8px;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
        phraseLabel.append(phraseInput)
        body.append(phraseLabel)

        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-subtle,#e4e4e4)'
        const plainStyle = 'height:30px;padding:0 10px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);background:transparent;color:var(--dsw-alias-label-primary,#171717)'
        const dangerStyle = 'height:30px;padding:0 10px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid #e4c4c1;background:transparent;color:#a3403a;font-weight:650'
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.setAttribute('data-codesys-danger-cancel', 'true')
        cancel.textContent = '取消'
        cancel.style.cssText = plainStyle
        const confirm = document.createElement('button')
        confirm.type = 'button'
        confirm.setAttribute('data-codesys-danger-confirm', 'true')
        confirm.textContent = String(options.confirmLabel || '执行')
        confirm.style.cssText = dangerStyle
        confirm.disabled = true
        confirm.style.opacity = '.45'
        actions.append(cancel, confirm)
        panel.append(body, actions)
        root.append(panel)

        let settled = false
        const dismiss = (value) => {
          if (settled) return
          settled = true
          document.removeEventListener('keydown', onKey, true)
          root.remove()
          if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
          resolve(value)
        }
        const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); dismiss(null) } }
        const syncConfirm = () => {
          const ok = phraseInput.value.trim() === expectedPhrase
          confirm.disabled = !ok
          confirm.style.opacity = ok ? '1' : '.45'
        }
        phraseInput.addEventListener('input', syncConfirm)
        cancel.addEventListener('click', () => dismiss(null))
        root.addEventListener('mousedown', (event) => { if (event.target === root) dismiss(null) })
        confirm.addEventListener('click', () => {
          if (phraseInput.value.trim() !== expectedPhrase) return
          dismiss({
            phrase: phraseInput.value.trim(),
            assignments: assignmentInputs
              .map(({ name, value }) => ({ expression: name.value.trim(), value: value.value }))
              .filter((item) => item.expression),
            resetOption: resetSelect ? resetSelect.value : '',
            forceKill: Boolean(forceKillBox?.checked),
          })
        })
        document.addEventListener('keydown', onKey, true)
        document.body.append(root)
        phraseInput.focus()
      })
    }
    // 会话记录面板（T092，T095 重做外观）。DSH 只有「归档会话」——归档后侧栏不再显示，
    // 但记录文件与磁盘占用都保留，DSH 也没有任何删除 API，所以这里在文件层做真删除。
    // 顺序是**先删文件、后归档**：只有确实删掉文件的会话才会被摘行，这样"行消失"就等于
    // "磁盘已回收"。
