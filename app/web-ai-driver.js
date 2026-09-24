const MODEL_PROVIDER_IDS = Object.freeze({
  'deepseek-web': 'deepseek',
  'kimi-web': 'kimi',
  'doubao-web': 'doubao',
  'yuanbao-web': 'yuanbao',
  'qwen-web': 'qwen',
  'chatgpt-web': 'chatgpt',
  'claude-web': 'claude',
  'gemini-web': 'gemini',
});

function providerIdForModel(model) {
  return MODEL_PROVIDER_IDS[String(model || '')] || null;
}

function pageProbeScript(options = {}) {
  const allowOffscreen = options.allowOffscreen === true;
  return `(() => {
    const allowOffscreen = ${JSON.stringify(allowOffscreen)};
    const visible = (node) => { const style = getComputedStyle(node); if (style.visibility === 'hidden' || style.display === 'none') return false; if (allowOffscreen) return true; const rect = node.getBoundingClientRect(); return rect.width > 8 && rect.height > 8; };
    const nodes = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]')].filter((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
    const composer = nodes.sort((left, right) => (right.getBoundingClientRect().width * right.getBoundingClientRect().height) - (left.getBoundingClientRect().width * left.getBoundingClientRect().height))[0] || null;
    return { ready: Boolean(composer), title: document.title, url: location.href };
  })()`;
}

function assistantSnapshotScript(options = {}) {
  const allowOffscreen = options.allowOffscreen === true;
  return `(() => {
    const allowOffscreen = ${JSON.stringify(allowOffscreen)};
    const visible = (node) => { const style = getComputedStyle(node); if (style.visibility === 'hidden' || style.display === 'none') return false; if (allowOffscreen) return true; const rect = node.getBoundingClientRect(); return rect.width > 8 && rect.height > 8; };
    const selectors = [
      '[data-message-author-role="assistant"]', '[data-role="assistant"]', '[data-author="assistant"]',
      '[data-testid*="assistant"]', '[class*="assistant-message"]', '[class*="message-assistant"]',
      '.segment-assistant', '.ds-markdown'
    ];
    const unique = [];
    for (const node of document.querySelectorAll(selectors.join(','))) {
      if (!visible(node) || unique.some((item) => item === node || item.contains(node))) continue;
      const text = String(node.innerText || node.textContent || '').trim();
      if (text) unique.push(node);
    }
    const texts = unique.map((node) => String(node.innerText || node.textContent || '').trim()).filter(Boolean).slice(-20);
    const busy = [...document.querySelectorAll('button, [role="button"]')].some((node) => {
      if (!visible(node)) return false;
      const label = [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid')].filter(Boolean).join(' ');
      return /(停止|stop generating|stop response|停止生成|中止生成)/i.test(label);
    });
    return { texts, busy };
  })()`;
}

function submitPromptScript(prompt, options = {}) {
  const allowOffscreen = options.allowOffscreen === true;
  return `(async () => {
    const prompt = ${JSON.stringify(String(prompt))};
    const allowOffscreen = ${JSON.stringify(allowOffscreen)};
    const visible = (node) => { const style = getComputedStyle(node); if (style.visibility === 'hidden' || style.display === 'none') return false; if (allowOffscreen) return true; const rect = node.getBoundingClientRect(); return rect.width > 8 && rect.height > 8; };
    const snapshot = ${assistantSnapshotScript({ allowOffscreen })};
    const nodes = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]')].filter((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
    const composer = nodes.sort((left, right) => (right.getBoundingClientRect().width * right.getBoundingClientRect().height) - (left.getBoundingClientRect().width * left.getBoundingClientRect().height))[0] || null;
    if (!composer) return { sent: false, code: 'AUTH_REQUIRED' };
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(composer, prompt);
    else if (composer instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(composer, prompt);
    else { composer.textContent = ''; document.getSelection()?.selectAllChildren(composer); document.execCommand?.('insertText', false, prompt); if (!String(composer.innerText || composer.textContent || '').trim()) composer.textContent = prompt; }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
    const send = buttons.find((node) => {
      const label = [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid')].filter(Boolean).join(' ');
      return /(^|\\s)(发送|send|submit|提交)(\\s|$)|send-button|composer-submit/i.test(label) && !/(stop|停止)/i.test(label);
    });
    let method = 'keyboard';
    if (send) { method = 'button'; send.click(); }
    else if (composer.closest('form')?.requestSubmit) composer.closest('form').requestSubmit();
    else {
      for (const type of ['keydown', 'keypress', 'keyup']) composer.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { sent: true, baseline: snapshot.texts, method, valueSet: String(composer.value ?? composer.innerText ?? composer.textContent ?? '').includes(prompt), pageAcknowledged: window.__receivedPrompt === prompt };
  })()`;
}

function stopGenerationScript() {
  return `(() => {
    const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8; };
    const stop = [...document.querySelectorAll('button, [role="button"]')].find((node) => {
      if (!visible(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
      const label = [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid')].filter(Boolean).join(' ');
      return /(停止|stop generating|stop response|停止生成|中止生成)/i.test(label);
    });
    if (!stop) return { stopped: false };
    stop.click();
    return { stopped: true };
  })()`;
}

async function probePage(contents, options = {}) {
  return contents.executeJavaScript(pageProbeScript(options), true);
}

async function submitPrompt(contents, prompt, options = {}) {
  return contents.executeJavaScript(submitPromptScript(prompt, options), true);
}

async function readAssistantState(contents, options = {}) {
  return contents.executeJavaScript(assistantSnapshotScript(options), true);
}

async function stopGeneration(contents) {
  if (!contents || contents.isDestroyed()) return { stopped: false };
  return contents.executeJavaScript(stopGenerationScript(), true);
}

module.exports = { MODEL_PROVIDER_IDS, providerIdForModel, probePage, readAssistantState, stopGeneration, submitPrompt };
