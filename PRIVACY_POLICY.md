# Privacy Policy - KVM Console Paste

**Last updated:** March 29, 2026
**Developer:** AGENCIA RSE ([agenciarse.com](https://agenciarse.com))

## Overview

KVM Console Paste is a browser extension that enables copy-paste functionality in web-based KVM consoles (noVNC). We are committed to protecting your privacy.

## Data Collection

**We do not collect, store, transmit, or share any personal data whatsoever.**

This extension:
- Does **not** collect browsing history
- Does **not** collect personal information
- Does **not** use analytics or tracking
- Does **not** communicate with any external servers
- Does **not** store any data outside your browser
- Does **not** share any data with third parties

## Data Usage

The extension processes the following data **entirely locally within your browser**:

- **Clipboard content**: Read only when you explicitly paste (Ctrl+V) on a KVM console page or use the "Send to console" button or the context menu. The clipboard text is immediately converted to simulated keystrokes and is never stored or transmitted.
- **User preferences**: Settings (typing speed, newline delay, toggle options) are stored locally in Chrome's `storage.local` API and never leave your device.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `clipboardRead` | To read text from your clipboard when you paste into the KVM console |
| `activeTab` | To interact with the currently active tab containing the KVM console |
| `scripting` | To inject the keystroke simulation script into KVM console pages |
| `storage` | To save your preferences (typing speed, options) locally |
| `contextMenus` | To add a right-click "Paste to KVM Console" option |
| `webNavigation` | To detect KVM consoles inside iframes on hosting provider pages |

## Content Scripts

The extension injects content scripts into web pages to detect KVM consoles (canvas elements used by noVNC). These scripts run with `all_frames: true` to detect consoles embedded in iframes. The scripts only activate when a KVM console canvas is detected and do not modify or read any other page content.

## Third-Party Services

This extension does not use any third-party services, APIs, or analytics platforms.

## Changes to This Policy

Any changes to this privacy policy will be posted in the extension's Chrome Web Store listing and on our website.

## Contact

If you have questions about this privacy policy, contact us at:
- Website: [agenciarse.com](https://agenciarse.com)
- Developer: AGENCIA RSE
