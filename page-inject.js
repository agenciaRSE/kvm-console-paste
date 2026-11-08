/**
 * KVM Console Paste - Page world script (registered with world: 'MAIN').
 *
 * Modern noVNC is an ES module: neither the RFB object nor its WebSocket is
 * reachable from window. Instead we wrap WebSocket.prototype.send and remember
 * the binary socket noVNC writes to, then send RFB KeyEvent messages on it.
 * That is layout-independent: we send X11 keysyms, like noVNC itself does.
 *
 * Protocol with content.js (same frame, window.postMessage):
 *   in:  KVM_PASTE_SEND {text, delay, newlineDelay}, KVM_PASTE_CANCEL
 *   out: KVM_PASTE_ACK | KVM_PASTE_NACK, KVM_PASTE_PROGRESS, KVM_PASTE_DONE,
 *        KVM_PASTE_FALLBACK {remainingText, startIndex, totalLength}
 */

(() => {
  if (window.__kvmPasteMain) return;
  window.__kvmPasteMain = true;

  let vncSocket = null;
  let cancelled = false;

  const nativeSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    // noVNC uses binaryType 'arraybuffer' and only sends binary frames.
    if (this.binaryType === 'arraybuffer' && typeof data !== 'string') vncSocket = this;
    return nativeSend.apply(this, arguments);
  };

  const SHIFT_L = 0xFFE1;
  // Shift, Control, Meta, Alt, Super (L/R): released before typing so a held
  // Ctrl from the Ctrl+V shortcut never turns the pasted text into shortcuts.
  const MODIFIERS = [0xFFE1, 0xFFE2, 0xFFE3, 0xFFE4, 0xFFE7, 0xFFE8, 0xFFE9, 0xFFEA, 0xFFEB, 0xFFEC];
  const SPECIAL = { '\n': 0xFF0D, '\t': 0xFF09 };
  const SHIFTED = '~!@#$%^&*()_+{}|:"<>?';

  function keysym(char) {
    if (SPECIAL[char]) return SPECIAL[char];
    const cp = char.codePointAt(0);
    return cp <= 0xFF ? cp : 0x01000000 + cp;
  }

  // Shift as a US keyboard would press it: servers mapping keysyms to
  // scancodes (QEMU) then produce the right character.
  const needsShift = (char) => (char >= 'A' && char <= 'Z') || SHIFTED.includes(char);

  function socketOpen() {
    return vncSocket && vncSocket.readyState === WebSocket.OPEN;
  }

  // RFB KeyEvent: [4][down-flag][2 padding][keysym u32 BE]
  function key(sym, down) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint8(0, 4);
    view.setUint8(1, down ? 1 : 0);
    view.setUint32(4, sym);
    nativeSend.call(vncSocket, buf);
  }

  function sendChar(char) {
    if (!socketOpen()) return false;
    try {
      const shift = needsShift(char);
      if (shift) key(SHIFT_L, true);
      key(keysym(char), true);
      key(keysym(char), false);
      if (shift) key(SHIFT_L, false);
      return true;
    } catch (e) {
      return false;
    }
  }

  const post = (msg) => window.postMessage(msg, '*');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sendText(text, delay, newlineDelay) {
    cancelled = false;
    for (const sym of MODIFIERS) key(sym, false);

    for (let i = 0; i < text.length; i++) {
      if (cancelled) return;
      const char = text[i];
      if (!sendChar(char)) {
        post({ type: 'KVM_PASTE_FALLBACK', remainingText: text.slice(i), startIndex: i, totalLength: text.length });
        return;
      }
      post({ type: 'KVM_PASTE_PROGRESS', current: i + 1, total: text.length });
      await sleep(char === '\n' ? newlineDelay : delay);
    }
    post({ type: 'KVM_PASTE_DONE' });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const msg = event.data;
    if (msg.type === 'KVM_PASTE_SEND') {
      if (!socketOpen()) {
        post({ type: 'KVM_PASTE_NACK' });
        return;
      }
      post({ type: 'KVM_PASTE_ACK' });
      sendText(String(msg.text), msg.delay || 50, msg.newlineDelay || 500);
    } else if (msg.type === 'KVM_PASTE_CANCEL') {
      cancelled = true;
    }
  });
})();
