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
  const siteSection = document.getElementById('siteSection');
  const mainSection = document.getElementById('mainSection');
  const enableBtn = document.getElementById('enableBtn');
  const sitesToggle = document.getElementById('sitesToggle');
  const sitesList = document.getElementById('sitesList');
  const sitesBadge = document.getElementById('sitesBadge');
  const sitesChevron = document.getElementById('sitesChevron');

  let currentTabId = null;
  let currentDomain = null;
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
  if (!tab) return;

  currentTabId = tab.id;
  try {
    const url = new URL(tab.url);
    currentDomain = url.hostname;
  } catch (e) {
    currentDomain = null;
  }

  // ─── Site permission check ─────────────────────────────────────────

  await refreshSiteUI();
  renderSitesList();

  // ─── Enable site button ────────────────────────────────────────────

  enableBtn.addEventListener('click', async () => {
    if (!currentDomain) return;
    enableBtn.disabled = true;
    enableBtn.textContent = 'Requesting permission...';

    const origin = buildOrigin(tab.url);
    if (!origin) { enableBtn.disabled = false; enableBtn.textContent = 'Enable on this site'; return; }

    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch (e) { /* user dismissed */ }

    if (!granted) {
      enableBtn.disabled = false;
      enableBtn.textContent = 'Enable on this site';
      return;
    }

    // Register content script for this domain (persists across sessions)
    await registerScriptForDomain(currentDomain, origin);

    // Save domain to storage list
    await saveDomain(currentDomain);

    // Inject into the already-loaded page immediately
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId, allFrames: true },
        files: ['lib/keysym-map.js', 'content.js'],
      });
    } catch (e) { /* restricted page */ }

    await refreshSiteUI();
    renderSitesList();
    checkStatus();
  });

  // ─── Sites list toggle ─────────────────────────────────────────────

  sitesToggle.addEventListener('click', () => {
    const isOpen = sitesList.style.display !== 'none';
    sitesList.style.display = isOpen ? 'none' : 'block';
    sitesChevron.classList.toggle('open', !isOpen);
  });

  // ─── Site UI helpers ───────────────────────────────────────────────

  async function isSiteEnabled(domain) {
    if (!domain) return false;
    const { enabledDomains = [] } = await chrome.storage.local.get('enabledDomains');
    return enabledDomains.includes(domain);
  }

  function buildOrigin(tabUrl) {
    try {
      const u = new URL(tabUrl);
      if (!u.hostname) return null;
      return `${u.protocol}//${u.hostname}/*`;
    } catch (e) { return null; }
  }

  async function registerScriptForDomain(domain, origin) {
    const id = `kvm-paste-${domain}`;
    // Unregister first to avoid duplicate error
    try { await chrome.scripting.unregisterContentScripts({ ids: [id] }); } catch (e) { /* not registered */ }
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [origin],
      js: ['lib/keysym-map.js', 'content.js'],
      runAt: 'document_idle',
      allFrames: true,
    }]);
  }

  async function saveDomain(domain) {
    const { enabledDomains = [] } = await chrome.storage.local.get('enabledDomains');
    if (!enabledDomains.includes(domain)) {
      enabledDomains.push(domain);
      await chrome.storage.local.set({ enabledDomains });
    }
  }

  async function removeDomain(domain) {
    // Unregister content script
    try { await chrome.scripting.unregisterContentScripts({ ids: [`kvm-paste-${domain}`] }); } catch (e) { /* ok */ }
    // Remove host permission
    try {
      await chrome.permissions.remove({ origins: [`https://${domain}/*`, `http://${domain}/*`] });
    } catch (e) { /* ok */ }
    // Remove from storage
    const { enabledDomains = [] } = await chrome.storage.local.get('enabledDomains');
    await chrome.storage.local.set({ enabledDomains: enabledDomains.filter(d => d !== domain) });
  }

  async function refreshSiteUI() {
    const enabled = await isSiteEnabled(currentDomain);

    if (!currentDomain || currentDomain === 'newtab' || tab.url.startsWith('chrome://')) {
      // Can't run on chrome:// pages
      siteSection.style.display = 'none';
      mainSection.style.display = 'block';
      return;
    }

    if (enabled) {
      siteSection.style.display = 'none';
      mainSection.style.display = 'block';
      // Show site tag in header if not already there
      if (!document.getElementById('siteTag')) {
        const tag = document.createElement('div');
        tag.id = 'siteTag';
        tag.className = 'site-tag';
        const domainSpan = document.createElement('span');
        domainSpan.textContent = currentDomain;
        const disableBtn = document.createElement('button');
        disableBtn.className = 'disable-site';
        disableBtn.title = 'Disable on this site';
        disableBtn.textContent = '✕';
        disableBtn.addEventListener('click', async () => {
          await removeDomain(currentDomain);
          tag.remove();
          await refreshSiteUI();
          renderSitesList();
        });
        tag.appendChild(domainSpan);
        tag.appendChild(disableBtn);
        document.querySelector('#status').after(tag);
      }
    } else {
      siteSection.style.display = 'block';
      mainSection.style.display = 'none';
      document.getElementById('siteTag')?.remove();
      enableBtn.disabled = false;
      enableBtn.textContent = 'Enable on this site';
    }
  }

  async function renderSitesList() {
    const { enabledDomains = [] } = await chrome.storage.local.get('enabledDomains');
    sitesBadge.textContent = enabledDomains.length;

    // Clear existing items
    while (sitesList.firstChild) sitesList.removeChild(sitesList.firstChild);

    if (enabledDomains.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sites-empty';
      empty.textContent = 'No sites enabled yet';
      sitesList.appendChild(empty);
      return;
    }

    for (const domain of enabledDomains) {
      const item = document.createElement('div');
      item.className = 'site-item';

      const domainEl = document.createElement('span');
      domainEl.className = 'site-item-domain';
      domainEl.textContent = domain;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'site-item-remove';
      removeBtn.title = 'Remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', async () => {
        await removeDomain(domain);
        if (domain === currentDomain) {
          document.getElementById('siteTag')?.remove();
          await refreshSiteUI();
        }
        renderSitesList();
      });

      item.appendChild(domainEl);
      item.appendChild(removeBtn);
      sitesList.appendChild(item);
    }
  }

  // ─── Messaging helper: send to the correct frame ───────────────────

  function sendToConsole(message) {
    const opts = consoleFrameId != null ? { frameId: consoleFrameId } : {};
    return chrome.tabs.sendMessage(currentTabId, message, opts);
  }

  // ─── Status check (query ALL frames) ──────────────────────────────

  async function checkStatus() {
    if (!currentTabId) return;

    let frames;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
    } catch (e) {
      frames = [{ frameId: 0 }];
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
      } catch (e) { /* frame may not have content script yet */ }
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
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { typingDelay: parseInt(val) } }).catch(() => {});
  });

  newlineSlider.addEventListener('input', () => {
    const val = newlineSlider.value;
    newlineValue.textContent = val + 'ms';
    chrome.storage.local.set({ newlineDelay: parseInt(val) });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { newlineDelay: parseInt(val) } }).catch(() => {});
  });

  autoPaste.addEventListener('change', () => {
    chrome.storage.local.set({ autoPasteOnCtrlV: autoPaste.checked });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { autoPasteOnCtrlV: autoPaste.checked } }).catch(() => {});
  });

  showOverlay.addEventListener('change', () => {
    chrome.storage.local.set({ showProgressOverlay: showOverlay.checked });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { showProgressOverlay: showOverlay.checked } }).catch(() => {});
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
        text,
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
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    setTimeout(() => { progressSection.style.display = 'none'; }, 500);
    checkStatus();
  }
});
