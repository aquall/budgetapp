const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const pwaScript = fs.readFileSync(path.join(root, "js/pwa.js"), "utf8");

function runPwa({ userAgent = "", platform = "", maxTouchPoints = 0, standalone = false, secure = false } = {}) {
  const ids = ["pwaInstallTip"];
  const elements = Object.fromEntries(ids.map(id => [id, { id, hidden: id === "pwaInstallTip", textContent: "Original setup instructions" }]));
  const windowListeners = {};
  let serviceWorkerRegistration = null;
  const navigator = {
    userAgent,
    platform,
    maxTouchPoints,
    standalone,
    serviceWorker: { register: async (...args) => { serviceWorkerRegistration = args; return {}; } }
  };
  const window = {
    navigator,
    isSecureContext: secure,
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (name, callback) => { windowListeners[name] = callback; }
  };
  vm.runInNewContext(pwaScript, {
    window,
    navigator,
    document: { getElementById: id => elements[id] || null },
    console: { warn() {} }
  }, { filename: "js/pwa.js" });
  return { window, elements, windowListeners, getServiceWorkerRegistration: () => serviceWorkerRegistration };
}

test("iPhone Safari shows Add to Home Screen guidance", () => {
  const { window, elements } = runPwa({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    platform: "iPhone"
  });

  assert.equal(window.BudgetAppPwa.isStandalone, false);
  assert.equal(elements.pwaInstallTip.hidden, false);
});

test("installed iPhone app hides the Safari install hint", () => {
  const { window, elements } = runPwa({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    platform: "iPhone",
    standalone: true
  });

  assert.equal(window.BudgetAppPwa.isStandalone, true);
  assert.equal(elements.pwaInstallTip.hidden, true);
});

test("PWA manifest uses a standalone relative scope and includes install icons", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const plaidCardStart = html.indexOf("Plaid API Connection");
  const plaidHelpPosition = html.indexOf("Start the app from its folder with");
  const nextCardStart = html.indexOf("Account Type Designations", plaidCardStart);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512"));
  for (const iconPath of ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"]) {
    assert.ok(fs.existsSync(path.join(root, iconPath)), `${iconPath} exists`);
  }
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.ok(html.indexOf("js/pwa.js") < html.indexOf("js/app.js"));
  assert.ok(plaidHelpPosition > plaidCardStart && plaidHelpPosition < nextCardStart);
});

test("iPhone layout reserves safe areas and keeps long navigation labels compact", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /max-width: 360px/);
  assert.match(html, /data-label-short="Plan"/);
  assert.match(html, /data-label-short="Txns"/);
  assert.match(html, /aria-label="Transactions"/);
});

test("PWA registers a relative service worker on secure hosting", async () => {
  const { windowListeners, getServiceWorkerRegistration } = runPwa({ hostname: "aquall.github.io", secure: true });

  assert.equal(typeof windowListeners.load, "function");
  await windowListeners.load();
  assert.equal(JSON.stringify(getServiceWorkerRegistration()), JSON.stringify(["./service-worker.js", { scope: "./" }]));
});

test("service worker shell excludes API routes and third-party requests", async () => {
  const source = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const listeners = {};
  const shell = [];
  let networkAvailable = true;
  let cachedResponse;
  let cachedRequest;
  let skippedWaiting = false;
  const cache = {
    addAll: async urls => shell.push(...urls),
    put: async () => {}
  };
  const context = {
    self: {
      location: new URL("https://aquall.github.io/budgetapp/service-worker.js"),
      clients: { claim: async () => {} },
      addEventListener: (name, callback) => { listeners[name] = callback; },
      skipWaiting: async () => { skippedWaiting = true; }
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      match: async request => { cachedRequest = request; return cachedResponse; },
      delete: async () => true
    },
    URL,
    Promise,
    Response,
    fetch: async () => {
      if (!networkAvailable) throw new Error("offline");
      return new Response("online", { status: 200 });
    }
  };
  vm.runInNewContext(source, context, { filename: "service-worker.js" });

  let installPromise;
  listeners.install({ waitUntil: promise => { installPromise = promise; } });
  await installPromise;
  assert.ok(skippedWaiting);
  assert.ok(shell.includes("./index.html"));
  assert.ok(shell.includes("./js/pwa.js"));
  assert.ok(shell.every(url => !url.includes("/api/") && !/^https?:\/\//.test(url)));
  for (const entry of shell) {
    if (entry === "./") continue;
    assert.ok(fs.existsSync(path.join(root, entry.slice(2))), `${entry} is precached`);
  }

  let handledApi = false;
  listeners.fetch({
    request: { method: "GET", url: "https://aquall.github.io/budgetapp/api/plaid/sync", mode: "cors" },
    respondWith: () => { handledApi = true; }
  });
  assert.equal(handledApi, false);

  let handledPlaid = false;
  listeners.fetch({
    request: { method: "GET", url: "https://cdn.plaid.com/link/v2/stable/link.html", mode: "cors" },
    respondWith: () => { handledPlaid = true; }
  });
  assert.equal(handledPlaid, false);

  let assetResponsePromise;
  listeners.fetch({
    request: { method: "GET", url: "https://aquall.github.io/budgetapp/styles.css", mode: "cors" },
    respondWith: promise => { assetResponsePromise = promise; }
  });
  assert.equal((await assetResponsePromise).status, 200);

  networkAvailable = false;
  cachedResponse = new Response("cached offline asset", { status: 200 });
  let offlineResponsePromise;
  listeners.fetch({
    request: { method: "GET", url: "https://aquall.github.io/budgetapp/styles.css", mode: "cors" },
    respondWith: promise => { offlineResponsePromise = promise; }
  });
  assert.equal(await (await offlineResponsePromise).text(), "cached offline asset");

  cachedResponse = new Response("cached offline page", { status: 200 });
  let navigationResponsePromise;
  listeners.fetch({
    request: { method: "GET", url: "https://aquall.github.io/budgetapp/", mode: "navigate" },
    respondWith: promise => { navigationResponsePromise = promise; }
  });
  assert.equal(await (await navigationResponsePromise).text(), "cached offline page");
  assert.equal(cachedRequest.href, "https://aquall.github.io/budgetapp/index.html");
});
