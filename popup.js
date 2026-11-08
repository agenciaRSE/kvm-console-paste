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
  const siteHosts = document.getElementById('siteHosts');
  const progressBar = document.getElementById('progressBar');

  function setProgress(pct) {
    progressFill.style.width = pct + '%';
    progressText.textContent = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(pct));
  }

  let currentTabId = null;
  let currentDomain = null;
  let consoleFrameId = null;
  let pollInterval = null;

  const confirmMultiline = document.getElementById('confirmMultiline');
  const textInfo = document.getElementById('textInfo');
  const shortcutInfo = document.getElementById('shortcutInfo');

  // ─── i18n ──────────────────────────────────────────────────────────

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));

  chrome.commands.getAll().then((commands) => {
    const shortcut = commands.find((c) => c.name === '_execute_action')?.shortcut;
    if (shortcut) shortcutInfo.textContent = t('shortcut', [shortcut]);
  }).catch(() => {});

  // ─── Load settings ─────────────────────────────────────────────────

  function showSpeed(val) {
    speedValue.textContent = t('msValue', [String(val)]);
    speedSlider.setAttribute('aria-valuetext', t('msPerChar', [String(val)]));
  }
  function showNewline(val) {
    newlineValue.textContent = t('msValue', [String(val)]);
    newlineSlider.setAttribute('aria-valuetext', t('msValue', [String(val)]));
  }

  const stored = await chrome.storage.local.get(['typingDelay', 'newlineDelay', 'autoPasteOnCtrlV', 'showProgressOverlay', 'confirmMultiline']);
  if (stored.typingDelay != null) speedSlider.value = stored.typingDelay;
  if (stored.newlineDelay != null) newlineSlider.value = stored.newlineDelay;
  showSpeed(speedSlider.value);
  showNewline(newlineSlider.value);
  if (stored.autoPasteOnCtrlV != null) autoPaste.checked = stored.autoPasteOnCtrlV;
  if (stored.showProgressOverlay != null) showOverlay.checked = stored.showProgressOverlay;
  if (stored.confirmMultiline != null) confirmMultiline.checked = stored.confirmMultiline;

  // What will happen when this text is typed (line breaks run commands,
  // non-ASCII depends on the server layout). Linked via aria-describedby.
  function updateTextInfo() {
    const { lineBreaks, nonAscii } = KeysymMap.analyze(textInput.value);
    while (textInfo.firstChild) textInfo.removeChild(textInfo.firstChild);
    if (lineBreaks > 0) {
      const p = document.createElement('p');
      p.textContent = lineBreaks === 1 ? t('lineBreakOne') : t('lineBreakMany', [String(lineBreaks)]);
      textInfo.appendChild(p);
    }
    if (nonAscii.length) {
      const p = document.createElement('p');
      p.className = 'warn';
      p.textContent = t('nonAscii', [nonAscii.join(' ')]);
      textInfo.appendChild(p);
    }
  }

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

  // Origins of every frame in the tab: the console is often an iframe on
  // another host (IONOS: front-cloudpanel.ionos.com -> dcd.ionos.com).
  // Computed now so the click handler can call permissions.request() first,
  // while the user gesture is still valid.
  let neededOrigins = [];
  await computeNeededOrigins();

  await refreshSiteUI();
  renderSitesList();
  // Find the frame with the console (on IONOS it is an iframe, not frame 0).
  // A blocked site has no content script to answer: its status is already set.
  if (siteSection.style.display === 'none') checkStatus();

  // ─── Enable site button ────────────────────────────────────────────

  enableBtn.addEventListener('click', async () => {
    if (!currentDomain || !neededOrigins.length) return;
    enableBtn.disabled = true;
    enableBtn.textContent = t('requestingPermission');

    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: neededOrigins });
    } catch (e) { /* user dismissed */ }

    if (!granted) {
      enableBtn.disabled = false;
      enableBtn.textContent = t('enableSite');
      return;
    }

    // Persist + register content scripts for every origin (survives restarts)
    await KvmSites.add(currentDomain, neededOrigins);

    // Inject into the already-loaded page too. The page-world script arrives
    // after noVNC opened its socket; it picks it up on noVNC's next send.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId, allFrames: true },
        files: ['page-inject.js'],
        world: 'MAIN',
      });
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId, allFrames: true },
        files: ['lib/keysym-map.js', 'content.js'],
      });
    } catch (e) { /* restricted page */ }

    await refreshSiteUI();
    renderSitesList();
    // Content scripts need a moment to scan the frames.
    setTimeout(checkStatus, 500);
  });

  // ─── Sites list toggle ─────────────────────────────────────────────

  sitesToggle.addEventListener('click', () => {
    const isOpen = sitesList.style.display !== 'none';
    sitesList.style.display = isOpen ? 'none' : 'block';
    sitesToggle.setAttribute('aria-expanded', String(!isOpen));
    sitesChevron.classList.toggle('open', !isOpen);
  });

  // ─── Site UI helpers ───────────────────────────────────────────────

  async function computeNeededOrigins() {
    const set = new Set();
    const add = (url) => {
      try {
        const u = new URL(url);
        if (u.protocol === 'https:' || u.protocol === 'http:') set.add(`${u.protocol}//${u.hostname}/*`);
      } catch (e) { /* about:blank, etc. */ }
    };
    add(tab.url);
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
      for (const f of frames || []) add(f.url);
    } catch (e) { /* no frame info */ }
    if (currentDomain) {
      const { siteOrigins } = await KvmSites.load();
      for (const o of siteOrigins[currentDomain] || []) set.add(o);
    }
    neededOrigins = [...set];
  }

  // Enabled = saved AND every origin currently needed is granted (a v1.0.x
  // site, or a console moved to a new host, asks again).
  async function isSiteEnabled(domain) {
    if (!domain || !neededOrigins.length) return false;
    const { enabledDomains } = await KvmSites.load();
    if (!enabledDomains.includes(domain)) return false;
    return chrome.permissions.contains({ origins: neededOrigins }).catch(() => false);
  }

  const removeDomain = (domain) => KvmSites.remove(domain);

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
        disableBtn.title = t('disableOn', [currentDomain]);
        disableBtn.setAttribute('aria-label', t('disableOn', [currentDomain]));
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
      const hosts = neededOrigins.map((o) => new URL(o.replace('/*', '/')).hostname);
      siteHosts.textContent = hosts.join('\n');
      statusText.textContent = t('statusDisabled');
      document.getElementById('siteTag')?.remove();
      enableBtn.disabled = false;
      enableBtn.textContent = t('enableSite');
    }
  }

  async function renderSitesList() {
    const { enabledDomains } = await KvmSites.load();
    sitesBadge.textContent = enabledDomains.length;

    // Clear existing items
    while (sitesList.firstChild) sitesList.removeChild(sitesList.firstChild);

    if (enabledDomains.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sites-empty';
      empty.textContent = t('noSites');
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
      removeBtn.title = t('removeSite', [domain]);
      removeBtn.setAttribute('aria-label', t('removeSite', [domain]));
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
          statusText.textContent = t('statusDetected');
          sendBtn.disabled = !textInput.value.trim();
          found = true;
          break;
        }
      } catch (e) { /* frame may not have content script yet */ }
    }

    if (!found) {
      consoleFrameId = null;
      statusDot.classList.remove('active');
      statusText.textContent = t('statusNone');
      sendBtn.disabled = true;
    }
  }

  // ─── Event handlers ────────────────────────────────────────────────

  textInput.addEventListener('input', () => {
    sendBtn.disabled = !textInput.value.trim() || consoleFrameId == null;
    updateTextInfo();
  });

  speedSlider.addEventListener('input', () => {
    const val = speedSlider.value;
    showSpeed(val);
    chrome.storage.local.set({ typingDelay: parseInt(val) });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { typingDelay: parseInt(val) } }).catch(() => {});
  });

  newlineSlider.addEventListener('input', () => {
    const val = newlineSlider.value;
    showNewline(val);
    chrome.storage.local.set({ newlineDelay: parseInt(val) });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { newlineDelay: parseInt(val) } }).catch(() => {});
  });

  autoPaste.addEventListener('change', () => {
    chrome.storage.local.set({ autoPasteOnCtrlV: autoPaste.checked });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { autoPasteOnCtrlV: autoPaste.checked } }).catch(() => {});
  });

  confirmMultiline.addEventListener('change', () => {
    chrome.storage.local.set({ confirmMultiline: confirmMultiline.checked });
    if (currentTabId) sendToConsole({ action: 'updateSettings', settings: { confirmMultiline: confirmMultiline.checked } }).catch(() => {});
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
    setProgress(0);
    textInput.disabled = true;

    try {
      const res = await sendToConsole({
        action: 'sendText',
        text,
        delay: parseInt(speedSlider.value),
        newlineDelay: parseInt(newlineSlider.value),
      });
      if (!res?.ok) throw new Error(res?.error);
      startProgressPoll();
    } catch (e) {
      resetUI();
      statusText.textContent = t('statusSendError');
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
    updateTextInfo();
    textInput.focus();
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
          setProgress(100);
          setTimeout(() => resetUI(), 1000);
        } else if (response.progress?.total) {
          setProgress(Math.round((response.progress.current / response.progress.total) * 100));
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
