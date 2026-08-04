#!/usr/bin/env node

const [candidateSha, expectedRunId = "", expectedRunAttempt = ""] = process.argv.slice(2);
const authority = "raven-singh-ai/fift-release-authority";
const workflowRef = `${authority}/.github/workflows/verify-vercel.yml@refs/heads/main`;
const maxRunId = 9223372036854775807n;

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
}
function fail() {
  process.exit(1);
}

if (!/^[a-f0-9]{40}$/.test(candidateSha)) fail();
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  let proof;
  try {
    proof = JSON.parse(body);
  } catch {
    fail();
  }

  if (`${JSON.stringify(proof)}\n` !== body
    || !exactKeys(proof, ["schemaVersion", "authority", "candidateSha", "deployment", "provenance"])
    || proof.schemaVersion !== 1
    || proof.authority !== authority
    || proof.candidateSha !== candidateSha
    || !exactKeys(proof.deployment, ["id", "readyState", "url", "team", "project", "meta"])
    || !/^dpl_[A-Za-z0-9]+$/.test(proof.deployment.id)
    || proof.deployment.readyState !== "READY"
    || !/^[a-z0-9-]+\.vercel\.app$/.test(proof.deployment.url)
    || !exactKeys(proof.deployment.team, ["id", "name", "slug"])
    || proof.deployment.team.id !== "team_6AFb0Io4tNAZE5RQPtdLOEWv"
    || proof.deployment.team.name !== "Fift Studio"
    || proof.deployment.team.slug !== "fift"
    || !exactKeys(proof.deployment.project, ["id", "name"])
    || proof.deployment.project.id !== "prj_B4vmVkQj1gVcSl6ezVfUfw9poWXr"
    || proof.deployment.project.name !== "fift-trading-portal"
    || !exactKeys(proof.deployment.meta, ["gitCommitSha"])
    || proof.deployment.meta.gitCommitSha !== candidateSha
    || !exactKeys(proof.provenance, ["repository", "workflowRef", "workflowSha", "runId", "runAttempt"])
    || proof.provenance.repository !== authority
    || proof.provenance.workflowRef !== workflowRef
    || !/^[a-f0-9]{40}$/.test(proof.provenance.workflowSha)
    || typeof proof.provenance.runId !== "string"
    || !/^[1-9][0-9]*$/.test(proof.provenance.runId)
    || BigInt(proof.provenance.runId) > maxRunId
    || !Number.isSafeInteger(proof.provenance.runAttempt)
    || proof.provenance.runAttempt < 1
    || (expectedRunId && String(proof.provenance.runId) !== expectedRunId)
    || (expectedRunAttempt && String(proof.provenance.runAttempt) !== expectedRunAttempt)) {
    fail();
  }

  process.stdout.write(`${proof.provenance.runId} ${proof.provenance.runAttempt}\n`);
});
