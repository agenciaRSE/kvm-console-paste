/**
 * KVM Console Paste - Site registration helpers.
 * Shared by the popup (classic script) and the service worker (importScripts).
 *
 * A "site" is the domain shown in the tab. Its console may live in an iframe
 * on another host (IONOS: front-cloudpanel.ionos.com embeds dcd.ionos.com),
 * so each site stores every origin its scripts must match.
 *
 * Storage: enabledDomains: string[], siteOrigins: { [domain]: string[] }
 */

var KvmSites = (() => {
  const ids = (domain) => [`kvm-paste-${domain}`, `kvm-paste-main-${domain}`];

  async function load() {
    const { enabledDomains = [], siteOrigins = {} } =
      await chrome.storage.local.get(['enabledDomains', 'siteOrigins']);
    return { enabledDomains, siteOrigins };
  }

  // Sites saved by v1.0.x have no siteOrigins entry: only their own domain.
  function originsFor(domain, siteOrigins) {
    return siteOrigins[domain] || [`https://${domain}/*`];
  }

  async function register(domain, origins) {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ids(domain) });
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    }
    await chrome.scripting.registerContentScripts([
      {
        id: ids(domain)[0],
        matches: origins,
        js: ['lib/keysym-map.js', 'content.js'],
        runAt: 'document_idle',
        allFrames: true,
      },
      {
        // Page world, as early as possible, to see the console's WebSocket.
        id: ids(domain)[1],
        matches: origins,
        js: ['page-inject.js'],
        runAt: 'document_start',
        allFrames: true,
        world: 'MAIN',
      },
    ]);
  }

  async function add(domain, origins) {
    const { enabledDomains, siteOrigins } = await load();
    if (!enabledDomains.includes(domain)) enabledDomains.push(domain);
    siteOrigins[domain] = origins;
    await chrome.storage.local.set({ enabledDomains, siteOrigins });
    await register(domain, origins);
  }

  async function remove(domain) {
    const { enabledDomains, siteOrigins } = await load();
    const mine = originsFor(domain, siteOrigins);
    const rest = enabledDomains.filter((d) => d !== domain);
    delete siteOrigins[domain];
    await chrome.storage.local.set({ enabledDomains: rest, siteOrigins });

    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ids(domain) });
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    }
    // Keep origins another enabled site still needs (shared console host).
    const stillUsed = new Set(rest.flatMap((d) => originsFor(d, siteOrigins)));
    const drop = mine.filter((o) => !stillUsed.has(o));
    if (drop.length) await chrome.permissions.remove({ origins: drop }).catch(() => {});
  }

  // Rebuild every registration (after install/update, scripts may have changed).
  async function reRegisterAll() {
    await chrome.scripting.unregisterContentScripts().catch(() => {});
    const { enabledDomains, siteOrigins } = await load();
    for (const domain of enabledDomains) {
      const granted = [];
      for (const origin of originsFor(domain, siteOrigins)) {
        if (await chrome.permissions.contains({ origins: [origin] }).catch(() => false)) granted.push(origin);
      }
      if (granted.length) await register(domain, granted).catch(() => {});
    }
  }

  return { load, originsFor, add, remove, reRegisterAll };
})();
