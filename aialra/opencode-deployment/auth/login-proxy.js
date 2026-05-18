#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const { URL } = require("node:url");

const COOKIE_NAME = "aialra_opencode_session";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const BOOTSTRAP_SCRIPT_PATH = "/__aialra/opencode-bootstrap.js";
const PUBLIC_UI_PATHS = new Set([
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/favicon-96x96-v3.png",
  "/favicon-v3.ico",
  "/favicon-v3.svg",
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/apple-touch-icon-v3.png",
]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function base64urlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function makeSession(username, secret) {
  const payload = base64urlJson({
    u: username,
    exp: Date.now() + SESSION_TTL_MS,
    n: crypto.randomBytes(16).toString("base64url"),
  });
  return `${payload}.${sign(payload, secret)}`;
}

function parseCookies(header = "") {
  const cookies = new Map();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      cookies.set(key, value);
    }
  }
  return cookies;
}

function isValidSession(req, expectedUsername, secret) {
  const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
  if (!token) {
    return false;
  }
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }
  if (!timingSafeEqualString(signature, sign(payload, secret))) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.u === expectedUsername && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function setCookieHeader(token, secure) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function wantsHtml(req) {
  const accept = req.headers.accept || "";
  return req.method === "GET" && (accept.includes("text/html") || accept.includes("*/*"));
}

function loginPage({ error = "", next = "/" } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenCode Login</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f8;
      --panel: #ffffff;
      --text: #111111;
      --muted: #666666;
      --border: #d9d9d9;
      --focus: #111111;
      --error: #b42318;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101112;
        --panel: #171819;
        --text: #f5f5f5;
        --muted: #a3a3a3;
        --border: #303235;
        --focus: #f5f5f5;
        --error: #ff8a80;
      }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(100%, 380px);
      padding: 28px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 18px 55px rgba(0, 0, 0, 0.08);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 720;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 22px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }
    label {
      display: block;
      margin: 14px 0 7px;
      color: var(--text);
      font-size: 13px;
      font-weight: 650;
    }
    input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0 12px;
      background: transparent;
      color: var(--text);
      font: inherit;
      outline: none;
    }
    input:focus {
      border-color: var(--focus);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus) 18%, transparent);
    }
    button {
      width: 100%;
      height: 44px;
      margin-top: 20px;
      border: 0;
      border-radius: 6px;
      background: var(--text);
      color: var(--panel);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .error {
      margin: 0 0 14px;
      color: var(--error);
      font-size: 13px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <main>
    <h1>OpenCode</h1>
    <p>登录后进入 Web 工作台.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}" />
      <label for="username">用户名</label>
      <input id="username" name="username" autocomplete="username" required autofocus />
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, {
    location,
    "cache-control": "no-store",
    ...headers,
  });
  res.end();
}

function sendLogin(res, options, status = 200) {
  const body = loginPage(options);
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function openCodeBootstrapScript() {
  return `"use strict";
(() => {
  const origin = window.location.origin;
  const serverStorageKey = "opencode.global.dat:server";
  const defaultServerKey = "opencode.settings.dat:defaultServerUrl";
  const accountSectionId = "aialra-opencode-account-settings";
  const styleId = "aialra-opencode-account-style";

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      return;
    }
  }

  function serverUrl(item) {
    if (!item) return "";
    if (typeof item === "string") return item;
    if (typeof item.url === "string") return item.url;
    if (item.http && typeof item.http.url === "string") return item.http.url;
    return "";
  }

  function normalizeUrl(value) {
    try {
      return new URL(value || "", origin).origin;
    } catch {
      return "";
    }
  }

  function isBrokenLocalhost(value) {
    const normalized = normalizeUrl(value);
    return normalized === "http://localhost:4096" || normalized === "http://127.0.0.1:4096";
  }

  function seedCurrentServer() {
    const current = {
      type: "http",
      displayName: "OpenCode Web",
      http: { url: origin },
    };
    const state = readJson(serverStorageKey, { list: [], projects: {}, lastProject: {} });
    const list = Array.isArray(state.list) ? state.list : [];
    const nextList = [
      current,
      ...list.filter((item) => {
        const url = serverUrl(item);
        return normalizeUrl(url) !== origin && !isBrokenLocalhost(url);
      }),
    ];
    writeJson(serverStorageKey, {
      ...state,
      list: nextList,
      projects: state.projects && typeof state.projects === "object" ? state.projects : {},
      lastProject: state.lastProject && typeof state.lastProject === "object" ? state.lastProject : {},
    });
    try {
      localStorage.setItem(defaultServerKey, origin);
    } catch {
      return;
    }
  }

  function ensureStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = [
      "#" + accountSectionId + " .aialra-logout-button{white-space:nowrap}",
    ].join("\\n");
    document.head.appendChild(style);
  }

  function hasClasses(el, names) {
    return names.every((name) => el.classList.contains(name));
  }

  function text(el) {
    return (el.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function findGeneralSettingsRoot() {
    const headings = Array.from(document.querySelectorAll("h2"));
    const general = headings.find((item) => /^(General|通用|一般|設定|设置)$/.test(text(item)));
    if (!general) return null;
    let root = general.parentElement;
    while (root && root !== document.body) {
      if (root.classList.contains("overflow-y-auto") && root.querySelector("[data-action='settings-language']")) {
        return root;
      }
      root = root.parentElement;
    }
    return null;
  }

  function findSectionContainer(root) {
    return Array.from(root.querySelectorAll("div")).find((item) =>
      hasClasses(item, ["flex", "flex-col", "gap-8", "w-full"]),
    );
  }

  function makeAccountSection() {
    const section = document.createElement("section");
    section.id = accountSectionId;
    section.className = "flex flex-col gap-1";
    section.innerHTML =
      '<h3 class="text-14-medium text-text-strong pb-2">账号设置</h3>' +
      '<div class="bg-surface-base px-4 rounded-lg">' +
      '<div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">' +
      '<div class="flex min-w-0 flex-1 flex-col gap-0.5">' +
      '<span class="text-14-medium text-text-strong">登录状态</span>' +
      '<span class="text-12-regular text-text-weak">退出后会回到 OpenCode 登录页面。</span>' +
      '</div>' +
      '<div class="flex w-full justify-end sm:w-auto sm:shrink-0">' +
      '<button type="button" class="aialra-logout-button" data-component="button" data-size="large" data-variant="ghost" data-aialra-action="logout">退出登录</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    section.querySelector("[data-aialra-action='logout']")?.addEventListener("click", async () => {
      try {
        await fetch("/logout", { method: "POST", credentials: "include" });
      } finally {
        window.location.assign("/login");
      }
    });
    return section;
  }

  function injectAccountSettings() {
    const root = findGeneralSettingsRoot();
    if (!root || root.querySelector("#" + accountSectionId)) return;
    const container = findSectionContainer(root);
    if (!container) return;
    ensureStyle();
    container.appendChild(makeAccountSection());
  }

  seedCurrentServer();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectAccountSettings, { once: true });
  } else {
    injectAccountSettings();
  }
  new MutationObserver(injectAccountSettings).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
`;
}

function injectOpenCodeBootstrap(html) {
  if (html.includes(BOOTSTRAP_SCRIPT_PATH)) {
    return html;
  }

  const tag = `    <script src="${BOOTSTRAP_SCRIPT_PATH}"></script>\n`;
  const moduleScript = html.match(/\s*<script\b[^>]*\btype=["']module["'][^>]*><\/script>\s*/i);
  if (moduleScript?.index !== undefined) {
    return `${html.slice(0, moduleScript.index)}${tag}${html.slice(moduleScript.index)}`;
  }
  const headEnd = html.search(/<\/head>/i);
  if (headEnd !== -1) {
    return `${html.slice(0, headEnd)}${tag}${html.slice(headEnd)}`;
  }
  return html;
}

function patchContentSecurityPolicy(value) {
  if (!value) return value;

  const directives = new Map();
  for (const raw of String(value).split(";")) {
    const directive = raw.trim();
    if (!directive) continue;
    const [name, ...parts] = directive.split(/\s+/);
    if (!name) continue;
    directives.set(name.toLowerCase(), parts);
  }

  const addToken = (name, token) => {
    const key = name.toLowerCase();
    const parts = directives.get(key) || [];
    if (!parts.includes(token)) {
      parts.push(token);
    }
    directives.set(key, parts);
  };

  // OpenCode's terminal renderer fetches an embedded Ghostty WASM data URL.
  // The upstream CSP's `connect-src *` does not allow `data:` in browsers.
  addToken("connect-src", "data:");
  addToken("connect-src", "blob:");
  addToken("script-src", "https://static.cloudflareinsights.com");
  addToken("worker-src", "'self'");
  addToken("worker-src", "blob:");
  addToken("child-src", "'self'");
  addToken("child-src", "blob:");
  addToken("script-src", "'sha256-QI23YWMJrD/tljM6/82tpL8EwqdBoptwZfycFHA9IiQ='");

  return Array.from(directives.entries())
    .map(([name, parts]) => [name, ...parts].join(" "))
    .join("; ");
}

function sendUnauthenticated(req, res) {
  if (wantsHtml(req)) {
    const next = req.url && req.url.startsWith("/") ? req.url : "/";
    sendLogin(res, { next }, 200);
    return;
  }
  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: "login_required" }));
}

function upstreamAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function handleLogin(req, res, config) {
  const body = await readBody(req);
  const form = new URLSearchParams(body.toString("utf8"));
  const username = form.get("username") || "";
  const password = form.get("password") || "";
  const next = form.get("next") || "/";

  const valid =
    timingSafeEqualString(username, config.username) &&
    timingSafeEqualString(password, config.password);

  if (!valid) {
    sendLogin(res, { error: "用户名或密码不正确.", next }, 401);
    return;
  }

  const token = makeSession(config.username, config.sessionSecret);
  redirect(res, next.startsWith("/") ? next : "/", {
    "set-cookie": setCookieHeader(token, config.secureCookie),
  });
}

function proxyRequest(req, res, config) {
  const headers = { ...req.headers };
  headers.host = `${config.upstreamHost}:${config.upstreamPort}`;
  headers.authorization = config.upstreamAuthorization;
  delete headers["accept-encoding"];

  const upstream = http.request(
    {
      host: config.upstreamHost,
      port: config.upstreamPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders["www-authenticate"];
      const contentType = String(upstreamRes.headers["content-type"] || "");
      const shouldInject =
        req.method === "GET" &&
        (upstreamRes.statusCode || 0) >= 200 &&
        (upstreamRes.statusCode || 0) < 300 &&
        contentType.toLowerCase().includes("text/html");

      if (!shouldInject) {
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        upstreamRes.pipe(res);
        return;
      }

      const chunks = [];
      let size = 0;
      upstreamRes.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_HTML_BYTES) {
          upstream.destroy(new Error("HTML response too large"));
          return;
        }
        chunks.push(chunk);
      });
      upstreamRes.on("end", () => {
        const body = injectOpenCodeBootstrap(Buffer.concat(chunks).toString("utf8"));
        delete responseHeaders["content-length"];
        responseHeaders["content-length"] = Buffer.byteLength(body);
        if (responseHeaders["content-security-policy"]) {
          responseHeaders["content-security-policy"] = patchContentSecurityPolicy(
            responseHeaders["content-security-policy"],
          );
        }
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        res.end(body);
      });
    },
  );

  upstream.on("error", (error) => {
    const body = `OpenCode upstream unavailable: ${error.message}`;
    res.writeHead(502, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  });

  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, config) {
  if (!isValidSession(req, config.username, config.sessionSecret)) {
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: 26\r\n\r\n{\"error\":\"login_required\"}",
    );
    socket.destroy();
    return;
  }

  const closeQuietly = (stream) => {
    if (stream && !stream.destroyed) {
      stream.destroy();
    }
  };
  const upstream = net.connect(config.upstreamPort, config.upstreamHost, () => {
    const headers = { ...req.headers };
    headers.host = `${config.upstreamHost}:${config.upstreamPort}`;
    headers.authorization = config.upstreamAuthorization;

    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`${key}: ${item}`);
        }
      } else if (value != null) {
        lines.push(`${key}: ${value}`);
      }
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => {
    closeQuietly(socket);
  });
  upstream.on("close", () => {
    closeQuietly(socket);
  });
  socket.on("error", () => {
    closeQuietly(upstream);
  });
  socket.on("close", () => {
    closeQuietly(upstream);
  });
}

function createServer(config) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, service: "opencode-login-proxy" }));
        return;
      }
      if (req.method === "GET" && url.pathname === BOOTSTRAP_SCRIPT_PATH) {
        const body = openCodeBootstrapScript();
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
        });
        res.end(body);
        return;
      }
      if (req.method === "GET" && PUBLIC_UI_PATHS.has(url.pathname)) {
        proxyRequest(req, res, config);
        return;
      }
      if (req.method === "GET" && url.pathname === "/login") {
        sendLogin(res, { next: url.searchParams.get("next") || "/" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/login") {
        await handleLogin(req, res, config);
        return;
      }
      if (req.method === "POST" && url.pathname === "/logout") {
        redirect(res, "/login", { "set-cookie": clearCookieHeader() });
        return;
      }

      if (!isValidSession(req, config.username, config.sessionSecret)) {
        sendUnauthenticated(req, res);
        return;
      }

      proxyRequest(req, res, config);
    } catch (error) {
      const status = error.status || 500;
      const body = status === 413 ? "Request body too large" : "OpenCode login proxy error";
      res.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    }
  });

  server.on("upgrade", (req, socket, head) => proxyUpgrade(req, socket, head, config));
  return server;
}

function loadConfig(env = process.env) {
  const username = requiredEnv("OPENCODE_SERVER_USERNAME");
  const password = requiredEnv("OPENCODE_SERVER_PASSWORD");
  return {
    host: env.OPENCODE_LOGIN_PROXY_HOST || "127.0.0.1",
    port: Number(env.OPENCODE_LOGIN_PROXY_PORT || "12603"),
    upstreamHost: env.OPENCODE_UPSTREAM_HOST || env.OPENCODE_SERVER_HOST || "127.0.0.1",
    upstreamPort: Number(env.OPENCODE_UPSTREAM_PORT || env.OPENCODE_SERVER_PORT || "12601"),
    username,
    password,
    sessionSecret: env.OPENCODE_LOGIN_SESSION_SECRET || password,
    secureCookie: env.OPENCODE_LOGIN_SECURE_COOKIE !== "0",
    upstreamAuthorization: upstreamAuthHeader(username, password),
  };
}

if (require.main === module) {
  const config = loadConfig();
  createServer(config).listen(config.port, config.host, () => {
    console.log(`OpenCode login proxy listening on http://${config.host}:${config.port}`);
  });
}

module.exports = {
  BOOTSTRAP_SCRIPT_PATH,
  COOKIE_NAME,
  createServer,
  injectOpenCodeBootstrap,
  isValidSession,
  loadConfig,
  loginPage,
  makeSession,
  openCodeBootstrapScript,
};
