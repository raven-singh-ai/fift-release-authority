# FIFT Release Authority

Minimal public trust plane for provider-authenticated FIFT release evidence.

- The protected default branch owns the only Vercel-verification workflow.
- Candidate repositories never receive `VERCEL_TOKEN`.
- Each successful dispatch emits a bounded four-field provider projection wrapped in provenance metadata.
- GitHub Artifact Attestations bind the exact JSON bytes to this repository, workflow, ref, SHA and run.
- The identical bytes are published at a parentless `evidence` commit for deterministic CI retrieval.

No application source, customer data, provider secrets or full provider responses belong here.
