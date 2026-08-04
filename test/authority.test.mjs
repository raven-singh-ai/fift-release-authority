import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
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

test("accepts GitHub-integration SHA fields and emits the canonical binding", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      const raw = validProviderPayload();
      delete raw.meta.gitCommitSha;
      raw.meta.githubCommitSha = candidateSha;
      raw.gitSource = { sha: candidateSha, ref: "feature", private: "drop-me" };
      return raw;
    },
  });
  await rm(resolve("out"), { recursive: true, force: true });
  await import(`../scripts/verify-vercel.mjs?github-integration=${Date.now()}`);
  const bytes = await readFile(resolve("out", `vercel-${candidateSha}.json`), "utf8");
  const evidence = JSON.parse(bytes);
  assert.deepEqual(evidence.deployment.meta, { gitCommitSha: candidateSha });
  assert.equal(bytes.includes("private"), false);
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
  ["conflicting GitHub SHA", (raw) => { raw.meta.githubCommitSha = "7".repeat(40); }],
  ["conflicting gitSource SHA", (raw) => { raw.gitSource = { sha: "7".repeat(40) }; }],
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

test("workflow is manual-only, pinned, and retains every parentless proof", async () => {
  const workflow = await readFile(resolve(".github/workflows/verify-vercel.yml"), "utf8");
  const publisher = await readFile(resolve("scripts/publish-vercel-evidence.sh"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request(?:_target)?:|\bpush:/);
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write\n  attestations: write/);
  assert.match(workflow, /environment: production-authority/);
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /token: \$\{\{ secrets\.AUTHORITY_GITHUB_TOKEN \}\}/);
  assert.match(workflow, /actions\/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be/);
  assert.match(workflow, /run: bash scripts\/publish-vercel-evidence\.sh/);
  assert.match(publisher, /git read-tree --empty/);
  assert.match(publisher, /git commit-tree "\$tree"/);
  assert.doesNotMatch(publisher, /git commit-tree[^\n]* -p /);
  assert.match(publisher, /refs\/heads\/evidence-vercel\/\$\{CANDIDATE_SHA\}\/run-\$\{GITHUB_RUN_ID\}-attempt-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(publisher, /git push origin "\$commit:\$retained_ref"/);
  assert.match(publisher, /--force-with-lease="\$legacy_ref:\$current"/);
  assert.match(publisher, /if \[\[ "\$\(git rev-parse FETCH_HEAD\)" != "\$current" \]\]; then\n    continue/);
  assert.match(publisher, /if git push --force-with-lease="\$legacy_ref:\$current"[^]*?finish\n    exit 0/);
  assert.doesNotMatch(publisher, /git push --force origin "\$commit:\$legacy_ref"/);
});

test("legacy publisher rejects run identities that overflow either arithmetic domain", () => {
  for (const [runId, attempt] of [
    ["9223372036854775808", "1"],
    ["1", "9007199254740992"],
  ]) {
    assert.throws(() => execFileSync("bash", [resolve("scripts/publish-vercel-evidence.sh")], {
      env: {
        ...process.env,
        CANDIDATE_SHA: "4".repeat(40),
        GITHUB_RUN_ID: runId,
        GITHUB_RUN_ATTEMPT: attempt,
      },
      stdio: "pipe",
    }));
  }
});

test("legacy compatibility ref cannot roll back when an older run finishes late", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fift-authority-race-"));
  const remote = resolve(root, "remote.git");
  const work = resolve(root, "work");
  const publisher = resolve("scripts/publish-vercel-evidence.sh");
  const run = (args, options = {}) => execFileSync("git", args, { cwd: work, encoding: "utf8", ...options }).trim();
  try {
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["init", work], { stdio: "ignore" });
    run(["config", "user.name", "test"]);
    run(["config", "user.email", "test@example.invalid"]);
    run(["remote", "add", "origin", remote]);

    const publish = async (sha, runId, attempt) => {
      await mkdir(resolve(work, "out"), { recursive: true });
      await writeFile(resolve(work, "out", `vercel-${sha}.json`), `${JSON.stringify({
        schemaVersion: 1,
        authority: "raven-singh-ai/fift-release-authority",
        candidateSha: sha,
        deployment: {
          id: `dpl_Run${runId}`,
          readyState: "READY",
          url: "fift-preview.vercel.app",
          team: { id: teamId, name: "Fift Studio", slug: "fift" },
          project: { id: projectId, name: "fift-trading-portal" },
          meta: { gitCommitSha: sha },
        },
        provenance: {
          repository: "raven-singh-ai/fift-release-authority",
          workflowRef: "raven-singh-ai/fift-release-authority/.github/workflows/verify-vercel.yml@refs/heads/main",
          workflowSha: "9".repeat(40),
          runId: String(runId),
          runAttempt: attempt,
        },
      })}\n`);
      execFileSync("bash", [publisher], {
        cwd: work,
        env: { ...process.env, CANDIDATE_SHA: sha, GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: String(attempt) },
        stdio: "pipe",
      });
    };

    const olderSha = "6".repeat(40);
    const newerSha = "7".repeat(40);
    await publish(newerSha, 200, 1);
    await publish(olderSha, 100, 1);

    run(["fetch", "--no-tags", "origin", "refs/heads/evidence"]);
    const finalProof = JSON.parse(run(["show", `FETCH_HEAD:vercel/${newerSha}.json`]));
    assert.equal(finalProof.provenance.runId, "200");
    assert.equal(run(["ls-remote", "--refs", "origin", `refs/heads/evidence-vercel/${newerSha}/run-200-attempt-1`]).length > 0, true);
    assert.equal(run(["ls-remote", "--refs", "origin", `refs/heads/evidence-vercel/${olderSha}/run-100-attempt-1`]).length > 0, true);

    await publish("5".repeat(40), 300, 2);
    run(["fetch", "--no-tags", "origin", "refs/heads/evidence"]);
    const advancedProof = JSON.parse(run(["show", `FETCH_HEAD:vercel/${"5".repeat(40)}.json`]));
    assert.equal(advancedProof.provenance.runId, "300");
    assert.equal(advancedProof.provenance.runAttempt, 2);

    const malformedSha = "3".repeat(40);
    const malformedFile = resolve(work, `malformed-${malformedSha}.json`);
    await writeFile(malformedFile, `${JSON.stringify({ provenance: { runId: "999", runAttempt: 1 } })}\n`);
    const malformedBlob = run(["hash-object", "-w", malformedFile]);
    const malformedIndex = resolve(root, "malformed.index");
    const indexEnv = { ...process.env, GIT_INDEX_FILE: malformedIndex };
    run(["read-tree", "--empty"], { env: indexEnv });
    run(["update-index", "--add", "--cacheinfo", `100644,${malformedBlob},vercel/${malformedSha}.json`], { env: indexEnv });
    const malformedTree = run(["write-tree"], { env: indexEnv });
    const identityEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    };
    const malformedCommit = run(["commit-tree", malformedTree], { env: identityEnv, input: "malformed\n" });
    run(["push", "--force", "origin", `${malformedCommit}:refs/heads/evidence`]);

    const rejectedSha = "2".repeat(40);
    await assert.rejects(publish(rejectedSha, 400, 1));
    assert.equal(run(["ls-remote", "--refs", "origin", "refs/heads/evidence"]).split("\t")[0], malformedCommit);
    assert.equal(run(["ls-remote", "--refs", "origin", `refs/heads/evidence-vercel/${rejectedSha}/run-400-attempt-1`]).length > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
