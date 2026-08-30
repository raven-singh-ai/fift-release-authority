import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { probeApplicationAccess } from "./application-access.mjs";

const exactSha = process.env.CANDIDATE_SHA ?? "";
const deploymentId = process.env.DEPLOYMENT_ID ?? "";
const expectedHostname = process.env.EXPECTED_HOSTNAME ?? "";
const token = process.env.VERCEL_TOKEN ?? "";
const teamId = "team_6AFb0Io4tNAZE5RQPtdLOEWv";
const teamName = "Fift Studio";
const teamSlug = "fift";
const projectId = "prj_B4vmVkQj1gVcSl6ezVfUfw9poWXr";
const projectName = "fift-trading-portal";

if (!/^[a-f0-9]{40}$/.test(exactSha)) throw new Error("candidate SHA must be exact");
if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) throw new Error("deployment ID is invalid");
if (!/^[a-z0-9-]+\.vercel\.app$/.test(expectedHostname)) throw new Error("hostname is invalid");
if (!token) throw new Error("VERCEL_TOKEN is unavailable");

const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${encodeURIComponent(teamId)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) throw new Error(`Vercel API rejected deployment readback: ${response.status}`);
const raw = await response.json();

// Vercel names the commit binding differently depending on how the deployment
// was created, and the two shapes are disjoint:
//
//   CLI deploy          meta.gitCommitSha        (no gitSource)
//   GitHub integration  meta.githubCommitSha  +  gitSource.sha
//
// Reading only meta.gitCommitSha therefore rejected EVERY deployment the
// GitHub integration creates — which is every pull-request Preview — with
// "not bound to the requested exact SHA", no matter how correct the token and
// the SHA were. Only manually CLI-deployed builds could ever produce a receipt.
//
// So bind against every commit field the payload actually carries: require at
// least one, and require all present ones to agree. This is strictly stronger
// than the single-field check it replaces — a payload carrying two bindings
// must now have both correct, and a payload carrying none is rejected outright
// rather than silently compared against undefined.
const shaBindings = [raw?.meta?.gitCommitSha, raw?.meta?.githubCommitSha, raw?.gitSource?.sha]
  .filter((value) => typeof value === "string" && value.length > 0);

if (raw?.id !== deploymentId
  || raw?.readyState !== "READY"
  || raw?.url !== expectedHostname
  || raw?.ownerId !== teamId
  || raw?.team?.id !== teamId
  || raw?.team?.name !== teamName
  || raw?.team?.slug !== teamSlug
  || raw?.projectId !== projectId
  || raw?.project?.id !== projectId
  || raw?.project?.name !== projectName
  || shaBindings.length === 0
  || shaBindings.some((value) => value !== exactSha)) {
  throw new Error("Vercel provider metadata is not bound to the requested exact SHA");
}

// No provider token or cookie enters this probe. Run only after the exact
// deployment/team/project/SHA binding above, then attest the same bounded bytes.
const applicationAccess = await probeApplicationAccess(`https://${expectedHostname}`);
const evidence = {
  schemaVersion: 2,
  authority: "raven-singh-ai/fift-release-authority",
  candidateSha: exactSha,
  deployment: {
    id: raw.id,
    readyState: raw.readyState,
    url: raw.url,
    team: { id: raw.team.id, name: raw.team.name, slug: raw.team.slug },
    project: { id: raw.projectId, name: raw.project.name },
    // Canonicalize provider-specific bindings into the bounded field consumed
    // by the portal. Every present provider field was required above to equal
    // exactSha, so this cannot conceal disagreement.
    meta: { gitCommitSha: exactSha },
  },
  applicationAccess,
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
