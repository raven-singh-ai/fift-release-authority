# Release-authority governance

The repository is operated by one GitHub account, so GitHub human-review counts are not treated as independent security evidence.

Every authority change must satisfy all of these gates before merge:

1. Two independent Hermes review lanes inspect the same immutable pull-request head. Each review must finish with no Critical or High finding, and its complete transcript must be retained as immutable release evidence.
2. The repository test suite must pass against that exact head with a clean tracked worktree.
3. After merge, the exact protected-`main` authority head must verify a real FIFT Preview through `verify-vercel.yml`, including Vercel team, project, deployment, hostname, and candidate-SHA binding, and produce GitHub OIDC provenance. Each run publishes its parentless exact-tree proof under a distinct retained `evidence-vercel/<candidate>/run-<id>-attempt-<n>` ref before moving the legacy shared `evidence` ref, so concurrent releases cannot orphan one another. Downstream consumers authenticate the declared proof commit itself; the retained ref provides reachability, not mutable HEAD authority. Provider and publication credentials live only in the `production-authority` Environment, whose deployment policy permits protected branches only. Feature-branch workflow runs are never authority.
4. The pull request remains mandatory; stale reviews and tests are invalid after any pushed byte. A downstream release remains blocked until the merged protected-`main` run succeeds.
5. Protected `main` retains admin enforcement, linear history, conversation resolution, and force-push/deletion denial.

After merge, downstream consumers pin the exact protected-`main` workflow SHA and rerun their full exact-candidate release cycle. Feature-branch evidence is diagnostic and cannot authorize Production.
