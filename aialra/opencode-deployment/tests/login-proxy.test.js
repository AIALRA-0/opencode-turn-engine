"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  BOOTSTRAP_SCRIPT_PATH,
  COOKIE_NAME,
  createServer,
  injectOpenCodeBootstrap,
  isValidSession,
  loginPage,
  makeSession,
  openCodeBootstrapScript,
} = require("../auth/login-proxy");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function proxyConfig(upstreamPort) {
  const username = "opencode";
  const password = "secret";
  return {
    host: "127.0.0.1",
    port: 0,
    upstreamHost: "127.0.0.1",
    upstreamPort,
    username,
    password,
    sessionSecret: "session-secret",
    secureCookie: false,
    upstreamAuthorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

function sessionCookie() {
  return `${COOKIE_NAME}=${makeSession("opencode", "session-secret")}`;
}

test("renders a form-based login page", () => {
  const html = loginPage({ next: "/abc" });
  assert.match(html, /<form method="post" action="\/login">/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /WWW-Authenticate/i);
});

test("validates signed session cookies", () => {
  const secret = "session-secret";
  const token = makeSession("opencode", secret);
  const req = { headers: { cookie: `${COOKIE_NAME}=${token}` } };

  assert.equal(isValidSession(req, "opencode", secret), true);
  assert.equal(isValidSession(req, "other", secret), false);
  assert.equal(isValidSession(req, "opencode", "wrong"), false);
});

test("injects the bootstrap script before the OpenCode module entry", () => {
  const html = [
    "<!doctype html>",
    "<html><head>",
    '<script type="module" crossorigin src="/assets/index.js"></script>',
    "</head><body></body></html>",
  ].join("");

  const injected = injectOpenCodeBootstrap(html);
  assert.match(injected, new RegExp(`<script src="${BOOTSTRAP_SCRIPT_PATH}"></script>`));
  assert.ok(injected.indexOf(BOOTSTRAP_SCRIPT_PATH) < injected.indexOf('type="module"'));
  assert.equal(injectOpenCodeBootstrap(injected), injected);
});

test("bootstrap seeds the public server and account logout UI", () => {
  const script = openCodeBootstrapScript();
  assert.ok(script.includes("opencode.global.dat:server"));
  assert.ok(script.includes("opencode.settings.dat:defaultServerUrl"));
  assert.ok(script.includes("账号设置"));
  assert.ok(script.includes('fetch("/logout", { method: "POST", credentials: "include" })'));
});

test("returns compact JSON when the upstream is unavailable", async () => {
  const proxy = createServer(proxyConfig(9));
  const port = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/config`, {
      headers: {
        accept: "application/json",
        cookie: sessionCookie(),
      },
    });
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-aialra-proxy-error"), "upstream_unavailable");
    assert.doesNotMatch(body, /<!DOCTYPE html/i);
    assert.match(body, /upstream_unavailable/);
  } finally {
    await close(proxy);
  }
});

test("retries idempotent API requests after an upstream socket reset", async () => {
  let requests = 0;
  const upstream = http.createServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = createServer(proxyConfig(upstreamPort));
  const proxyPort = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/config`, {
      headers: {
        accept: "application/json",
        cookie: sessionCookie(),
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(requests, 2);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
