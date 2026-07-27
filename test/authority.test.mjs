import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const candidateSha = "8".repeat(40);
const deploymentId = "dpl_Trusted123";
const hostname = "fift-preview.vercel.app";

process.env.CANDIDATE_SHA = candidateSha;
process.env.DEPLOYMENT_ID = deploymentId;
process.env.EXPECTED_HOSTNAME = hostname;
process.env.VERCEL_TOKEN = "unit-secret";
process.env.GITHUB_REPOSITORY = "raven-singh-ai/fift-release-authority";
process.env.GITHUB_WORKFLOW_REF = "raven-singh-ai/fift-release-authority/.github/workflows/verify-vercel.yml@refs/heads/main";
process.env.GITHUB_SHA = "9".repeat(40);
process.env.GITHUB_RUN_ID = "12345";
process.env.GITHUB_RUN_ATTEMPT = "1";

globalThis.fetch = async (url, options) => {
  assert.equal(url, `https://api.vercel.com/v13/deployments/${deploymentId}`);
  assert.equal(options.headers.Authorization, "Bearer unit-secret");
  return {
    ok: true,
    async json() {
      return {
        id: deploymentId,
        readyState: "READY",
        url: hostname,
        meta: { gitCommitSha: candidateSha, privateProviderValue: "drop-me" },
        env: { SECRET: "drop-me" },
        project: { private: "drop-me" },
      };
    },
  };
};

test("projects only bounded provider fields into attested evidence", async () => {
  await rm(resolve("out"), { recursive: true, force: true });
  await import(`../scripts/verify-vercel.mjs?test=${Date.now()}`);
  const bytes = await readFile(resolve("out", `vercel-${candidateSha}.json`), "utf8");
  const evidence = JSON.parse(bytes);
  assert.deepEqual(Object.keys(evidence).sort(), ["authority", "candidateSha", "deployment", "provenance", "schemaVersion"]);
  assert.deepEqual(evidence.deployment, {
    id: deploymentId,
    readyState: "READY",
    url: hostname,
    meta: { gitCommitSha: candidateSha },
  });
  assert.equal(bytes.includes("unit-secret"), false);
  assert.equal(bytes.includes("drop-me"), false);
});

test("workflow is manual-only, pinned, and publishes a parentless tree", async () => {
  const workflow = await readFile(resolve(".github/workflows/verify-vercel.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request(?:_target)?:|\bpush:/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /actions\/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be/);
  assert.match(workflow, /git read-tree --empty/);
  assert.match(workflow, /git commit-tree "\$tree"/);
  assert.doesNotMatch(workflow, /git commit-tree[^\n]* -p /);
});
