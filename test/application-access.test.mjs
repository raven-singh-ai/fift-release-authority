import assert from "node:assert/strict";
import test from "node:test";
import { probeApplicationAccess, validApplicationAccess } from "../scripts/application-access.mjs";

const origin = "https://fift-preview.vercel.app";
const html = '<!doctype html><html><body><form action="/login"><input name="email" type="email"/><input type="password" name="password"/></form></body></html>';
function response(url, { status, headers, body = null, redirected = false, responseUrl = url }) {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, "url", { value: responseUrl });
  Object.defineProperty(result, "redirected", { value: redirected });
  return result;
}
function success(url) {
  const path = new URL(url).pathname;
  return path === "/login" ? response(url, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "not-a-session=never-forward" }, body: html })
    : path.startsWith("/api/") ? response(url, { status: 401 })
      : response(url, { status: 307, headers: { location: `/login?next=${encodeURIComponent(path)}` } });
}
const probe = (fetchImpl, options = {}) => probeApplicationAccess(origin, { fetchImpl, ...options });

test("proves the exact six paths anonymously and retains no bodies, cookies or credential headers", async () => {
  const requests = [];
  const result = await probe(async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Cache-Control"]);
    assert.equal(options.signal.aborted, false);
    requests.push(url);
    return success(url);
  });
  assert.deepEqual(requests, ["/login", "/dashboard", "/admin", "/accounts", "/api/cron/tradequo-source-preflight", "/api/mobile/partner/rebate-summary"].map(path => origin + path));
  assert.equal(validApplicationAccess(result, origin), true);
  assert.equal(result.credentialMode, "omit");
  assert.equal(JSON.stringify(result).includes("never-forward"), false);
  assert.equal(JSON.stringify(result).includes("<input"), false);
});

for (const value of ["", "http://fift-preview.vercel.app", `${origin}/`, `${origin}:443`, `${origin}/login`, `${origin}?x=1`, `${origin}#x`, "https://user:password@fift-preview.vercel.app", "https://fift-preview.vercel.app.evil.test", "https://localhost", "https://fift-preview.vercel.app\n", null]) {
  test(`rejects malformed origin ${JSON.stringify(value)} without any request`, async () => {
    let calls = 0;
    await assert.rejects(probeApplicationAccess(value, { fetchImpl: async () => { calls++; } }), /application_access_origin_invalid/);
    assert.equal(calls, 0);
  });
}
for (const status of [302, 303, 307, 308]) {
  test(`retains actual allowed redirect status ${status}`, async () => {
    const result = await probe(async url => url.endsWith("/admin") ? response(url, { status, headers: { location: `${origin}/login?next=%2Fadmin` } }) : success(url));
    assert.equal(result.pages[1].status, status);
    assert.equal(validApplicationAccess(result, origin), true);
  });
}
for (const location of [null, "https://evil.test/login", "//evil.test/login", "/api/auth/sso", "/login/", "https://person:secret@fift-preview.vercel.app/login", "/login#fragment", "/\\evil.test/login"]) {
  test(`rejects a non-login or external redirect ${JSON.stringify(location)}`, async () => {
    await assert.rejects(probe(async url => url.endsWith("/admin") ? response(url, { status: 307, headers: location === null ? {} : { location } }) : success(url)), /application_access_redirect_invalid/);
  });
}
for (const status of [200, 301, 401, 403, 500]) {
  test(`rejects protected page status ${status}`, async () => {
    await assert.rejects(probe(async url => url.endsWith("/dashboard") ? response(url, { status, headers: { location: "/login" } }) : success(url)), /application_access_redirect_invalid/);
  });
}
for (const path of ["/api/cron/tradequo-source-preflight", "/api/mobile/partner/rebate-summary"]) {
  for (const status of [200, 302, 403, 500]) {
    test(`requires 401 from ${path}, not ${status}`, async () => {
      await assert.rejects(probe(async url => url.endsWith(path) ? response(url, { status }) : success(url)), /application_access_endpoint_invalid/);
    });
  }
}
for (const body of ["", '<form><input name="email" type="email"></form>', '<form><input name="password" type="password"></form>',
  `<script>${html}</script>`, `<!--${html}-->`, `<template><template></template>${html}</template>`, `<textarea>${html}</textarea>`,
  '<form><input name="email" type="email"></form><form><input name="password" type="password"></form>',
  html.replace('type="password"', 'disabled type="password"'), html.replace('type="email"', 'type="email" type="text"')]) {
  test(`rejects missing/inert/ambiguous login fields #${body.length}-${body.slice(0, 18)}`, async () => {
    await assert.rejects(probe(async url => url.endsWith("/login") ? response(url, { status: 200, headers: { "content-type": "text/html" }, body }) : success(url)), /application_access_login_invalid/);
  });
}
for (const [label, override] of [
  ["non-HTML", { headers: { "content-type": "application/json" }, body: html }],
  ["login SSO", { status: 302, headers: { location: "https://vercel.com/sso" } }],
  ["login failure", { status: 500 }],
  ["declared oversize", { headers: { "content-type": "text/html", "content-length": "131073" }, body: html }],
  ["actual oversize", { body: html + " ".repeat(131073) }],
  ["wrong response origin", { responseUrl: "https://evil.test/login", body: html }],
  ["followed redirect", { redirected: true, body: html }],
]) {
  test(`rejects ${label}`, async () => {
    await assert.rejects(probe(async url => response(url, { status: 200, headers: { "content-type": "text/html" }, ...override })), /application_access_/);
  });
}
test("total deadline terminates a fetch that never settles, without forwarding its error", async () => {
  const start = Date.now();
  let signal;
  await assert.rejects(probe(async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, { timeoutMs: 15 }), /application_access_timeout/);
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - start < 1000);
  await assert.rejects(probe(async () => { throw new Error("private-cookie-value"); }), { message: "application_access_unavailable" });
});
test("total deadline also covers a stalled login body and cancels it", async () => {
  let cancelled = false;
  await assert.rejects(probe(async url => response(url, { status: 200, headers: { "content-type": "text/html" },
    body: new ReadableStream({ cancel() { cancelled = true; } }) }), { timeoutMs: 15 }), /application_access_timeout/);
  assert.equal(cancelled, true);
});
test("a fetch resolving after the deadline has its late body cancelled before any next request", async () => {
  let resolveFetch;
  let cancelled = false;
  let calls = 0;
  await assert.rejects(probe(async () => {
    calls++;
    return new Promise(resolve => { resolveFetch = resolve; });
  }, { timeoutMs: 15 }), /application_access_timeout/);
  resolveFetch(response(`${origin}/login`, { status: 200, headers: { "content-type": "text/html" },
    body: new ReadableStream({ cancel() { cancelled = true; } }) }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});
test("closed evidence validator rejects missing, reordered, forged or extra facts", async () => {
  const good = await probe(async url => success(url));
  const changes = [
    value => { value.credentialMode = "include"; }, value => { value.origin = "https://foreign.vercel.app"; },
    value => { value.cookie = "secret"; }, value => { value.login.passwordField = false; },
    value => { value.login.status = 302; }, value => { value.pages[0].path = "/"; },
    value => { value.pages[0].status = 200; }, value => { value.pages[0].loginPath = "https://evil.test/login"; },
    value => { value.pages.reverse(); }, value => { value.pages.push(value.pages[0]); },
    value => { value.endpoints[1].status = 500; }, value => { value.endpoints[1].path = "/api/cron/provider-source-inventory"; },
    value => { delete value.endpoints; }, value => { value.login.body = html; },
  ];
  for (const change of changes) {
    const bad = structuredClone(good); change(bad);
    assert.equal(validApplicationAccess(bad, origin), false);
  }
  assert.equal(validApplicationAccess(null, origin), false);
  assert.equal(validApplicationAccess(good, "https://evil.test"), false);
});
