"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BOOTSTRAP_SCRIPT_PATH,
  COOKIE_NAME,
  injectOpenCodeBootstrap,
  isValidSession,
  loginPage,
  makeSession,
  openCodeBootstrapScript,
} = require("../auth/login-proxy");

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
