// Run: node tests/page-inject.test.js
// Loads page-inject.js against a fake WebSocket and checks the RFB KeyEvents it sends.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class WebSocket { constructor() { this.readyState = 1; this.binaryType = 'arraybuffer'; this.sent = []; } send(d) { this.sent.push(d); } }
WebSocket.OPEN = 1;
const listeners = [];
const posted = [];
const win = {
  addEventListener: (t, fn) => t === 'message' && listeners.push(fn),
  postMessage: (msg) => { posted.push(msg); listeners.forEach((fn) => fn({ source: win, data: msg })); },
};
vm.runInNewContext(fs.readFileSync(__dirname + '/../page-inject.js', 'utf8'),
  { window: win, WebSocket, ArrayBuffer, DataView, setTimeout, String, Promise });

const ws = new WebSocket();
ws.send(new Uint8Array([3])); // noVNC traffic -> socket captured
ws.sent = [];

win.postMessage({ type: 'KVM_PASTE_SEND', text: 'aB\n', delay: 1, newlineDelay: 1 });
setTimeout(() => {
  const keys = ws.sent.map((b) => { const v = new DataView(b); assert.equal(v.getUint8(0), 4); return [v.getUint8(1), v.getUint32(4).toString(16)]; });
  const typed = keys.slice(10); // first 10 = modifier releases
  assert.ok(keys.slice(0, 10).every(([down]) => down === 0), 'modifiers released first');
  assert.deepStrictEqual(typed, [
    [1, '61'], [0, '61'],
    [1, 'ffe1'], [1, '42'], [0, '42'], [0, 'ffe1'],
    [1, 'ff0d'], [0, 'ff0d'],
  ]);
  assert.ok(posted.some((m) => m.type === 'KVM_PASTE_ACK'));
  assert.ok(posted.some((m) => m.type === 'KVM_PASTE_DONE'));
  console.log('page-inject OK');
}, 100);
