# FIFT Release Authority

Minimal public trust plane for provider-authenticated FIFT release evidence.

- The protected default branch owns the only Vercel-verification workflow.
- Candidate repositories never receive `VERCEL_TOKEN`.
- Each successful dispatch emits a bounded provider projection and anonymous FIFT application-access proof wrapped in provenance metadata (schema version 2).
- GitHub Artifact Attestations bind the exact JSON bytes to this repository, workflow, ref, SHA and run.
- The identical bytes are published at a parentless `evidence` commit for deterministic CI retrieval.

No application source, customer data, provider secrets or full provider responses belong here.

## Application protection proof

After Vercel metadata binds the exact team, project, deployment hostname and
candidate SHA, the existing verifier probes that hostname with credentials
omitted, redirects manual and caching disabled. `/login` must return bounded
HTML containing email/password inputs in one form; `/dashboard`, `/admin` and
`/accounts` must redirect to same-origin `/login`; the TradeQuo preflight and
mobile Partner rebate-summary endpoints must reject anonymous requests with401.
The public Landing `/` is intentionally not classified as a protected page.

The proof retains only closed status/boolean/path metadata, never HTML, cookies,
headers or credentials. It does not establish successful authenticated use,
all-route authorization, or device/session continuity. Existing Vercel identity
and GitHub provenance remain unchanged; the workflow still attests exact bytes.
Only reading the old shared evidence ref may explicitly permit schema1;
new publication requires schema2 and valid application-access evidence.
