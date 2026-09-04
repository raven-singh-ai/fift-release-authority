# FIFT Release Authority

Minimal public trust plane for provider-authenticated FIFT release evidence.

- The protected default branch owns the only Vercel-verification workflow.
- Candidate repositories never receive `VERCEL_TOKEN`.
- Each successful dispatch emits a bounded provider projection and FIFT application-access proof without a FIFT session, wrapped in provenance metadata (schema version 3).
- GitHub Artifact Attestations bind the exact JSON bytes to this repository, workflow, ref, SHA and run.
- The identical bytes are published at a parentless `evidence` commit for deterministic CI retrieval.

No application source, customer data, provider secrets or full provider responses belong here.

## Application protection proof

After Vercel metadata binds the exact team, project, deployment hostname and
candidate SHA, the verifier uses a dedicated project-scoped Vercel automation
credential from the protected `production-authority` GitHub Environment, sent
only as `x-vercel-protection-bypass` to that exact HTTPS origin. Vercel deployment
protection stays enabled. Fetch credentials remain omitted; no FIFT bearer,
user session, cookie, or Vercel API token enters the application probe.
Redirects remain manual and caching disabled. `/login` must return bounded
HTML containing email/password inputs in one form; `/dashboard`, `/admin` and
`/accounts` must redirect to same-origin `/login`; the TradeQuo preflight and
mobile Partner rebate-summary endpoints must reject anonymous requests with401.
The public Landing `/` is intentionally not classified as a protected page.

The proof retains only closed status/boolean/path metadata, never HTML, cookies,
headers or credentials. It does not establish successful authenticated use,
all-route authorization, or device/session continuity. Existing Vercel identity
and GitHub provenance remain unchanged; the workflow still attests exact bytes.
Only reading the old shared evidence ref may explicitly permit schema1/2;
new publication requires schema3 and `fift-application-access.v2`, explicitly
declaring `gatewayAuthorization=vercel-automation`. The gateway credential is
never included in URLs, retained evidence, logs or returned error messages.
Provisioning this credential and installing it in the protected GitHub Environment
requires operator authorization separate from source preparation.
