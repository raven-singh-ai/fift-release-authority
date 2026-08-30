import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sha = "8".repeat(40);
const origin = "https://fift-preview.vercel.app";
function proof() {
  return { schemaVersion: 2, authority: "raven-singh-ai/fift-release-authority", candidateSha: sha,
    deployment: { id: "dpl_Trusted123", readyState: "READY", url: "fift-preview.vercel.app",
      team: { id: "team_6AFb0Io4tNAZE5RQPtdLOEWv", name: "Fift Studio", slug: "fift" },
      project: { id: "prj_B4vmVkQj1gVcSl6ezVfUfw9poWXr", name: "fift-trading-portal" }, meta: { gitCommitSha: sha } },
    applicationAccess: { contract: "fift-application-access.v1", origin, credentialMode: "omit",
      login: { path: "/login", status: 200, emailField: true, passwordField: true },
      pages: ["/dashboard", "/admin", "/accounts"].map(path => ({ path, status: 307, loginPath: "/login" })),
      endpoints: ["/api/cron/tradequo-source-preflight", "/api/mobile/partner/rebate-summary"].map(path => ({ path, status: 401 })) },
    provenance: { repository: "raven-singh-ai/fift-release-authority", workflowRef: "raven-singh-ai/fift-release-authority/.github/workflows/verify-vercel.yml@refs/heads/main",
      workflowSha: "9".repeat(40), runId: "12345", runAttempt: 1 } };
}
function validate(value, args = []) {
  return execFileSync("node", [resolve("scripts/validate-vercel-evidence.mjs"), sha, ...args], {
    input: `${JSON.stringify(value)}\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
}
test("new publication requires exact schema2/application proof and current run binding", () => {
  assert.equal(validate(proof(), ["12345", "1"]), "12345 1\n");
  assert.throws(() => validate(proof(), ["12346", "1"]));
  assert.throws(() => validate(proof(), ["12345", "2"]));
  const legacy = proof(); legacy.schemaVersion = 1; delete legacy.applicationAccess;
  assert.throws(() => validate(legacy));
  assert.throws(() => validate(legacy, ["12345", "1"]));
  assert.equal(validate(legacy, ["--allow-legacy"]), "12345 1\n");
  assert.equal(validate(proof(), ["--allow-legacy"]), "12345 1\n");
  assert.throws(() => validate(legacy, ["--unknown"]));
});
test("legacy read permission never bypasses new schema2 proof validation", () => {
  for (const mutate of [
    value => { value.applicationAccess.pages[0].status = 200; },
    value => { value.applicationAccess.endpoints[1].status = 500; },
    value => { value.applicationAccess.origin = "https://other.vercel.app"; },
    value => { value.applicationAccess.cookie = "must-not-appear"; },
    value => { value.provenance.runId = 12345; },
    value => { value.deployment.meta.gitCommitSha = "7".repeat(40); },
  ]) {
    const value = proof(); mutate(value);
    assert.throws(() => validate(value));
    assert.throws(() => validate(value, ["--allow-legacy"]));
  }
});
test("publisher permits legacy schema only while reading the existing shared-ref tuple", () => {
  const publisher = readFileSync(resolve("scripts/publish-vercel-evidence.sh"), "utf8");
  assert.match(publisher, /node "\$script_dir\/validate-vercel-evidence\.mjs" "\$CANDIDATE_SHA" "\$GITHUB_RUN_ID" "\$GITHUB_RUN_ATTEMPT" < "\$evidence"/);
  assert.equal(publisher.match(/--allow-legacy/g)?.length, 1);
  assert.match(publisher, /git show "\$current_commit:vercel\/\$path" \| node "\$script_dir\/validate-vercel-evidence\.mjs" "\$candidate" --allow-legacy/);
});
