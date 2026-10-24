const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const plaidConnections = new Map();
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
      return sendJson(res, 200, { itemId: result.item_id });
    }

    if (url.pathname === "/api/plaid/status") {
      return sendJson(res, 200, { connected: Boolean(connection.accessToken) });
    }

    if (url.pathname === "/api/plaid/sync") {
      if (!connection.accessToken) throw new Error("Connect a bank with Plaid Link before syncing.");
      const [accountResult, transactionResult] = await Promise.all([
        plaidRequest(connection, "/accounts/get", { access_token: connection.accessToken }),
        plaidRequest(connection, "/transactions/get", {
          access_token: connection.accessToken,
          start_date: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
          end_date: new Date().toISOString().slice(0, 10),
          options: { count: 500, offset: 0 }
        })
      ]);
      const transactions = [...(transactionResult.transactions || [])];
      const total = transactionResult.total_transactions || transactions.length;
      while (transactions.length < total) {
        const page = await plaidRequest(connection, "/transactions/get", {
          access_token: connection.accessToken,
          start_date: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
          end_date: new Date().toISOString().slice(0, 10),
          options: { count: 500, offset: transactions.length }
        });
        if (!page.transactions?.length) break;
        transactions.push(...page.transactions);
      }
      return sendJson(res, 200, {
        accounts: accountResult.accounts || [],
        transactions,
        institution: transactionResult.item?.institution_id || ""
      });
    }

    if (url.pathname === "/api/plaid/disconnect") {
      plaidConnections.delete(String(body.connectionId));
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

server.listen(PORT, "127.0.0.1", () => console.log(`Budget app available at http://localhost:${PORT}`));
