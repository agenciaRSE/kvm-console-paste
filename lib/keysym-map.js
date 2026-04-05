/**
 * X11 Keysym mapping for noVNC keyboard input.
 * Maps characters to their X11 keysym values and DOM key/code properties.
 */

const KeysymMap = (() => {
  // X11 keysym constants for special keys
  const SPECIAL_KEYSYMS = {
    Backspace: 0xFF08,
    Tab: 0xFF09,
    Return: 0xFF0D,
    Escape: 0xFF1B,
    Delete: 0xFFFF,
    Home: 0xFF50,
    End: 0xFF57,
    PageUp: 0xFF55,
    PageDown: 0xFF56,
    ArrowLeft: 0xFF51,
    ArrowUp: 0xFF52,
    ArrowRight: 0xFF53,
    ArrowDown: 0xFF54,
    Insert: 0xFF63,
    F1: 0xFFBE, F2: 0xFFBF, F3: 0xFFC0, F4: 0xFFC1,
    F5: 0xFFC2, F6: 0xFFC3, F7: 0xFFC4, F8: 0xFFC5,
    F9: 0xFFC6, F10: 0xFFC7, F11: 0xFFC8, F12: 0xFFC9,
  };

  const SHIFT_KEYSYM = 0xFFE1;
  const CTRL_KEYSYM = 0xFFE3;
  const ALT_KEYSYM = 0xFFE9;

  // Characters that require Shift on a US keyboard layout
  const SHIFTED_CHARS = '~!@#$%^&*()_+{}|:"<>?';
  const UNSHIFTED_PAIRS = '`1234567890-=[]\\;\',./';

  // Map shifted symbol → unshifted base key
  const SHIFT_PAIR_MAP = {};
  for (let i = 0; i < SHIFTED_CHARS.length; i++) {
    SHIFT_PAIR_MAP[SHIFTED_CHARS[i]] = UNSHIFTED_PAIRS[i];
  }

  // Map character → DOM "code" value (US keyboard layout)
  const CHAR_TO_CODE = {};
  const CHAR_TO_KEYCODE = {};

  // Letters
  for (let i = 65; i <= 90; i++) {
    const upper = String.fromCharCode(i);
    const lower = upper.toLowerCase();
    CHAR_TO_CODE[lower] = 'Key' + upper;
    CHAR_TO_CODE[upper] = 'Key' + upper;
    CHAR_TO_KEYCODE[lower] = i;
    CHAR_TO_KEYCODE[upper] = i;
  }

  // Digits
  for (let i = 0; i <= 9; i++) {
    CHAR_TO_CODE[String(i)] = 'Digit' + i;
    CHAR_TO_KEYCODE[String(i)] = 48 + i;
  }

  // Symbols → their base key code
  const SYMBOL_CODES = {
    '`': 'Backquote', '~': 'Backquote',
    '-': 'Minus', '_': 'Minus',
    '=': 'Equal', '+': 'Equal',
    '[': 'BracketLeft', '{': 'BracketLeft',
    ']': 'BracketRight', '}': 'BracketRight',
    '\\': 'Backslash', '|': 'Backslash',
    ';': 'Semicolon', ':': 'Semicolon',
    "'": 'Quote', '"': 'Quote',
    ',': 'Comma', '<': 'Comma',
    '.': 'Period', '>': 'Period',
    '/': 'Slash', '?': 'Slash',
    ' ': 'Space',
    '!': 'Digit1', '@': 'Digit2', '#': 'Digit3',
    '$': 'Digit4', '%': 'Digit5', '^': 'Digit6',
    '&': 'Digit7', '*': 'Digit8', '(': 'Digit9',
    ')': 'Digit0',
  };

  const SYMBOL_KEYCODES = {
    ' ': 32, '`': 192, '~': 192, '-': 189, '_': 189,
    '=': 187, '+': 187, '[': 219, '{': 219,
    ']': 221, '}': 221, '\\': 220, '|': 220,
    ';': 186, ':': 186, "'": 222, '"': 222,
    ',': 188, '<': 188, '.': 190, '>': 190,
    '/': 191, '?': 191,
    '!': 49, '@': 50, '#': 51, '$': 52, '%': 53,
    '^': 54, '&': 55, '*': 56, '(': 57, ')': 48,
  };

  Object.assign(CHAR_TO_CODE, SYMBOL_CODES);
  Object.assign(CHAR_TO_KEYCODE, SYMBOL_KEYCODES);

  // Special char mappings for text input
  const SPECIAL_CHARS = {
    '\n': { keysym: 0xFF0D, key: 'Enter', code: 'Enter', keyCode: 13 },
    '\r': { keysym: 0xFF0D, key: 'Enter', code: 'Enter', keyCode: 13 },
    '\t': { keysym: 0xFF09, key: 'Tab', code: 'Tab', keyCode: 9 },
  };

  /**
   * Convert a character to its X11 keysym value.
   */
  function charToKeysym(char) {
    // Special characters
    if (SPECIAL_CHARS[char]) return SPECIAL_CHARS[char].keysym;

    const codepoint = char.codePointAt(0);

    // ASCII printable and Latin-1: keysym = codepoint
    if (codepoint >= 0x20 && codepoint <= 0xFF) {
      return codepoint;
    }

    // Unicode above Latin-1
    if (codepoint > 0xFF) {
      return 0x01000000 + codepoint;
    }

    return codepoint;
  }

  /**
   * Check if a character requires Shift key.
   */
  function charNeedsShift(char) {
    if (char >= 'A' && char <= 'Z') return true;
    return SHIFTED_CHARS.includes(char);
  }

  /**
   * Get the DOM "code" property for a character.
   */
  function charToCode(char) {
    if (SPECIAL_CHARS[char]) return SPECIAL_CHARS[char].code;
    return CHAR_TO_CODE[char] || '';
  }

  /**
   * Get the DOM "key" property for a character.
   */
  function charToKey(char) {
    if (SPECIAL_CHARS[char]) return SPECIAL_CHARS[char].key;
    return char;
  }

  /**
   * Get the legacy keyCode for a character.
   */
  function charToKeyCode(char) {
    if (SPECIAL_CHARS[char]) return SPECIAL_CHARS[char].keyCode;
    return CHAR_TO_KEYCODE[char] || char.toUpperCase().charCodeAt(0);
  }

  /**
   * Get the base (unshifted) keysym for a character.
   * For shifted symbols, this returns the keysym of the base key.
   */
  function charToBaseKeysym(char) {
    if (SHIFT_PAIR_MAP[char]) {
      return SHIFT_PAIR_MAP[char].charCodeAt(0);
    }
    if (char >= 'A' && char <= 'Z') {
      return char.toLowerCase().charCodeAt(0);
    }
    return charToKeysym(char);
  }

  return {
    SPECIAL_KEYSYMS,
    SPECIAL_CHARS,
    SHIFT_KEYSYM,
    CTRL_KEYSYM,
    ALT_KEYSYM,
    charToKeysym,
    charNeedsShift,
    charToCode,
    charToKey,
    charToKeyCode,
    charToBaseKeysym,
  };
})();

// Make available in both content script and page context
if (typeof window !== 'undefined') {
  window.KeysymMap = KeysymMap;
}
