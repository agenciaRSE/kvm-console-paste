/**
 * KVM Console Paste - Content Script
 * Detects noVNC consoles and enables clipboard paste via keystroke simulation.
 * Runs in all frames to handle iframed consoles.
 *
 * Strategies (in order of preference):
 *   A) page-inject.js → rfb.sendKey() (noVNC API)
 *   B) page-inject.js → raw WebSocket RFB key events
 *   C) DOM KeyboardEvent dispatch (last resort, layout-dependent)
 */

(() => {
  // executeScript (on "Enable") plus the registered script can both run here.
  if (window.__kvmPasteIsolated) return;
  window.__kvmPasteIsolated = true;

  // State
  let consoleDetected = false;
  let targetElement = null;
  let sending = false;
  let cancelled = false;
  let overlayEl = null;
  let confirmOpen = false;
  let settings = {
    typingDelay: 50,
    newlineDelay: 500,
    autoPasteOnCtrlV: true,
    showProgressOverlay: true,
    confirmMultiline: true,
  };

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  // Load settings
  if (chrome.storage) {
    chrome.storage.local.get(Object.keys(settings), (result) => {
      for (const key of Object.keys(settings)) {
        if (result[key] != null) settings[key] = result[key];
      }
    });
  }

  // ─── Console Detection ──────────────────────────────────────────────

  const CANVAS_SELECTORS = [
    '#noVNC_canvas',
    'canvas.noVNC_canvas',
    '#noVNC_screen canvas',
    '#pveVNCScreen canvas',
    '#screen canvas',
    '.remote-console canvas',
    'canvas[tabindex]',
  ];

  function detectConsole() {
    let canvas = null;
    for (const selector of CANVAS_SELECTORS) {
      canvas = document.querySelector(selector);
      if (canvas) break;
    }

    // Heuristic: large canvas that could be a VNC display
    if (!canvas) {
      const canvases = document.querySelectorAll('canvas');
      for (const c of canvases) {
        if (c.width >= 640 && c.height >= 400) {
          canvas = c;
          break;
        }
      }
    }

    if (!canvas) {
      if (consoleDetected) {
        consoleDetected = false;
        targetElement = null;
        notifyBackground(false);
      }
      return;
    }

    // noVNC's Keyboard listens on the canvas, not on #noVNC_keyboardinput
    // (that textarea is only for on-screen keyboards).
    targetElement = canvas;
    consoleDetected = true;
    notifyBackground(true);
  }

  function notifyBackground(detected) {
    try {
      chrome.runtime.sendMessage({ action: 'updateBadge', detected });
    } catch (e) { /* Extension context may be invalidated */ }
  }

  // ─── Messages from page-inject.js (page world, registered by lib/sites.js)

  // ACK/NACK protocol: when we send KVM_PASTE_SEND, page-inject replies
  // with ACK (it handles sending) or NACK (we must use Strategy C).
  let pendingSendText = null; // text waiting for ACK/NACK
  let pendingSendDelay = 50;
  let ackTimeout = null;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'KVM_PASTE_ACK':
        // page-inject.js is handling the send — cancel our timeout
        if (ackTimeout) { clearTimeout(ackTimeout); ackTimeout = null; }
        pendingSendText = null;
        break;

      case 'KVM_PASTE_NACK':
        // page-inject.js can't handle it — use Strategy C
        if (ackTimeout) { clearTimeout(ackTimeout); ackTimeout = null; }
        if (pendingSendText && sending) {
          const text = pendingSendText;
          pendingSendText = null;
          sendTextStrategyC(text, pendingSendDelay, 0, text.length);
        }
        break;

      case 'KVM_PASTE_PROGRESS':
        updateOverlay(msg.current, msg.total);
        break;

      case 'KVM_PASTE_DONE':
        sending = false;
        showOverlayDone();
        break;

      case 'KVM_PASTE_FALLBACK':
        // page-inject lost connection mid-send — continue with Strategy C
        if (msg.remainingText && sending) {
          sendTextStrategyC(msg.remainingText, pendingSendDelay, msg.startIndex || 0, msg.totalLength || msg.remainingText.length);
        }
        break;

      // KVM_CONTEXT_PASTE removed — context menu now uses chrome.runtime messaging
    }
  });

  // ─── Strategy C: DOM Keyboard Events (fallback) ─────────────────────
  //
  // This is the least reliable method. The VNC client interprets keyCode
  // and modifiers based on its configured keyboard layout, which may
  // differ from what we intend. We send Shift as a separate keydown
  // event to update the client's modifier state, then send the
  // character key.

  function dispatchKey(type, props) {
    if (!targetElement) return;
    targetElement.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...props,
    }));
  }

  function sendCharStrategyC(char) {
    const key = KeysymMap.charToKey(char);
    const code = KeysymMap.charToCode(char);
    const keyCode = KeysymMap.charToKeyCode(char);
    const needsShift = KeysymMap.charNeedsShift(char);

    // Send Shift keydown/keyup as separate events so the VNC client
    // updates its internal modifier state
    if (needsShift) {
      dispatchKey('keydown', {
        key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16,
        shiftKey: true,
      });
    }

    dispatchKey('keydown', {
      key, code, keyCode, which: keyCode,
      shiftKey: needsShift,
    });
    dispatchKey('keyup', {
      key, code, keyCode, which: keyCode,
      shiftKey: needsShift,
    });

    if (needsShift) {
      dispatchKey('keyup', {
        key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16,
        shiftKey: false,
      });
    }
  }

  async function sendTextStrategyC(text, delay, startIndex, totalLength) {
    const nlDelay = settings.newlineDelay || 500;

    for (let i = 0; i < text.length; i++) {
      if (cancelled) break;
      const char = text[i];
      sendCharStrategyC(char);
      updateOverlay(startIndex + i + 1, totalLength);
      const isNewline = (char === '\n' || char === '\r');
      await sleep(isNewline ? nlDelay : delay);
    }
    sending = false;
    showOverlayDone();
  }

  // ─── Text Sending (orchestrator) ───────────────────────────────────

  async function sendText(text, delay) {
    if (sending) return;
    sending = true;
    cancelled = false;

    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    delay = delay || settings.typingDelay;
    progress = { current: 0, total: text.length };

    if (settings.showProgressOverlay) {
      showOverlay(text.length);
    }

    // Always ask page-inject.js first. It replies with ACK or NACK.
    // If ACK: page-inject handles everything (Strategy A/B).
    // If NACK or no response within 300ms: we use Strategy C (DOM events).
    pendingSendText = text;
    pendingSendDelay = delay;

    window.postMessage({
      type: 'KVM_PASTE_SEND',
      text: text,
      delay: delay,
      newlineDelay: settings.newlineDelay || 500,
    }, '*');

    // Timeout: if page-inject doesn't ACK within 300ms, use Strategy C
    ackTimeout = setTimeout(() => {
      ackTimeout = null;
      if (pendingSendText && sending) {
        const t = pendingSendText;
        pendingSendText = null;
        sendTextStrategyC(t, delay, 0, t.length);
      }
    }, 300);
  }

  function cancelSend() {
    cancelled = true;
    sending = false;
    window.postMessage({ type: 'KVM_PASTE_CANCEL' }, '*');
    hideOverlay();
  }

  // ─── Progress Overlay ──────────────────────────────────────────────

  // Built with the DOM API (no innerHTML — Chrome Store compliance)
  function ensureStyle() {
    if (document.getElementById('kvm-paste-style')) return;
    const style = document.createElement('style');
    style.id = 'kvm-paste-style';
    style.textContent = [
      '#kvm-paste-overlay,#kvm-paste-confirm{position:fixed;bottom:20px;right:20px;background:#1a1a2e;color:#e0e0e0;padding:12px 16px;border-radius:8px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.4);border:1px solid #444;text-align:left}',
      '#kvm-paste-overlay{min-width:220px;transition:opacity 0.3s}',
      '#kvm-paste-overlay .kvm-title{font-weight:600;margin-bottom:8px;color:#64ffda;font-size:12px;text-transform:uppercase;letter-spacing:0.5px}',
      '#kvm-paste-overlay .kvm-progress-bar{background:#333;border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px}',
      '#kvm-paste-overlay .kvm-progress-fill{background:linear-gradient(90deg,#64ffda,#00bcd4);height:100%;width:0%;transition:width 0.1s ease;border-radius:4px}',
      '#kvm-paste-overlay .kvm-status{font-size:12px;color:#c9c9c9;display:flex;justify-content:space-between;align-items:center;gap:12px}',
      '#kvm-paste-overlay .kvm-cancel,#kvm-paste-confirm .kvm-cancel{background:none;border:1px solid #777;color:#ff7070;padding:4px 12px;min-height:28px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600}',
      '#kvm-paste-overlay .kvm-cancel:hover,#kvm-paste-confirm .kvm-cancel:hover{background:#ff5252;color:#fff}',
      '#kvm-paste-overlay button:focus-visible,#kvm-paste-confirm button:focus-visible{outline:2px solid #64ffda;outline-offset:2px}',
      '#kvm-paste-overlay.kvm-done .kvm-title{color:#4CAF50}',
      '#kvm-paste-overlay.kvm-error .kvm-title{color:#ff7070}',
      '#kvm-paste-confirm{width:min(360px,calc(100vw - 40px))}',
      '#kvm-paste-confirm h2{margin:0 0 8px;font-size:14px;font-weight:700;color:#64ffda}',
      '#kvm-paste-confirm p{margin:0 0 8px}',
      '#kvm-paste-confirm .kvm-warn{color:#ffcc66}',
      '#kvm-paste-confirm pre{margin:0 0 12px;padding:8px;background:#0d1117;color:#e6edf3;border-radius:4px;max-height:120px;overflow:auto;font:12px/1.4 Consolas,"Cascadia Code",monospace;white-space:pre-wrap;word-break:break-all}',
      '#kvm-paste-confirm .kvm-actions{display:flex;gap:8px;justify-content:flex-end}',
      '#kvm-paste-confirm .kvm-primary{background:#64ffda;color:#0d1117;border:none;padding:4px 16px;min-height:28px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700}',
      '@media (prefers-reduced-motion:reduce){#kvm-paste-overlay,#kvm-paste-overlay .kvm-progress-fill{transition:none}}',
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function createOverlay() {
    if (overlayEl) return overlayEl;
    ensureStyle();

    overlayEl = document.createElement('div');
    overlayEl.id = 'kvm-paste-overlay';

    const title = document.createElement('div');
    title.className = 'kvm-title';
    title.textContent = 'KVM Paste';

    const progressBar = document.createElement('div');
    progressBar.className = 'kvm-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'kvm-progress-fill';
    progressBar.appendChild(progressFill);

    const statusRow = document.createElement('div');
    statusRow.className = 'kvm-status';
    const statusText = document.createElement('span');
    statusText.className = 'kvm-status-text';
    statusText.setAttribute('role', 'status');
    statusText.textContent = t('overlayPreparing');
    const cancelButton = document.createElement('button');
    cancelButton.className = 'kvm-cancel';
    cancelButton.type = 'button';
    cancelButton.textContent = t('cancel');
    cancelButton.addEventListener('click', () => cancelSend());
    statusRow.appendChild(statusText);
    statusRow.appendChild(cancelButton);

    overlayEl.appendChild(title);
    overlayEl.appendChild(progressBar);
    overlayEl.appendChild(statusRow);

    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function showOverlay(total) {
    const el = createOverlay();
    el.className = '';
    el.style.display = 'block';
    el.style.opacity = '1';
    el.querySelector('.kvm-title').textContent = 'KVM Paste';
    el.querySelector('.kvm-progress-bar').style.display = 'block';
    el.querySelector('.kvm-progress-fill').style.width = '0%';
    el.querySelector('.kvm-status-text').textContent = t('overlaySending', ['0', String(total), '0']);
    el.querySelector('.kvm-cancel').style.display = 'inline-block';
  }

  function showOverlayError(message) {
    const el = createOverlay();
    el.className = 'kvm-error';
    el.style.display = 'block';
    el.style.opacity = '1';
    el.querySelector('.kvm-progress-bar').style.display = 'none';
    el.querySelector('.kvm-status-text').textContent = message;
    el.querySelector('.kvm-cancel').style.display = 'none';
    setTimeout(() => hideOverlay(), 5000);
  }

  let progress = { current: 0, total: 0 };

  function updateOverlay(current, total) {
    progress = { current, total };
    if (!overlayEl) return;
    const pct = Math.round((current / total) * 100);
    overlayEl.querySelector('.kvm-progress-fill').style.width = pct + '%';
    overlayEl.querySelector('.kvm-status-text').textContent = t('overlaySending', [String(current), String(total), String(pct)]);
  }

  function showOverlayDone() {
    if (!overlayEl) return;
    overlayEl.classList.add('kvm-done');
    overlayEl.querySelector('.kvm-title').textContent = t('overlayDone');
    overlayEl.querySelector('.kvm-progress-fill').style.width = '100%';
    overlayEl.querySelector('.kvm-status-text').textContent = t('overlayDoneText');
    overlayEl.querySelector('.kvm-cancel').style.display = 'none';
    setTimeout(() => hideOverlay(), 2000);
  }

  function hideOverlay() {
    if (!overlayEl) return;
    overlayEl.style.opacity = '0';
    setTimeout(() => {
      if (overlayEl) overlayEl.style.display = 'none';
    }, 300);
  }

  // ─── Paste Confirmation ────────────────────────────────────────────
  //
  // A pasted line break presses Enter on a real server, and characters
  // outside ASCII depend on the server's keyboard layout. Ask first.

  function needsConfirm(info) {
    return (settings.confirmMultiline && info.lineBreaks > 0) || info.nonAscii.length > 0;
  }

  function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (text != null) node.textContent = text;
    return node;
  }

  // Resolves true to paste, false to cancel. Focus returns to the console.
  function confirmPaste(text, info) {
    confirmOpen = true;
    ensureStyle();
    const previous = document.activeElement;

    const dialog = el('div', { id: 'kvm-paste-confirm' });
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'kvm-confirm-title');
    dialog.setAttribute('aria-describedby', 'kvm-confirm-desc');

    const desc = el('div', { id: 'kvm-confirm-desc' });
    if (info.lineBreaks > 0) {
      desc.appendChild(el('p', {}, info.lineBreaks === 1
        ? t('lineBreakOne')
        : t('lineBreakMany', [String(info.lineBreaks)])));
    }
    if (info.nonAscii.length) {
      desc.appendChild(el('p', { className: 'kvm-warn' }, t('nonAscii', [info.nonAscii.join(' ')])));
    }
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const preview = lines.slice(0, 6).map((l) => (l.length > 120 ? l.slice(0, 120) + '…' : l));
    if (lines.length > 6) preview.push('…');
    desc.appendChild(el('pre', {}, preview.join('\n')));

    const pasteBtn = el('button', { type: 'button', className: 'kvm-primary' }, t('confirmPaste'));
    const cancelBtn = el('button', { type: 'button', className: 'kvm-cancel' }, t('cancel'));
    const actions = el('div', { className: 'kvm-actions' });
    actions.append(pasteBtn, cancelBtn);

    dialog.append(el('h2', { id: 'kvm-confirm-title' }, t('confirmTitle')), desc, actions);
    document.body.appendChild(dialog);
    pasteBtn.focus();

    return new Promise((resolve) => {
      const finish = (ok) => {
        dialog.remove();
        confirmOpen = false;
        previous?.focus?.();
        resolve(ok);
      };
      pasteBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') finish(false);
        // Keep the two buttons in a loop so Tab never lands in the console.
        if (e.key === 'Tab') {
          e.preventDefault();
          (document.activeElement === pasteBtn ? cancelBtn : pasteBtn).focus();
        }
        e.stopPropagation();
      });
    });
  }

  // Common entry for Ctrl+V and the context menu.
  async function pasteWithConfirm(text) {
    const info = KeysymMap.analyze(text);
    if (needsConfirm(info) && !(await confirmPaste(text, info))) return;
    // Let noVNC forward the Enter/click keyup before typing starts.
    setTimeout(() => sendText(text, settings.typingDelay), 100);
  }

  // ─── Paste Interception ─────────────────────────────────────────────
  //
  // navigator.clipboard.readText() is blocked by IONOS's permissions policy
  // inside the console iframe, so we read event.clipboardData from the
  // native 'paste' event. noVNC calls preventDefault() on every keydown it
  // handles, which kills that paste event and sends a literal Ctrl+V to the
  // server. So on Ctrl/Cmd+V we stop the keydown before noVNC sees it
  // (capture phase on window), but do NOT preventDefault, so the browser
  // still fires 'paste'.

  let modifierHeld = false;
  let pendingPaste = null;

  const isPasteShortcut = (e) =>
    (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyV' || e.key === 'v' || e.key === 'V');

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Control' || event.key === 'Meta') modifierHeld = true;
    if (consoleDetected && settings.autoPasteOnCtrlV && isPasteShortcut(event)) {
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Control' && event.key !== 'Meta') return;
    modifierHeld = false;
    if (pendingPaste != null) startPendingPaste();
  }, true);

  // Start typing only once Ctrl/Cmd is released and noVNC has forwarded that
  // keyup; otherwise the server would see Ctrl+<every pasted char>.
  function startPendingPaste() {
    const text = pendingPaste;
    pendingPaste = null;
    pasteWithConfirm(text);
  }

  document.addEventListener('paste', (event) => {
    if (!consoleDetected || !settings.autoPasteOnCtrlV || sending || confirmOpen) return;

    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pendingPaste = text;
    if (!modifierHeld) startPendingPaste();
    // Missed keyup (focus left the frame): don't wait forever.
    else setTimeout(() => { if (pendingPaste === text) startPendingPaste(); }, 2000);
  }, true);

  // Context menu has no paste event: try the async API, then the legacy
  // execCommand('paste') (allowed by the clipboardRead permission).
  async function readClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) return text;
    } catch (e) { /* blocked by permissions policy */ }
    const previous = document.activeElement;
    const area = document.createElement('textarea');
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(area);
    area.focus();
    document.execCommand('paste');
    const text = area.value;
    area.remove();
    previous?.focus?.();
    return text;
  }

  // ─── Chrome Extension Messaging ────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'sendText':
        if (!consoleDetected) {
          sendResponse({ ok: false, error: 'No console in this frame' });
          break;
        }
        if (message.newlineDelay) settings.newlineDelay = message.newlineDelay;
        sendText(message.text, message.delay || settings.typingDelay);
        sendResponse({ ok: true });
        break;

      case 'getStatus':
        sendResponse({
          consoleDetected,
          strategy: consoleDetected ? 'ACK/NACK (auto)' : 'none',
          sending,
          progress,
          targetTag: targetElement?.tagName || null,
        });
        break;

      case 'cancelSend':
        cancelSend();
        sendResponse({ ok: true });
        break;

      case 'contextMenuPaste':
        // Read clipboard (async API, else execCommand fallback)
        if (consoleDetected && !sending && !confirmOpen) {
          readClipboard().then((text) => {
            if (text) pasteWithConfirm(text);
            else showOverlayError(t('overlayClipboardError'));
            sendResponse({ ok: !!text, error: text ? undefined : 'Clipboard empty or access denied' });
          });
          return true; // async sendResponse
        }
        sendResponse({ ok: false, error: 'Console not detected or busy' });
        break;

      case 'updateSettings':
        Object.assign(settings, message.settings);
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: 'Unknown action' });
    }
    return true;
  });

  // ─── Initialization ────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Initial detection
  detectConsole();

  // Re-detect on DOM changes
  const observer = new MutationObserver(() => {
    if (!consoleDetected) detectConsole();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Periodic retry
  let retries = 0;
  const retryInterval = setInterval(() => {
    if (consoleDetected || retries >= 20) {
      clearInterval(retryInterval);
      return;
    }
    detectConsole();
    retries++;
  }, 2000);
})();
