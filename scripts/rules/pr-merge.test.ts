import { describe, expect, it } from 'vitest'
import { pr_merge } from './pr-merge'

// joshuafolkken/kit#4038: a PR merged by the agent's own `Bash` call in a spelling the
// `gh pr merge*` / `gh api *pulls/*/merge*` globs miss. The silent set is the authorized route,
// which merges inside its own process, and the ordinary reads beside it.

const FOLLOWUP = 'pnpm josh followup'

describe('pr_merge.is_pr_merge — refuses a direct merge', () => {
	it.each([
		'gh pr merge 5 --squash',
		'gh -R o/r pr merge 5',
		'env gh pr merge --auto 5',
		'curl -X PUT -H "Authorization: token $T" https://api.github.com/repos/o/r/pulls/5/merge',
		'gh api -X PUT repos/o/r/pulls/5/merge',
		'gh api graphql -F query=@merge.graphql',
		'gh api -X POST graphql --input body.json',
		"gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
		"gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
		'curl -d @body.json https://api.github.com/graphql',
		'curl -d@body.json https://api.github.com/graphql',
		'gh api /graphql --input body.json',
		'gh api https://api.github.com/graphql -F query=@merge.graphql',
		'true | gh pr merge 5',
		'x & /usr/local/bin/gh pr merge 5',
	])('refuses %j', (command) => {
		expect(pr_merge.is_pr_merge(command)).toBe(true)
	})
})

describe('pr_merge.is_pr_merge — leaves the authorized route and the reads alone', () => {
	it.each([
		FOLLOWUP,
		'pnpm josh followup --merge 2>&1 | tail -20',
		'pnpm josh observations:flush',
		'gh api repos/o/r/pulls/5',
		"gh api graphql -f query='{ viewer { login } }'",
		'gh pr view 5',
		'grep -rn mergePullRequest scripts',
		'git merge origin/main',
	])('is silent on %j', (command) => {
		expect(pr_merge.is_pr_merge(command)).toBe(false)
	})
})

describe('pr_merge.PR_MERGE_REASON', () => {
	it('points at pnpm josh followup', () => {
		expect(pr_merge.PR_MERGE_REASON).toContain(FOLLOWUP)
	})
})
