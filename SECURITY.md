# Release-authority governance

The repository is operated by one GitHub account, so GitHub human-review counts are not treated as independent security evidence.

Every authority change must satisfy all of these gates before merge:

1. Two independent Hermes review lanes inspect the same immutable pull-request head. Each review must finish with no Critical or High finding, and its complete transcript must be retained as immutable release evidence.
2. The repository test suite must pass against that exact head with a clean tracked worktree.
3. The exact authority head must successfully verify a real FIFT Preview through `verify-vercel.yml`, including Vercel team, project, deployment, hostname, and candidate-SHA binding, and produce GitHub OIDC provenance.
4. The pull request remains mandatory; stale reviews, tests, and evidence are invalid after any pushed byte.
5. Protected `main` retains admin enforcement, linear history, conversation resolution, and force-push/deletion denial.

After merge, downstream consumers pin the exact protected-`main` workflow SHA and rerun their full exact-candidate release cycle. Feature-branch evidence is diagnostic and cannot authorize Production.
