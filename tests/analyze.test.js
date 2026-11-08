// Run: node tests/analyze.test.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/../lib/keysym-map.js', 'utf8'), ctx);
const { analyze } = ctx.window.KeysymMap;
const plain = (o) => JSON.parse(JSON.stringify(o));

assert.deepStrictEqual(plain(analyze('ls\r\npwd\n')), { lineBreaks: 2, nonAscii: [] });
assert.deepStrictEqual(plain(analyze('contraseña€ñ')), { lineBreaks: 0, nonAscii: ['ñ', '€'] });
assert.deepStrictEqual(plain(analyze('a\tb 😀')), { lineBreaks: 0, nonAscii: ['😀'] });
assert.deepStrictEqual(plain(analyze('echo "ok" | grep -v ~')), { lineBreaks: 0, nonAscii: [] });
console.log('analyze OK');
