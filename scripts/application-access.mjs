// Anonymous application-boundary evidence only. Never retain response bodies,
// cookies or provider credentials. Deployment identity is the caller's gate.
const MAX_LOGIN_BYTES = 128 * 1024;
const REDIRECTS = new Set([302, 303, 307, 308]);
const PAGE_PATHS = ["/dashboard", "/admin", "/accounts"];
const ENDPOINT_PATHS = ["/api/cron/tradequo-source-preflight", "/api/mobile/partner/rebate-summary"];
class AccessFailure extends Error {}
const fail = (code) => { throw new AccessFailure(`application_access_${code}`); };

function exactOrigin(value) {
  if (typeof value !== "string" || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(value)) fail("origin_invalid");
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.port || url.search || url.hash) fail("origin_invalid");
  return value;
}

const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);

export function validApplicationAccess(value, origin) {
  try {
    exactOrigin(origin);
    return exactKeys(value, ["contract", "origin", "credentialMode", "login", "pages", "endpoints"])
      && value.contract === "fift-application-access.v1" && value.origin === origin && value.credentialMode === "omit"
      && exactKeys(value.login, ["path", "status", "emailField", "passwordField"])
      && value.login.path === "/login" && value.login.status === 200 && value.login.emailField === true && value.login.passwordField === true
      && Array.isArray(value.pages) && value.pages.length === PAGE_PATHS.length
      && value.pages.every((row, index) => exactKeys(row, ["path", "status", "loginPath"])
        && row.path === PAGE_PATHS[index] && REDIRECTS.has(row.status) && row.loginPath === "/login")
      && Array.isArray(value.endpoints) && value.endpoints.length === ENDPOINT_PATHS.length
      && value.endpoints.every((row, index) => exactKeys(row, ["path", "status"])
        && row.path === ENDPOINT_PATHS[index] && row.status === 401);
  } catch { return false; }
}

// Small bounded HTML tokenizer, not a renderer. Ignore comments/raw-text and
// inert template content; require email/password input markup in one
// form. A script string containing fake input markup is not login evidence.
function hasLoginFields(html) {
  const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const rawText = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);
  let templateDepth = 0;
  let fields = null;
  let match;
  while ((match = token.exec(html))) {
    if (!match[1]) continue;
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (!closing && rawText.has(name)) {
      if (name === "plaintext") break;
      const end = new RegExp(`</${name}\\s*>`, "gi");
      end.lastIndex = token.lastIndex;
      const found = end.exec(html);
      if (!found) break;
      token.lastIndex = end.lastIndex;
      continue;
    }
    if (name === "template") { templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1)); continue; }
    if (templateDepth) continue;
    if (name === "form") {
      if (closing) { if (fields?.email && fields.password) return true; fields = null; }
      else { if (fields !== null) fail("login_invalid"); fields = { email: false, password: false }; }
    }
    if (name !== "input" || closing || !fields) continue;
    const attributes = new Map();
    const attr = /([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const source = match[0].slice(6, -1);
    let attribute;
    while ((attribute = attr.exec(source))) {
      const key = attribute[1].toLowerCase();
      if (attributes.has(key)) fail("login_invalid");
      attributes.set(key, attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    if (attributes.has("disabled") || attributes.has("hidden")) continue;
    const type = attributes.get("type")?.toLowerCase();
    if (type === "email" && attributes.get("name") === "email") fields.email = true;
    if (type === "password" && attributes.get("name") === "password") fields.password = true;
  }
  return false;
}

function discard(response) { void response.body?.cancel().catch(() => {}); }
async function loginBody(response, signal) {
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) fail("login_invalid");
  const size = response.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_LOGIN_BYTES)) fail("login_too_large");
  if (!response.body) fail("login_invalid");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_LOGIN_BYTES) fail("login_too_large");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
  } finally { signal.removeEventListener("abort", cancel); cancel(); }
}

export async function probeApplicationAccess(origin, { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  exactOrigin(origin);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) fail("deadline_invalid");
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new AccessFailure("application_access_timeout")); }, timeoutMs);
  });
  const request = async (path) => {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(origin + path, {
      method: "GET", credentials: "omit", redirect: "manual", cache: "no-store", signal: controller.signal,
      headers: { Accept: path.startsWith("/api/") ? "application/json" : "text/html", "Cache-Control": "no-store" },
    });
    if (controller.signal.aborted) { discard(response); controller.signal.throwIfAborted(); }
    if (response.redirected || response.url !== origin + path) { discard(response); fail("response_origin_invalid"); }
    return response;
  };
  const work = async () => {
    const loginResponse = await request("/login");
    let loginValid;
    try {
      if (loginResponse.status !== 200 || loginResponse.headers.has("location")) fail("login_invalid");
      loginValid = hasLoginFields(await loginBody(loginResponse, controller.signal));
    } finally { if (!loginResponse.body?.locked) discard(loginResponse); }
    if (!loginValid) fail("login_invalid");
    const pages = [];
    for (const path of PAGE_PATHS) {
      const response = await request(path);
      try {
        const location = response.headers.get("location");
        if (!REDIRECTS.has(response.status) || !location || /[\u0000-\u0020\u007f\\]/.test(location)) fail("redirect_invalid");
        const target = new URL(location, origin + path);
        if (target.origin !== origin || target.pathname !== "/login" || target.username || target.password || target.hash) fail("redirect_invalid");
        pages.push({ path, status: response.status, loginPath: "/login" });
      } finally { discard(response); }
    }
    const endpoints = [];
    for (const path of ENDPOINT_PATHS) {
      const response = await request(path);
      try {
        if (response.status !== 401 || response.headers.has("location")) fail("endpoint_invalid");
        endpoints.push({ path, status: response.status });
      } finally { discard(response); }
    }
    controller.signal.throwIfAborted();
    return { contract: "fift-application-access.v1", origin, credentialMode: "omit",
      login: { path: "/login", status: 200, emailField: true, passwordField: true }, pages, endpoints };
  };
  try { return await Promise.race([work(), deadline]); }
  catch (error) { throw error instanceof AccessFailure ? error : new AccessFailure("application_access_unavailable"); }
  finally { clearTimeout(timer); controller.abort(); }
}
