// FIFT production release ceremony, executed inside the release-authority
// Actions context so the production token never leaves repo secrets.
// Steps: pin GIT_COMMIT_SHA (production env) to the release SHA → create a
// production deployment from the exact git SHA → poll READY → alias the
// production domains → verify the domain serves the new deployment.
// DRY_RUN=1 performs reads only and prints the plan.
const token = process.env.VERCEL_TOKEN;
const sha = process.env.CANDIDATE_SHA;
const dry = process.env.DEPLOYMENT_ID !== "release";
const teamId = "team_6AFb0Io4tNAZE5RQPtdLOEWv";
const projectId = "prj_B4vmVkQj1gVcSl6ezVfUfw9poWXr";
const DOMAINS = ["fift.studio", "www.fift.studio", "fift-trading-portal.vercel.app"];
if (!token) throw new Error("VERCEL_TOKEN missing");
if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("CANDIDATE_SHA must be 40 hex");
import * as fs from "node:fs";
fs.mkdirSync("out", { recursive: true });
const record = (payload) => fs.writeFileSync(`out/vercel-${sha}.json`, JSON.stringify({ kind: "fift-production-release-record", ...payload }, null, 2));

async function api(path, init = {}) {
  const url = `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${teamId}`;
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// 1. The env pin.
const envs = await api(`/v9/projects/${projectId}/env`);
const pin = (envs.envs ?? []).find((e) => e.key === "GIT_COMMIT_SHA" && (e.target ?? []).includes("production"));
if (!pin) throw new Error("GIT_COMMIT_SHA production env var not found");
console.log(`env pin: currently ${String(pin.value).slice(0, 12)}… -> ${sha.slice(0, 12)}…`);
if (!dry) {
  await api(`/v9/projects/${projectId}/env/${pin.id}`, { method: "PATCH", body: JSON.stringify({ value: sha }) });
  console.log("env pin updated");
}

// 2. Current production alias target, recorded for rollback.
for (const domain of DOMAINS) {
  try {
    const cfg = await api(`/v4/aliases/${domain}`);
    console.log(`alias ${domain}: currently -> ${cfg.deploymentId ?? cfg.deployment?.id ?? "unknown"}`);
  } catch (error) {
    console.log(`alias ${domain}: lookup: ${String(error).slice(0, 120)}`);
  }
}
if (dry) { record({ mode: "dry", sha, plannedDomains: DOMAINS }); console.log("[dry] stopping before deployment"); process.exit(0); }

// 3. Production deployment from the exact SHA.
const created = await api(`/v13/deployments?skipAutoDetectionConfirmation=1`, {
  method: "POST",
  body: JSON.stringify({
    name: "fift-trading-portal",
    project: projectId,
    target: "production",
    gitSource: { type: "github", org: "raven-singh-ai", repo: "fift-trading-portal", ref: sha },
  }),
});
console.log(`deployment created: ${created.id} (${created.url})`);

// 4. Poll READY (up to 15 min).
let state = created.readyState;
for (let i = 0; i < 90 && !["READY", "ERROR", "CANCELED"].includes(state); i++) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  state = (await api(`/v13/deployments/${created.id}`)).readyState;
  if (i % 6 === 0) console.log(`readyState: ${state}`);
}
if (state !== "READY") throw new Error(`deployment ended ${state}`);
console.log("deployment READY");

// 5. Verify the deployment is built from the exact SHA before any alias moves.
const meta = await api(`/v13/deployments/${created.id}`);
const builtSha = meta.gitSource?.sha ?? meta.meta?.githubCommitSha;
if (builtSha !== sha) throw new Error(`deployment sha mismatch: ${builtSha}`);

// 6. Alias the domains.
for (const domain of DOMAINS) {
  await api(`/v2/deployments/${created.id}/aliases`, { method: "POST", body: JSON.stringify({ alias: domain }) });
  console.log(`aliased ${domain}`);
}

// 7. Live verification: the domain must serve the new deployment id.
await new Promise((resolve) => setTimeout(resolve, 5_000));
const html = await (await fetch("https://fift.studio", { cache: "no-store" })).text();
const match = html.match(/data-dpl-id="([^"]+)"/);
console.log(`fift.studio serves: ${match?.[1] ?? "unknown"}; expected ${created.id}`);
if (match?.[1] !== created.id) throw new Error("domain does not serve the new deployment yet");
record({ mode: "release", sha, deploymentId: created.id, domains: DOMAINS, completedAt: new Date().toISOString() });
console.log(JSON.stringify({ release: "complete", sha, deploymentId: created.id, domains: DOMAINS }));
