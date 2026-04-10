/**
 * KVM Console Paste - Background Service Worker
 */

// Update badge when content script reports console detection
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateBadge' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({
      text: message.detected ? 'ON' : '',
      tabId,
    }).catch(() => { /* Tab may have been closed */ });
    chrome.action.setBadgeBackgroundColor({
      color: '#3fb950',
      tabId,
    }).catch(() => { /* Tab may have been closed */ });
  }
  return false;
});

// On install/update: recreate context menu and re-register content scripts
// for all saved domains (dynamic registrations survive updates but not
// a full uninstall+reinstall, so we restore them from storage).
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: 'kvmPaste',
    title: 'Paste to KVM Console',
    contexts: ['page', 'frame'],
  });
  await reRegisterAllDomains();
});

// Also re-register on browser startup (registrations persist, but this
// guards against edge cases where the profile was partially reset).
chrome.runtime.onStartup.addListener(async () => {
  await reRegisterAllDomains();
});

async function reRegisterAllDomains() {
  const { enabledDomains = [] } = await chrome.storage.local.get('enabledDomains');
  for (const domain of enabledDomains) {
    const id = `kvm-paste-${domain}`;
    const origin = `https://${domain}/*`;
    // Skip if already registered
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
    if (existing.length > 0) continue;
    // Check we still have the host permission
    const hasPerm = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
    if (!hasPerm) continue;
    try {
      await chrome.scripting.registerContentScripts([{
        id,
        matches: [origin],
        js: ['lib/keysym-map.js', 'content.js'],
        runAt: 'document_idle',
        allFrames: true,
      }]);
    } catch (e) { /* already registered or permission lost */ }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'kvmPaste' || !tab?.id) return;

  try {
    // Get all frames to find the one with KVM console
    let frames;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    } catch (e) {
      frames = [{ frameId: 0 }];
    }

    for (const frame of frames) {
      try {
        const response = await chrome.tabs.sendMessage(
          tab.id,
          { action: 'getStatus' },
          { frameId: frame.frameId }
        );
        if (response?.consoleDetected) {
          await chrome.tabs.sendMessage(
            tab.id,
            { action: 'contextMenuPaste' },
            { frameId: frame.frameId }
          );
          break;
        }
      } catch (e) {
        // Frame may not have our content script or tab closed
      }
    }
  } catch (e) {
    // Tab may not be scriptable or was closed
  }
});

// Clear badge when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {
      /* Tab may have been closed between the event firing and this call */
    });
  }
});
