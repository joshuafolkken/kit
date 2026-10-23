import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { direct_issue_read } from './direct-issue-read'

// joshuafolkken/kit#4663: a `gh api` read of one issue or its comments prints an untrusted author's
// text whole, where `pnpm josh issue:read` withholds it. The refused set is a GET of the checkout's
// own `…/issues/<N>` or `…/issues/<N>/comments`; the silent set is the josh reads, a projection that
// leaves the body out, writes, other endpoints and another repository named outright.

describe('direct_issue_read.is_direct_issue_read — refuses', () => {
	it.each([
		'gh api repos/{owner}/{repo}/issues/4663',
		'gh api repos/{owner}/{repo}/issues/4663/comments',
		'gh api repos/:owner/:repo/issues/4663/comments --paginate',
		'gh api /repos/{owner}/{repo}/issues/4663/',
		'gh api https://api.github.com/repos/{owner}/{repo}/issues/4663',
		'gh api "repos/{owner}/{repo}/issues/$N/comments"',
		'gh api repos/{owner}/{repo}/issues/4663/comments?per_page=100',
		'gh api -X GET repos/{owner}/{repo}/issues/4663/comments -f per_page=100',
		"gh api repos/{owner}/{repo}/issues/4663 --jq '.body'",
		"gh api repos/{owner}/{repo}/issues/4663/comments --jq '.[] | .body'",
		'gh api repos/{owner}/{repo}/issues/4663 --jq .',
		"gh api repos/{owner}/{repo}/issues/4663/comments --jq '.[]'",
		'pnpm josh ms && gh api repos/{owner}/{repo}/issues/4663',
	])('refuses %j', (command) => {
		expect(direct_issue_read.is_direct_issue_read(command)).toBe(true)
	})
})

describe('direct_issue_read.is_direct_issue_read — is silent on', () => {
	it.each([
		'pnpm josh issue:read 4663',
		"gh api repos/{owner}/{repo}/issues/4663 --jq '{state, labels}'",
		'gh api repos/{owner}/{repo}/issues/4663 --jq .state',
		'gh api -X PATCH repos/{owner}/{repo}/issues/4663 -f title=x',
		'gh api repos/{owner}/{repo}/issues/4663/comments -F body=@/tmp/b.md',
		'gh api repos/{owner}/{repo}/issues/4663/labels',
		'gh api repos/{owner}/{repo}/issues/comments/123',
		'gh api repos/{owner}/{repo}/issues',
		'gh api repos/{owner}/{repo}/pulls/5/comments',
		'gh api repos/joshuafolkken/other/issues/5/comments',
		'gh api --help repos/{owner}/{repo}/issues/5',
		'echo "gh api repos/{owner}/{repo}/issues/4663"',
	])('is silent on %j', (command) => {
		expect(direct_issue_read.is_direct_issue_read(command)).toBe(false)
	})
})

describe('direct-issue-read — its place among the delivered rules', () => {
	it('is registered ahead of issue-comments, whose rewrite would add the unfiltered comments', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((row) => row.id)

		expect(ids.indexOf('direct-issue-read')).toBeLessThan(ids.indexOf('issue-comments'))
	})

	it('points the refusal at issue:read', () => {
		expect(direct_issue_read.DIRECT_ISSUE_READ_REASON).toContain('pnpm josh issue:read <N>')
	})
})
