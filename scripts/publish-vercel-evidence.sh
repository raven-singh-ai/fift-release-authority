#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

: "${CANDIDATE_SHA:?CANDIDATE_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"

if [[ ! "$CANDIDATE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "candidate SHA must be exact" >&2
  exit 1
fi
if [[ ! "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ || ! "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ ]]; then
  echo "run identity must be positive integers" >&2
  exit 1
fi
node -e '
  const maxRunId = 9223372036854775807n;
  const runId = BigInt(process.env.GITHUB_RUN_ID);
  const attempt = BigInt(process.env.GITHUB_RUN_ATTEMPT);
  if (runId > maxRunId || attempt > BigInt(Number.MAX_SAFE_INTEGER)) process.exit(1);
' || { echo "run identity exceeds supported integer range" >&2; exit 1; }

evidence="out/vercel-${CANDIDATE_SHA}.json"
evidence_path="vercel/${CANDIDATE_SHA}.json"
retained_ref="refs/heads/evidence-vercel/${CANDIDATE_SHA}/run-${GITHUB_RUN_ID}-attempt-${GITHUB_RUN_ATTEMPT}"
legacy_ref="refs/heads/evidence"

test -f "$evidence"
node "$script_dir/validate-vercel-evidence.mjs" "$CANDIDATE_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" < "$evidence" >/dev/null

blob="$(git hash-object -w "$evidence")"
index="$(mktemp)"
trap 'rm -f "$index"' EXIT
rm -f "$index"
export GIT_INDEX_FILE="$index"
git read-tree --empty
git update-index --add --cacheinfo "100644,$blob,$evidence_path"
tree="$(git write-tree)"
export GIT_AUTHOR_NAME='github-actions[bot]'
export GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
commit="$(printf 'Vercel authority evidence for %s\n' "$CANDIDATE_SHA" | git commit-tree "$tree")"

finish() {
  printf 'evidence_commit=%s\nretained_ref=%s\n' "$commit" "$retained_ref"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '### Evidence commit\n`%s`\n\n### Retained evidence ref\n`%s`\n' "$commit" "$retained_ref" >> "$GITHUB_STEP_SUMMARY"
  fi
}

# Durable publication comes first. Every run has a distinct ref, so another
# release can never orphan this parentless exact-tree proof.
git push origin "$commit:$retained_ref"
test "$(git ls-remote --refs origin "$retained_ref" | cut -f1)" = "$commit"

# Compatibility for the old portal: keep the shared ref monotonic by trusted
# GitHub run identity. A late older workflow may succeed, but may not roll the
# shared ref backward. force-with-lease closes the read/compare/write race.
read_run_tuple() {
  local current_commit="$1"
  local commit_line top path entry candidate
  commit_line="$(git rev-list --parents -n 1 "$current_commit")"
  [[ "$commit_line" = "$current_commit" ]]

  top="$(git ls-tree --name-only "$current_commit")"
  [[ "$top" = "vercel" ]]
  [[ "$(git cat-file -t "$current_commit:vercel")" = "tree" ]]

  path="$(git ls-tree --name-only "$current_commit:vercel")"
  test -n "$path"
  [[ "$path" != *$'\n'* ]]
  [[ "$path" =~ ^[a-f0-9]{40}\.json$ ]]
  entry="$(git ls-tree "$current_commit:vercel")"
  [[ "$entry" =~ ^100644\ blob\ [a-f0-9]{40}$'\t'[a-f0-9]{40}\.json$ ]]
  candidate="${path%.json}"

  git show "$current_commit:vercel/$path" | node "$script_dir/validate-vercel-evidence.mjs" "$candidate"
}

for _ in 1 2 3 4 5 6 7 8; do
  current="$(git ls-remote --refs origin "$legacy_ref" | cut -f1)"
  if [[ -z "$current" ]]; then
    if git push --force-with-lease="$legacy_ref:" origin "$commit:$legacy_ref"; then
      finish
      exit 0
    fi
    continue
  fi

  git fetch --no-tags origin "$legacy_ref" >/dev/null
  if [[ "$(git rev-parse FETCH_HEAD)" != "$current" ]]; then
    continue
  fi
  read -r current_run current_attempt < <(read_run_tuple "$current")

  if (( current_run > GITHUB_RUN_ID || (current_run == GITHUB_RUN_ID && current_attempt >= GITHUB_RUN_ATTEMPT) )); then
    printf 'legacy_evidence_ref_retained_newer=%s run=%s attempt=%s\n' "$current" "$current_run" "$current_attempt"
    finish
    exit 0
  fi

  if git push --force-with-lease="$legacy_ref:$current" origin "$commit:$legacy_ref"; then
    finish
    exit 0
  fi
done

echo "legacy evidence ref did not converge monotonically" >&2
exit 1
