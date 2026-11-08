/**
 * KVM Console Paste - Background Service Worker
 */

importScripts('lib/sites.js');

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

// On install/update: recreate the context menu and rebuild the content-script
// registrations from storage (scripts and match lists may have changed).
chrome.runtime.onInstalled.addListener(async () => {
  // On update the old item still exists: re-creating it would throw "duplicate id".
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'kvmPaste',
    title: chrome.i18n.getMessage('menuPaste'),
    contexts: ['page', 'frame'],
  });
  await KvmSites.reRegisterAll();
});

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
