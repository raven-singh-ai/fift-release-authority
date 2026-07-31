import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const candidateSha = "8".repeat(40);
const deploymentId = "dpl_Trusted123";
const hostname = "fift-preview.vercel.app";
const teamId = "team_6AFb0Io4tNAZE5RQPtdLOEWv";
const projectId = "prj_B4vmVkQj1gVcSl6ezVfUfw9poWXr";

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
  assert.equal(
    url,
    `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=team_6AFb0Io4tNAZE5RQPtdLOEWv`,
  );
  assert.equal(options.headers.Authorization, "Bearer unit-secret");
  return {
    ok: true,
    async json() {
      return {
        id: deploymentId,
        readyState: "READY",
        url: hostname,
        ownerId: teamId,
        team: { id: teamId, name: "Fift Studio", slug: "fift", private: "drop-me" },
        projectId,
        project: { id: projectId, name: "fift-trading-portal", private: "drop-me" },
        meta: { gitCommitSha: candidateSha, privateProviderValue: "drop-me" },
        env: { SECRET: "drop-me" },
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
    team: { id: teamId, name: "Fift Studio", slug: "fift" },
    project: { id: projectId, name: "fift-trading-portal" },
    meta: { gitCommitSha: candidateSha },
  });
  assert.equal(bytes.includes("unit-secret"), false);
  assert.equal(bytes.includes("drop-me"), false);
});

function validProviderPayload() {
  return {
    id: deploymentId,
    readyState: "READY",
    url: hostname,
    ownerId: teamId,
    team: { id: teamId, name: "Fift Studio", slug: "fift" },
    projectId,
    project: { id: projectId, name: "fift-trading-portal" },
    meta: { gitCommitSha: candidateSha },
  };
}

const hostileProviderMutations = [
  ["wrong deployment ID", (raw) => { raw.id = "dpl_Wrong"; }],
  ["wrong readiness", (raw) => { raw.readyState = "BUILDING"; }],
  ["wrong hostname", (raw) => { raw.url = "lookalike.vercel.app"; }],
  ["wrong owner team", (raw) => { raw.ownerId = "team_WRONG"; }],
  ["wrong nested team ID", (raw) => { raw.team.id = "team_WRONG"; }],
  ["wrong team name", (raw) => { raw.team.name = "Lookalike"; }],
  ["wrong team slug", (raw) => { raw.team.slug = "lookalike"; }],
  ["wrong root project ID", (raw) => { raw.projectId = "prj_WRONG"; }],
  ["wrong nested project ID", (raw) => { raw.project.id = "prj_WRONG"; }],
  ["wrong project name", (raw) => { raw.project.name = "lookalike"; }],
  ["wrong candidate SHA", (raw) => { raw.meta.gitCommitSha = "7".repeat(40); }],
  ["missing team metadata", (raw) => { delete raw.team; }],
  ["missing project metadata", (raw) => { delete raw.project; }],
  ["missing Git metadata", (raw) => { delete raw.meta; }],
];

for (const [label, mutate] of hostileProviderMutations) {
  test(`rejects provider metadata with ${label}`, async () => {
    const raw = validProviderPayload();
    mutate(raw);
    globalThis.fetch = async () => ({ ok: true, async json() { return raw; } });
    await rm(resolve("out"), { recursive: true, force: true });
    await assert.rejects(
      import(`../scripts/verify-vercel.mjs?hostile=${encodeURIComponent(label)}-${Date.now()}`),
      /not bound to the requested exact SHA/,
    );
    await assert.rejects(access(resolve("out", `vercel-${candidateSha}.json`)), { code: "ENOENT" });
  });
}

for (const [label, fetchResult, error] of [
  ["non-OK provider response", { ok: false, status: 403, async json() { return {}; } }, /rejected deployment readback: 403/],
  ["null provider JSON", { ok: true, async json() { return null; } }, /not bound to the requested exact SHA/],
  ["malformed provider JSON", { ok: true, async json() { throw new SyntaxError("malformed JSON"); } }, /malformed JSON/],
]) {
  test(`rejects ${label} with zero evidence write`, async () => {
    globalThis.fetch = async () => fetchResult;
    await rm(resolve("out"), { recursive: true, force: true });
    await assert.rejects(
      import(`../scripts/verify-vercel.mjs?response=${encodeURIComponent(label)}-${Date.now()}`),
      error,
    );
    await assert.rejects(access(resolve("out", `vercel-${candidateSha}.json`)), { code: "ENOENT" });
  });
}

test("workflow is manual-only, pinned, and publishes a parentless tree", async () => {
  const workflow = await readFile(resolve(".github/workflows/verify-vercel.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request(?:_target)?:|\bpush:/);
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write\n  attestations: write/);
  assert.match(workflow, /environment: production-authority/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /token: \$\{\{ secrets\.AUTHORITY_GITHUB_TOKEN \}\}/);
  assert.match(workflow, /actions\/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be/);
  assert.match(workflow, /git read-tree --empty/);
  assert.match(workflow, /git commit-tree "\$tree"/);
  assert.doesNotMatch(workflow, /git commit-tree[^\n]* -p /);
});
