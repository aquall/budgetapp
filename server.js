const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const plaidConnections = new Map();
const APP_DATA_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "BudgetApp");
const PLAID_VAULT_FILE = path.join(APP_DATA_DIR, "plaid-connections.dpapi");
let plaidVaultWarning = "";
const DPAPI_ENCRYPT_SCRIPT = "$ErrorActionPreference='Stop';$encoded=[Console]::In.ReadToEnd();$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded));$secure=ConvertTo-SecureString -String $json -AsPlainText -Force;[Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))";
const DPAPI_DECRYPT_SCRIPT = "$ErrorActionPreference='Stop';$encrypted=[Console]::In.ReadToEnd();$secure=ConvertTo-SecureString -String $encrypted;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);try{$json=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const ENVIRONMENTS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function getEnvironment(env) {
  const key = String(env || "sandbox").toLowerCase();
  if (!ENVIRONMENTS[key]) throw new Error("Choose Sandbox, Development, or Production as the Plaid environment.");
  return { key, url: ENVIRONMENTS[key] };
}

function runDpapi(script, input) {
  if (process.platform !== "win32") throw new Error("Secure Plaid persistence requires Windows DPAPI on this app build.");
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  }).trim();
}

function persistPlaidConnections() {
  const records = [...plaidConnections.entries()]
    .filter(([, connection]) => connection.accessToken)
    .map(([connectionId, connection]) => ({
      connectionId,
      clientId: connection.clientId,
      secret: connection.secret,
      env: connection.env,
      accessToken: connection.accessToken,
      itemId: connection.itemId,
      institution: connection.institution || "Institution"
    }));
  fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  const plaintext = Buffer.from(JSON.stringify(records), "utf8").toString("base64");
  const encrypted = runDpapi(DPAPI_ENCRYPT_SCRIPT, plaintext);
  const temporaryFile = path.join(APP_DATA_DIR, `plaid-connections-${randomUUID()}.tmp`);
  fs.writeFileSync(temporaryFile, encrypted, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryFile, PLAID_VAULT_FILE);
  plaidVaultWarning = "";
}

function restorePlaidConnections() {
  if (!fs.existsSync(PLAID_VAULT_FILE)) return;
  try {
    const encrypted = fs.readFileSync(PLAID_VAULT_FILE, "utf8");
    const encoded = runDpapi(DPAPI_DECRYPT_SCRIPT, encrypted);
    const records = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!Array.isArray(records)) throw new Error("Saved connection data is not valid.");
    records.forEach(record => {
      if (!record?.connectionId || !record.clientId || !record.secret || !record.accessToken) return;
      const { key, url: baseUrl } = getEnvironment(record.env);
      plaidConnections.set(String(record.connectionId), {
        clientId: String(record.clientId),
        secret: String(record.secret),
        env: key,
        baseUrl,
        accessToken: String(record.accessToken),
        itemId: String(record.itemId || ""),
        institution: String(record.institution || "Institution")
      });
    });
  } catch (error) {
    plaidVaultWarning = "The encrypted Plaid vault could not be opened for this Windows account.";
    console.error("Could not decrypt saved Plaid connections. Reconnect institutions to save them again.");
  }
}

async function plaidRequest(connection, route, body) {
  const response = await fetch(`${connection.baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: connection.clientId,
      secret: connection.secret,
      ...body
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error_code) {
    const error = new Error(data.error_message || `Plaid request failed (${response.status}).`);
    error.status = response.status;
    error.plaidCode = data.error_code;
    error.plaidType = data.error_type;
    throw error;
  }
  return data;
}

function publicError(error) {
  return {
    error: error.message || "Plaid request failed.",
    code: error.plaidCode || undefined,
    type: error.plaidType || undefined
  };
}

async function handleApi(req, res, url) {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && ![`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(requestOrigin)) {
    return sendJson(res, 403, { error: "This local API only accepts requests from the Budget App." });
  }
  if (url.pathname === "/api/health") {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET for the health check." });
    return sendJson(res, 200, { ok: true, persistentPlaidStorage: process.platform === "win32", plaidVaultWarning });
  }
  if (url.pathname === "/api/plaid/connections") {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET to list saved Plaid connections." });
    return sendJson(res, 200, {
      connections: [...plaidConnections.entries()]
        .filter(([, connection]) => connection.accessToken)
        .map(([connectionId, connection]) => ({ connectionId, institution: connection.institution || "Institution" })),
      warning: plaidVaultWarning
    });
  }
  if (url.pathname === "/api/plaid/credentials") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST to update saved Plaid credentials." });
    let body;
    try { body = await readJson(req); } catch (error) { return sendJson(res, 400, publicError(error)); }
    const clientId = String(body.clientId || "").trim();
    const secret = String(body.secret || "").trim();
    let environment;
    try { environment = getEnvironment(body.env); } catch (error) { return sendJson(res, 400, publicError(error)); }
    if (!clientId || !secret) return sendJson(res, 400, { error: "Enter your Plaid Client ID and Secret before saving." });
    const previousCredentials = [];
    for (const connection of plaidConnections.values()) {
      if (connection.clientId === clientId && connection.env === environment.key && connection.accessToken) {
        previousCredentials.push({ connection, secret: connection.secret, baseUrl: connection.baseUrl });
        connection.secret = secret;
        connection.baseUrl = environment.url;
      }
    }
    try {
      persistPlaidConnections();
    } catch (error) {
      previousCredentials.forEach(({ connection, secret: previousSecret, baseUrl }) => {
        connection.secret = previousSecret;
        connection.baseUrl = baseUrl;
      });
      console.error("Could not securely update saved Plaid credentials.");
      return sendJson(res, 500, { error: "Credentials were not saved to the encrypted Plaid vault. Check the app logs and try again." });
    }
    const updated = [...plaidConnections.values()].filter(item => item.accessToken && item.clientId === clientId && item.env === environment.key).length;
    return sendJson(res, 200, { updated });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST for Plaid API requests." });
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, publicError(error));
  }

  try {
    if (url.pathname === "/api/plaid/link-token") {
      const clientId = String(body.clientId || "").trim();
      const secret = String(body.secret || "").trim();
      const { key, url: baseUrl } = getEnvironment(body.env);
      if (!clientId || !secret) throw new Error("Enter your Plaid Client ID and Secret, then save your credentials.");
      const connection = { clientId, secret, env: key, baseUrl, accessToken: "", cursor: null, itemId: "" };
      const result = await plaidRequest(connection, "/link/token/create", {
        user: { client_user_id: randomUUID() },
        client_name: "Barebones Budget",
        products: ["transactions"],
        transactions: { days_requested: 730 },
        country_codes: ["US"],
        language: "en"
      });
      const connectionId = randomUUID();
      plaidConnections.set(connectionId, connection);
      return sendJson(res, 200, { link_token: result.link_token, connectionId, expiration: result.expiration });
    }

    const connection = plaidConnections.get(String(body.connectionId || ""));
    if (!connection) throw new Error("Your Plaid setup has expired. Save your credentials and launch Plaid Link again.");

    if (url.pathname === "/api/plaid/exchange") {
      const publicToken = String(body.publicToken || "");
      if (!publicToken) throw new Error("Plaid did not return a public token. Please try connecting again.");
      const result = await plaidRequest(connection, "/item/public_token/exchange", { public_token: publicToken });
      connection.accessToken = result.access_token;
      connection.itemId = result.item_id;
      connection.institution = String(body.institution || "").trim();
      let persisted = true;
      try {
        persistPlaidConnections();
      } catch (error) {
        persisted = false;
        console.error("Plaid connection succeeded but secure persistence failed.");
      }
      return sendJson(res, 200, { itemId: result.item_id, persisted });
    }

    if (url.pathname === "/api/plaid/status") {
      return sendJson(res, 200, { connected: Boolean(connection.accessToken) });
    }

    if (url.pathname === "/api/plaid/sync") {
      if (!connection.accessToken) throw new Error("Connect a bank with Plaid Link before syncing.");
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
      const [accountResult, transactionResult] = await Promise.all([
        plaidRequest(connection, "/accounts/get", { access_token: connection.accessToken }),
        plaidRequest(connection, "/transactions/get", {
          access_token: connection.accessToken,
          start_date: startDate,
          end_date: endDate,
          options: { count: 500, offset: 0 }
        })
      ]);
      const transactions = [...(transactionResult.transactions || [])];
      const total = transactionResult.total_transactions || transactions.length;
      while (transactions.length < total) {
        const page = await plaidRequest(connection, "/transactions/get", {
          access_token: connection.accessToken,
          start_date: startDate,
          end_date: endDate,
          options: { count: 500, offset: transactions.length }
        });
        if (!page.transactions?.length) break;
        transactions.push(...page.transactions);
      }
      return sendJson(res, 200, {
        accounts: accountResult.accounts || [],
        transactions,
        institution: connection.institution || transactionResult.item?.institution_id || ""
      });
    }

    if (url.pathname === "/api/plaid/disconnect") {
      const connectionId = String(body.connectionId || "");
      const connection = plaidConnections.get(connectionId);
      plaidConnections.delete(connectionId);
      try {
        persistPlaidConnections();
      } catch (error) {
        if (connection) plaidConnections.set(connectionId, connection);
        throw new Error("Could not update the encrypted Plaid vault. The institution is still connected.");
      }
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "Unknown Plaid endpoint." });
  } catch (error) {
    const status = error.message?.includes("Enter your Plaid") || error.message?.startsWith("Choose") ? 400 : 502;
    return sendJson(res, status, publicError(error));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);

  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(content);
  });
});

restorePlaidConnections();
server.listen(PORT, "127.0.0.1", () => console.log(`Budget app available at http://localhost:${PORT}`));
