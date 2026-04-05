# KVM Console Paste — Support Page
# URL: https://agenciarse.com/kvm-console-paste-support
# For web developer: each H2 is a section, H3 is a subsection/FAQ item.
# All content below is final copy, ready for HTML conversion.

---

# PAGE TITLE

KVM Console Paste — Support

---

# INTRO (below page title, short paragraph)

If you landed here, you probably just tried to paste a password or a long command into a KVM console and nothing happened. That's exactly what this extension is for. Here you'll find everything you need to get it working.

---

## How to Install

Go to the [Chrome Web Store](#) and click "Add to Chrome". That's it. The extension icon will appear in your browser toolbar.

If you don't see the icon, click the puzzle-piece icon on the right side of Chrome's address bar and pin KVM Console Paste to your toolbar for easier access.

The extension works on any Chromium-based browser: Chrome, Edge, Brave, Vivaldi, Opera.

---

## How to Use

**The quick way**

Open your KVM console in the browser, click inside the console so it has focus, and press Ctrl+V. The extension intercepts it and starts typing your clipboard content into the console, character by character.

**The popup way**

1. Open your KVM console page.
2. Click the KVM Console Paste icon in your toolbar.
3. The popup will show "KVM console detected" if everything is working.
4. Paste your text into the text area inside the popup.
5. Click "Send to Console".

**The right-click way**

Select any text on a webpage, right-click it, and choose "Paste to KVM Console" from the context menu. The selected text will be sent directly to the console.

**Adjusting speed**

Inside the popup, you'll find two sliders:

- **Typing speed**: How long the extension waits between each character. Default is 50ms. If characters are being dropped or duplicated, increase this value.
- **Delay after Enter**: Extra wait time after pressing Enter. Useful when pasting multi-line commands — gives the server time to process each line before the next one arrives.

A progress bar will appear on screen while text is being sent. You can cancel at any time.

---

## FAQ

### Why doesn't the extension detect my console?

The extension detects KVM consoles by looking for the canvas element that noVNC renders into. If your console is loading slowly or is embedded inside a nested iframe, detection might take a moment. Try the following:

- Wait for the console to fully load, then click the extension icon again.
- Make sure the console page itself is active (not a background tab).
- Some providers load the console in a separate window or tab — make sure the extension icon you're clicking is on that specific tab, not on the management panel tab.

If the popup shows "No KVM console detected" on a page where you can see a working console, see the Troubleshooting section below.

---

### It says "No KVM console detected" but I can see the console right there

This usually means one of three things:

**The console is in a deeply nested iframe.** The extension is designed to detect consoles inside iframes, but some providers use multi-level iframe nesting or sandboxed iframes with restrictions that block script injection. Try opening the console in its own tab — many providers have a "pop out" or "open in new window" option for the KVM console.

**The page uses a non-standard noVNC setup.** A small number of providers customize noVNC enough that the canvas detection doesn't match. If you encounter this, let us know at the email address at the bottom of this page — we'll look into adding support.

**The extension hasn't fully loaded on the page.** Refresh the console page after installing the extension for the first time. Extensions don't always inject into tabs that were already open before installation.

---

### Characters are coming out wrong — wrong letters, symbols I didn't type

This is usually a keyboard layout mismatch. noVNC translates key codes on the server side, and if your browser's keyboard layout doesn't match the layout configured on the remote machine, some characters will come out differently.

A few things to try:

- Set your operating system's keyboard layout to US/English before pasting, then switch back afterward. This gives the extension the most predictable key codes to work with.
- Special characters (accented letters, currency symbols, characters from non-Latin scripts) are the most likely to be affected. If you're pasting something that only contains ASCII characters (passwords, most commands), this issue usually doesn't appear.
- If your remote machine is configured with a non-English keyboard layout, there's an inherent mismatch between what the extension sends and what the server expects. This is a noVNC limitation, not something specific to this extension.

---

### How do I paste multi-line commands or scripts?

Paste the entire text — line breaks included — into the popup's text area or copy it to your clipboard and press Ctrl+V on the console. The extension will send each line followed by an Enter keystroke.

If the server is processing each command before the next arrives (for example, running a script line by line or prompting for confirmation), increase the **Delay after Enter** slider in the popup. Setting it to 500ms–1000ms gives most servers enough breathing room between lines.

For very long scripts, use a moderate typing speed (80–100ms) combined with a healthy Enter delay. Rushing it on a slow connection tends to cause dropped characters.

---

### Does it work with [my hosting provider]?

If your provider uses noVNC for its web console, it should work. Known compatible providers include IONOS Cloud, Proxmox VE, and Plesk. Any other provider using the standard noVNC interface should work the same way.

If your provider uses a completely different console technology (not noVNC — for example, some enterprise solutions use proprietary Java applets or browser plugins), this extension won't help, since it's specifically designed for noVNC canvas-based consoles.

Not sure if your provider uses noVNC? If you see a web-based console that renders inside the browser without installing anything extra, and Ctrl+V doesn't work natively, there's a good chance it's noVNC.

---

### Is my clipboard data safe? Where does it go?

Nowhere. Everything happens locally in your browser. The extension reads your clipboard, converts the text into individual simulated keystrokes, and sends them to the console canvas on the page. Nothing is transmitted to any server, no data is logged, no analytics are involved.

The extension has no network requests. It can't phone home because it was never built to do so. You can verify this yourself — the source code is straightforward and the permissions in the Chrome Web Store listing explain exactly why each one is needed.

Full privacy policy: [agenciarse.com/privacy-policy-kvm-console-paste](#) *(link to the privacy policy page)*

---

### Ctrl+V doesn't work — nothing happens when I press it

A few possible reasons:

- **The console doesn't have focus.** Click directly on the console area (the black screen where the remote desktop or terminal is rendered), then try again. If you click anywhere else on the page, keyboard input goes elsewhere.
- **Another extension is intercepting Ctrl+V.** Password managers and clipboard managers sometimes capture this shortcut. Try using the popup method instead: click the extension icon, paste your text in the textarea, and click Send.
- **The console is still loading.** If the noVNC connection hasn't fully established, keystrokes will be ignored. Wait for the console to show the remote screen, then try.
- **You're on a page where the extension can't inject.** Chrome prevents extension scripts from running on certain pages (the Chrome Web Store itself, `chrome://` pages, some enterprise-managed pages). Make sure you're on an ordinary http/https page.

---

### How do I cancel a paste that's in progress?

Click the **Cancel** button in the progress overlay that appears on screen while text is being sent. The extension will stop immediately after the current character. There's no way to undo characters that were already typed — if you need to clear what was sent, do it manually in the console.

---

### The extension works, but it's too slow / too fast

Open the popup and adjust the **Typing speed** slider. Lower values (closer to 10ms) are faster but may cause characters to be dropped on slow connections or busy consoles. Higher values (closer to 200ms) are slower but more reliable.

If you're on a fast local network with a responsive Proxmox instance, 10–20ms usually works fine. Over a remote connection with any latency, 50–80ms is a safer starting point.

---

## Troubleshooting

**Console detected but characters are being dropped**
Increase the typing speed (higher ms value = slower = more reliable). Also make sure no other application is capturing keyboard focus while the paste is running — don't click elsewhere on your screen during the operation.

**The progress bar disappears but text stops mid-way**
This can happen if the console loses focus or the connection drops. Check that the console is still connected and retry. If you need to paste a very long script, consider breaking it into smaller chunks.

**Extension icon is greyed out**
Chrome greys out extension icons on pages where the extension isn't allowed to run. This happens on Chrome-internal pages (`chrome://`, `chrome-extension://`) and on the Chrome Web Store. It's a Chrome restriction, not a bug.

**After updating Chrome, the extension stopped working**
Try disabling and re-enabling the extension from `chrome://extensions/`. If that doesn't help, uninstall and reinstall it. Chrome extension updates occasionally require a fresh injection into existing tabs — a browser restart usually fixes it.

**Right-click context menu option doesn't appear**
The context menu option only appears when you right-click on a page where a KVM console has been detected, or when you have text selected. On pages without a detected console, the option is hidden to keep the menu clean.

---

## About This Extension

KVM Console Paste is a free tool built by [AGENCIA RSE](https://agenciarse.com), a web development and automation agency. We built it because we kept running into the same problem ourselves — trying to paste a 60-character randomly generated password into an IONOS KVM console by hand is nobody's idea of a good time.

It's free to use, no account required, no strings attached.

If it saves you time and you feel like saying thanks, a small donation goes a long way toward keeping free tools like this maintained and updated.

[Buy us a coffee via PayPal](https://www.paypal.com/paypalme/dmeijide)

---

## Contact and Support

If you've read through this page and still can't get things working, reach out. We actually respond.

**AGENCIA RSE**
[agenciarse.com](https://agenciarse.com)

For extension-specific issues, include the following in your message so we can help faster:
- Your browser and version
- Your hosting provider / console URL (the domain is enough, no need to share credentials)
- What you see in the extension popup (detected / not detected)
- A brief description of what happens when you try to paste

We'll do our best to respond within a couple of business days.
