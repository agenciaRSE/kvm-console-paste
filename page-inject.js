/**
 * KVM Console Paste - Page Inject Script
 * Runs in the page's JavaScript context to access the noVNC RFB object
 * or the VNC WebSocket directly.
 *
 * Strategies (tried in order):
 *   A) rfb.sendKey() — official noVNC API
 *   B) Raw WebSocket — send RFB key event packets directly
 *   Falls back to content.js DOM events if neither works
 */

(() => {
  let rfb = null;
  let vncWebSocket = null;
  let sending = false;
  let cancelled = false;

  // ─── Keysym utilities ──────────────────────────────────────────────

  const SPECIAL_CHARS = {
    '\n': 0xFF0D,
    '\r': 0xFF0D,
    '\t': 0xFF09,
  };

  function charToKeysym(char) {
    if (SPECIAL_CHARS[char] !== undefined) return SPECIAL_CHARS[char];
    const cp = char.codePointAt(0);
    if (cp >= 0x20 && cp <= 0xFF) return cp;
    if (cp > 0xFF) return 0x01000000 + cp;
    return cp;
  }

  // ─── Strategy A: RFB Object Discovery ──────────────────────────────

  function findRFB() {
    const candidates = [
      () => window.rfb,
      () => window._rfb,
      () => window.noVNC_rfb,
      () => window.UI?.rfb,
      () => window.UI?._rfb,
      () => document.getElementById('noVNC_screen')?._rfb,
      () => document.getElementById('noVNC_screen')?.rfb,
      () => window.PVE?.noVNC?.rfb,
      () => window.pveConsole?.rfb,
      () => window.NOVNC?.rfb,
    ];

    for (const getter of candidates) {
      try {
        const obj = getter();
        if (obj && typeof obj.sendKey === 'function') return obj;
      } catch (e) { /* skip */ }
    }

    // Deep scan: objects with sendKey method (2 levels)
    try {
      for (const key of Object.getOwnPropertyNames(window)) {
        try {
          const obj = window[key];
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
          if (typeof obj.sendKey === 'function') return obj;
          for (const sub of Object.keys(obj)) {
            try {
              if (obj[sub] && typeof obj[sub].sendKey === 'function') return obj[sub];
            } catch (e) { /* skip */ }
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* skip */ }

    return null;
  }

  // ─── Strategy B: Find VNC WebSocket (no constructor patching) ──────

  function findVNCWebSocket() {
    // Method 1: From RFB object's internal socket
    if (rfb) {
      const sockPaths = ['_sock', 'sock', '_websock'];
      const wsPaths = ['_websocket', '_ws', 'ws', 'websocket'];
      for (const sp of sockPaths) {
        try {
          const sock = rfb[sp];
          if (!sock) continue;
          // Direct WebSocket
          if (sock instanceof WebSocket && sock.readyState === WebSocket.OPEN) return sock;
          // Wrapped WebSocket
          for (const wp of wsPaths) {
            try {
              const ws = sock[wp];
              if (ws instanceof WebSocket && ws.readyState === WebSocket.OPEN) return ws;
            } catch (e) { /* skip */ }
          }
        } catch (e) { /* skip */ }
      }
    }

    // Method 2: Scan global objects for WebSocket instances with VNC-like URLs
    try {
      for (const key of Object.getOwnPropertyNames(window)) {
        try {
          const obj = window[key];
          if (obj instanceof WebSocket && obj.readyState === WebSocket.OPEN &&
              obj.binaryType === 'arraybuffer' && isVNCUrl(obj.url)) {
            return obj;
          }
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
          // Check nested: obj._sock._websocket, obj.ws, etc.
          for (const sub of ['_sock', 'sock', '_websocket', 'ws', 'socket', '_ws']) {
            try {
              let candidate = obj[sub];
              if (candidate instanceof WebSocket && candidate.readyState === WebSocket.OPEN &&
                  candidate.binaryType === 'arraybuffer') return candidate;
              if (candidate && typeof candidate === 'object') {
                for (const ss of ['_websocket', '_ws', 'ws']) {
                  try {
                    const ws = candidate[ss];
                    if (ws instanceof WebSocket && ws.readyState === WebSocket.OPEN) return ws;
                  } catch (e) { /* skip */ }
                }
              }
            } catch (e) { /* skip */ }
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* skip */ }

    return null;
  }

  function isVNCUrl(url) {
    if (!url) return false;
    const lc = url.toLowerCase();
    return lc.includes('websockify') || lc.includes('vnc') || lc.includes('rfb') ||
           lc.includes('console') || lc.includes('5900') || lc.includes('6080') ||
           lc.includes('novnc') || lc.includes('socket');
  }

  /**
   * Send raw RFB Key Event (message type 4) over the WebSocket.
   * Format: [04] [down:1byte] [padding:2bytes] [keysym:4bytes BE]
   */
  function sendKeysymRaw(keysym, down) {
    if (!vncWebSocket || vncWebSocket.readyState !== WebSocket.OPEN) return false;
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint8(0, 4);
    view.setUint8(1, down ? 1 : 0);
    view.setUint16(2, 0);
    view.setUint32(4, keysym);
    try {
      vncWebSocket.send(buf);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ─── Character Sending ─────────────────────────────────────────────

  function sendChar(char) {
    const keysym = charToKeysym(char);

    // Strategy A: RFB object API
    if (rfb && typeof rfb.sendKey === 'function') {
      try {
        rfb.sendKey(keysym, null, true);
        rfb.sendKey(keysym, null, false);
        return true;
      } catch (e) { /* fall through */ }
    }

    // Strategy B: Raw WebSocket
    if (vncWebSocket) {
      if (sendKeysymRaw(keysym, true) && sendKeysymRaw(keysym, false)) return true;
    }

    return false;
  }

  async function sendTextDirect(text, delay, newlineDelay) {
    sending = true;
    cancelled = false;

    // After Enter, the console needs time to execute the command
    // and show the prompt before we send the next line.
    const nlDelay = newlineDelay || Math.max(delay * 10, 500);

    for (let i = 0; i < text.length; i++) {
      if (cancelled) break;

      const char = text[i];

      if (!sendChar(char)) {
        window.postMessage({
          type: 'KVM_PASTE_FALLBACK',
          remainingText: text.substring(i),
          startIndex: i,
          totalLength: text.length,
        }, '*');
        sending = false;
        return;
      }

      window.postMessage({
        type: 'KVM_PASTE_PROGRESS',
        current: i + 1,
        total: text.length,
      }, '*');

      // Use longer delay after newline to let the command execute
      const isNewline = (char === '\n' || char === '\r');
      await new Promise(r => setTimeout(r, isNewline ? nlDelay : delay));
    }

    sending = false;
    window.postMessage({ type: 'KVM_PASTE_DONE' }, '*');
  }

  // ─── Message Handling ──────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'KVM_PASTE_SEND':
        // Re-discover before each send
        if (!rfb) rfb = findRFB();
        if (!vncWebSocket) vncWebSocket = findVNCWebSocket();

        if (rfb || vncWebSocket) {
          // ACK: tell content.js we're handling it
          window.postMessage({ type: 'KVM_PASTE_ACK' }, '*');
          sendTextDirect(msg.text, msg.delay || 50, msg.newlineDelay || 0);
        } else {
          // NACK: tell content.js to use DOM events
          window.postMessage({ type: 'KVM_PASTE_NACK' }, '*');
        }
        break;

      case 'KVM_PASTE_CANCEL':
        cancelled = true;
        sending = false;
        break;
    }
  });

  // ─── Initial Discovery ─────────────────────────────────────────────

  function discover() {
    if (!rfb) rfb = findRFB();
    if (!vncWebSocket) vncWebSocket = findVNCWebSocket();
    return !!(rfb || vncWebSocket);
  }

  // Retry discovery periodically
  let attempts = 0;
  const interval = setInterval(() => {
    if (discover() || attempts >= 30) clearInterval(interval);
    attempts++;
  }, 2000);
  discover();
})();
