/**
 * KVM Console Paste - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const textInput = document.getElementById('textInput');
  const sendBtn = document.getElementById('sendBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const clearBtn = document.getElementById('clearBtn');
  const speedSlider = document.getElementById('speedSlider');
  const speedValue = document.getElementById('speedValue');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const strategyInfo = document.getElementById('strategyInfo');
  const progressSection = document.getElementById('progressSection');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const newlineSlider = document.getElementById('newlineSlider');
  const newlineValue = document.getElementById('newlineValue');
  const autoPaste = document.getElementById('autoPaste');
  const showOverlay = document.getElementById('showOverlay');

  let currentTabId = null;
  let consoleFrameId = null;
  let pollInterval = null;

  // ─── Load settings ─────────────────────────────────────────────────

  const stored = await chrome.storage.local.get(['typingDelay', 'newlineDelay', 'autoPasteOnCtrlV', 'showProgressOverlay']);
  if (stored.typingDelay != null) {
    speedSlider.value = stored.typingDelay;
    speedValue.textContent = stored.typingDelay + 'ms';
  }
  if (stored.newlineDelay != null) {
    newlineSlider.value = stored.newlineDelay;
    newlineValue.textContent = stored.newlineDelay + 'ms';
  }
  if (stored.autoPasteOnCtrlV != null) autoPaste.checked = stored.autoPasteOnCtrlV;
  if (stored.showProgressOverlay != null) showOverlay.checked = stored.showProgressOverlay;

  // ─── Get active tab ────────────────────────────────────────────────

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    checkStatus();
  }

  // ─── Messaging helper: send to the correct frame ───────────────────

  function sendToConsole(message) {
    const opts = consoleFrameId != null ? { frameId: consoleFrameId } : {};
    return chrome.tabs.sendMessage(currentTabId, message, opts);
  }

  // ─── Status check (query ALL frames) ──────────────────────────────

  async function checkStatus() {
    if (!currentTabId) return;

    // Get all frames in the tab
    let frames;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
    } catch (e) {
      frames = [{ frameId: 0 }]; // Fallback: just try main frame
    }

    let found = false;

    for (const frame of frames) {
      try {
        const response = await chrome.tabs.sendMessage(
          currentTabId,
          { action: 'getStatus' },
          { frameId: frame.frameId }
        );
        if (response?.consoleDetected) {
          consoleFrameId = frame.frameId;
          statusDot.classList.add('active');
          statusText.textContent = 'KVM console detected';
          strategyInfo.textContent = `Frame: ${frame.frameId === 0 ? 'main' : frame.frameId}`;
          sendBtn.disabled = !textInput.value.trim();
          found = true;
          break;
        }
      } catch (e) {
        // Frame may not have our content script
      }
    }

    if (!found) {
      statusDot.classList.remove('active');
      statusText.textContent = 'No KVM console detected on this page';
      strategyInfo.textContent = '';
      sendBtn.disabled = true;
    }
  }

  // ─── Event handlers ────────────────────────────────────────────────

  textInput.addEventListener('input', () => {
    sendBtn.disabled = !textInput.value.trim();
  });

  speedSlider.addEventListener('input', () => {
    const val = speedSlider.value;
    speedValue.textContent = val + 'ms';
    chrome.storage.local.set({ typingDelay: parseInt(val) });
    if (currentTabId) {
      sendToConsole({
        action: 'updateSettings',
        settings: { typingDelay: parseInt(val) },
      }).catch(() => {});
    }
  });

  newlineSlider.addEventListener('input', () => {
    const val = newlineSlider.value;
    newlineValue.textContent = val + 'ms';
    chrome.storage.local.set({ newlineDelay: parseInt(val) });
    if (currentTabId) {
      sendToConsole({
        action: 'updateSettings',
        settings: { newlineDelay: parseInt(val) },
      }).catch(() => {});
    }
  });

  autoPaste.addEventListener('change', () => {
    chrome.storage.local.set({ autoPasteOnCtrlV: autoPaste.checked });
    if (currentTabId) {
      sendToConsole({
        action: 'updateSettings',
        settings: { autoPasteOnCtrlV: autoPaste.checked },
      }).catch(() => {});
    }
  });

  showOverlay.addEventListener('change', () => {
    chrome.storage.local.set({ showProgressOverlay: showOverlay.checked });
    if (currentTabId) {
      sendToConsole({
        action: 'updateSettings',
        settings: { showProgressOverlay: showOverlay.checked },
      }).catch(() => {});
    }
  });

  sendBtn.addEventListener('click', async () => {
    const text = textInput.value;
    if (!text || !currentTabId) return;

    sendBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    progressSection.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    textInput.disabled = true;

    try {
      await sendToConsole({
        action: 'sendText',
        text: text,
        delay: parseInt(speedSlider.value),
        newlineDelay: parseInt(newlineSlider.value),
      });
      startProgressPoll();
    } catch (e) {
      resetUI();
      statusText.textContent = 'Error: Could not send text to console';
    }
  });

  cancelBtn.addEventListener('click', async () => {
    if (currentTabId) {
      try { await sendToConsole({ action: 'cancelSend' }); } catch (e) { /* ignore */ }
    }
    resetUI();
  });

  clearBtn.addEventListener('click', () => {
    textInput.value = '';
    sendBtn.disabled = true;
  });

  // ─── Progress polling ──────────────────────────────────────────────

  function startProgressPoll() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const response = await sendToConsole({ action: 'getStatus' });
        if (!response?.sending) {
          clearInterval(pollInterval);
          pollInterval = null;
          progressFill.style.width = '100%';
          progressText.textContent = '100%';
          setTimeout(() => resetUI(), 1000);
        }
      } catch (e) {
        clearInterval(pollInterval);
        pollInterval = null;
        resetUI();
      }
    }, 300);
  }

  function resetUI() {
    sendBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'none';
    textInput.disabled = false;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    setTimeout(() => {
      progressSection.style.display = 'none';
    }, 500);
    checkStatus();
  }
});
