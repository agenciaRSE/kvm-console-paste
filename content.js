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
  // State
  let consoleDetected = false;
  let targetElement = null;
  // pageInjectReady is no longer used for strategy selection.
  // We use ACK/NACK protocol instead.
  let sending = false;
  let cancelled = false;
  let overlayEl = null;
  let settings = {
    typingDelay: 50,
    newlineDelay: 500,
    autoPasteOnCtrlV: true,
    showProgressOverlay: true,
  };

  // Load settings
  if (chrome.storage) {
    chrome.storage.local.get(['typingDelay', 'newlineDelay', 'autoPasteOnCtrlV', 'showProgressOverlay'], (result) => {
      if (result.typingDelay != null) settings.typingDelay = result.typingDelay;
      if (result.newlineDelay != null) settings.newlineDelay = result.newlineDelay;
      if (result.autoPasteOnCtrlV != null) settings.autoPasteOnCtrlV = result.autoPasteOnCtrlV;
      if (result.showProgressOverlay != null) settings.showProgressOverlay = result.showProgressOverlay;
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

  const INPUT_SELECTORS = [
    '#noVNC_keyboardinput',
    'textarea.noVNC_clipboard',
    '#noVNC_clipboard',
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

    // Find keyboard input target (noVNC uses a hidden textarea)
    let inputTarget = null;
    for (const selector of INPUT_SELECTORS) {
      inputTarget = document.querySelector(selector);
      if (inputTarget) break;
    }

    targetElement = inputTarget || canvas;
    consoleDetected = true;
    notifyBackground(true);
    injectPageScript();
  }

  function notifyBackground(detected) {
    try {
      chrome.runtime.sendMessage({ action: 'updateBadge', detected });
    } catch (e) { /* Extension context may be invalidated */ }
  }

  // ─── Page Script Injection ──────────────────────────────────────────

  let pageScriptInjected = false;

  function injectPageScript() {
    if (pageScriptInjected) return;
    pageScriptInjected = true;
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('page-inject.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) { /* May fail in restricted contexts */ }
  }

  // Listen for messages from page-inject.js
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

  function createOverlay() {
    if (overlayEl) return overlayEl;

    // Build overlay using DOM API (no innerHTML — Chrome Store compliance)
    const style = document.createElement('style');
    style.textContent = [
      '#kvm-paste-overlay{position:fixed;bottom:20px;right:20px;background:#1a1a2e;color:#e0e0e0;padding:12px 16px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:220px;border:1px solid #333;transition:opacity 0.3s}',
      '#kvm-paste-overlay .kvm-title{font-weight:600;margin-bottom:8px;color:#64ffda;font-size:12px;text-transform:uppercase;letter-spacing:0.5px}',
      '#kvm-paste-overlay .kvm-progress-bar{background:#333;border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px}',
      '#kvm-paste-overlay .kvm-progress-fill{background:linear-gradient(90deg,#64ffda,#00bcd4);height:100%;width:0%;transition:width 0.1s ease;border-radius:4px}',
      '#kvm-paste-overlay .kvm-status{font-size:12px;color:#aaa;display:flex;justify-content:space-between;align-items:center}',
      '#kvm-paste-overlay .kvm-cancel{background:none;border:1px solid #555;color:#ff5252;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:11px}',
      '#kvm-paste-overlay .kvm-cancel:hover{background:#ff5252;color:#fff}',
      '#kvm-paste-overlay.kvm-done .kvm-title{color:#4CAF50}',
      '#kvm-paste-overlay.kvm-error .kvm-title{color:#ff5252}',
    ].join('');

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
    statusText.textContent = 'Preparing...';
    const cancelButton = document.createElement('button');
    cancelButton.className = 'kvm-cancel';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => cancelSend());
    statusRow.appendChild(statusText);
    statusRow.appendChild(cancelButton);

    overlayEl.appendChild(style);
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
    el.querySelector('.kvm-progress-fill').style.width = '0%';
    el.querySelector('.kvm-status-text').textContent = `Sending 0/${total}...`;
    el.querySelector('.kvm-cancel').style.display = 'inline-block';
  }

  function updateOverlay(current, total) {
    if (!overlayEl) return;
    const pct = Math.round((current / total) * 100);
    overlayEl.querySelector('.kvm-progress-fill').style.width = pct + '%';
    overlayEl.querySelector('.kvm-status-text').textContent = `Sending ${current}/${total} (${pct}%)`;
  }

  function showOverlayDone() {
    if (!overlayEl) return;
    overlayEl.classList.add('kvm-done');
    overlayEl.querySelector('.kvm-title').textContent = 'Done';
    overlayEl.querySelector('.kvm-progress-fill').style.width = '100%';
    overlayEl.querySelector('.kvm-status-text').textContent = 'Text sent successfully';
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

  // ─── Paste Interception ─────────────────────────────────────────────
  //
  // The Clipboard API (navigator.clipboard.readText) is BLOCKED by
  // IONOS's permissions policy inside the iframe. So we must NOT
  // preventDefault on keydown — we let the browser fire the native
  // 'paste' event, then read the text from event.clipboardData.

  // Do NOT intercept keydown for Ctrl+V — let it propagate so the
  // browser generates a paste event that carries clipboardData.

  // Intercept the paste event (which HAS the clipboard data)
  document.addEventListener('paste', (event) => {
    if (!consoleDetected || !settings.autoPasteOnCtrlV) return;
    if (sending) return;

    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      sendText(text, settings.typingDelay);
    }
  }, true); // Capture phase — intercept before noVNC gets it

  // ─── Chrome Extension Messaging ────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'sendText':
        if (message.newlineDelay) settings.newlineDelay = message.newlineDelay;
        sendText(message.text, message.delay || settings.typingDelay);
        sendResponse({ ok: true });
        break;

      case 'getStatus':
        sendResponse({
          consoleDetected,
          strategy: consoleDetected ? 'ACK/NACK (auto)' : 'none',
          sending,
          targetTag: targetElement?.tagName || null,
        });
        break;

      case 'cancelSend':
        cancelSend();
        sendResponse({ ok: true });
        break;

      case 'contextMenuPaste':
        // Read clipboard via Clipboard API (works when tab is focused)
        if (consoleDetected && !sending) {
          navigator.clipboard.readText().then((text) => {
            if (text) sendText(text, settings.typingDelay);
            sendResponse({ ok: true });
          }).catch(() => {
            sendResponse({ ok: false, error: 'Clipboard access denied' });
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
