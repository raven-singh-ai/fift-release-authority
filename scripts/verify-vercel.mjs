import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const exactSha = process.env.CANDIDATE_SHA ?? "";
const deploymentId = process.env.DEPLOYMENT_ID ?? "";
const expectedHostname = process.env.EXPECTED_HOSTNAME ?? "";
const token = process.env.VERCEL_TOKEN ?? "";
const teamId = "team_6AFb0Io4tNAZE5RQPtdLOEWv";

if (!/^[a-f0-9]{40}$/.test(exactSha)) throw new Error("candidate SHA must be exact");
if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) throw new Error("deployment ID is invalid");
if (!/^[a-z0-9-]+\.vercel\.app$/.test(expectedHostname)) throw new Error("hostname is invalid");
if (!token) throw new Error("VERCEL_TOKEN is unavailable");

const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${encodeURIComponent(teamId)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) throw new Error(`Vercel API rejected deployment readback: ${response.status}`);
const raw = await response.json();

if (raw?.id !== deploymentId
  || raw?.readyState !== "READY"
  || raw?.url !== expectedHostname
  || raw?.meta?.gitCommitSha !== exactSha) {
  throw new Error("Vercel provider metadata is not bound to the requested exact SHA");
}

const evidence = {
  schemaVersion: 1,
  authority: "raven-singh-ai/fift-release-authority",
  candidateSha: exactSha,
  deployment: {
    id: raw.id,
    readyState: raw.readyState,
    url: raw.url,
    meta: { gitCommitSha: raw.meta.gitCommitSha },
  },
  provenance: {
    repository: process.env.GITHUB_REPOSITORY,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    workflowSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  },
};

const outDir = resolve("out");
await mkdir(outDir, { recursive: true });
const outPath = resolve(outDir, `vercel-${exactSha}.json`);
await writeFile(outPath, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
console.log(`evidence_path=${outPath}`);
