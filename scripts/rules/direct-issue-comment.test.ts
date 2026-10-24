import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { direct_issue_comment } from './direct-issue-comment'

// joshuafolkken/kit#4221: a comment posted outside `pnpm josh issue:comment` carries no run marker, so
// the run reads it as a person's update and its review goes stale. The refused set is `gh issue
// comment` and a `gh api` write to one issue's comment collection; the silent set is the command
// itself, comment reads, and writes elsewhere. The checkout's repository is fixed to `OWN`
// (joshuafolkken/kit#4737: its `owner/repo` spelled out is the checkout's own repository too).

const OWN = { owner: 'joshuafolkken', repo: 'kit' }

function resolve_own(): typeof OWN {
	return OWN
}

describe('direct_issue_comment.is_direct_issue_comment — refuses', () => {
	it.each([
		'gh issue comment 4187 --body-file /tmp/body.md',
		'gh issue comment 4187 -b "x"',
		'env gh issue comment 4187 --body x',
		'gh api repos/{owner}/{repo}/issues/4187/comments -F body=@/tmp/body.md',
		'gh api repos/:owner/:repo/issues/4187/comments -f body=x',
		'gh api -X POST /repos/{owner}/{repo}/issues/4187/comments --input /tmp/c.json',
		'gh api https://api.github.com/repos/{owner}/{repo}/issues/4187/comments --field body=x',
		'gh api "repos/{owner}/{repo}/issues/$N/comments" --raw-field body=x',
		'pnpm josh stash:push "wip" && gh api repos/{owner}/{repo}/issues/5/comments -F body=@b.md',
		"bash -c 'cd x && gh issue comment 5 --body x'",
		'gh api repos/joshuafolkken/kit/issues/4709/comments -F body=@/tmp/x.md --jq .html_url',
		'gh api -X POST /repos/JoshuaFolkken/Kit/issues/5/comments --input /tmp/c.json',
	])('refuses %j', (command) => {
		expect(direct_issue_comment.is_direct_issue_comment(command, resolve_own)).toBe(true)
	})
})

describe('direct_issue_comment.is_direct_issue_comment — is silent on', () => {
	it.each([
		'pnpm josh issue:comment 4187 --body-file /tmp/body.md',
		"gh api repos/{owner}/{repo}/issues/4187/comments --jq '.[] | .body'",
		'gh api -X GET repos/o/r/issues/4187/comments -f per_page=100',
		'gh api repos/o/r/issues/4187/comments --paginate',
		'gh api -X PATCH repos/o/r/issues/4187 --field body=@/tmp/body.md',
		'gh api -X PATCH repos/{owner}/{repo}/issues/comments/123 -f body=x',
		'gh api repos/{owner}/{repo}/pulls/5/comments -f body=x',
		// Another repository named outright: `issue:comment` cannot post there.
		'gh api repos/joshuafolkken/other/issues/5/comments -F body=@b.md',
		'gh api repos/sveltejs/kit/issues/5/comments -F body=@b.md',
		// Reading the checkout's own comments with its owner spelled out.
		'gh api repos/joshuafolkken/kit/issues/4709/comments --paginate',
		'gh -R joshuafolkken/other issue comment 5 --body x',
		'gh issue comment 5 --repo=joshuafolkken/other --body x',
		'gh issue view 4187 --comments',
		'gh issue comment --help',
		'grep -E "x|gh issue comment|y" file',
		'echo "gh api repos/o/r/issues/5/comments -f body=x"',
	])('%j', (command) => {
		expect(direct_issue_comment.is_direct_issue_comment(command, resolve_own)).toBe(false)
	})

	it('an owner spelled out when the checkout repository cannot be read', () => {
		const command = 'gh api repos/joshuafolkken/kit/issues/5/comments -F body=@b.md'

		expect(direct_issue_comment.is_direct_issue_comment(command, () => undefined)).toBe(false)
	})
})

describe('direct-issue-comment delivery', () => {
	it('is a delivered row that points at pnpm josh issue:comment', () => {
		const row = delivered_rules.DELIVERED_RULES.find(
			(rule) => rule.id === direct_issue_comment.ROW.id,
		)

		expect(row?.reason).toBe(direct_issue_comment.DIRECT_ISSUE_COMMENT_REASON)
		expect(direct_issue_comment.DIRECT_ISSUE_COMMENT_REASON).toContain('`pnpm josh issue:comment')
	})

	it('claims the raw post before the body rows do', () => {
		const command = 'gh api repos/{owner}/{repo}/issues/5/comments -f body="$(cat b.md)"'
		const claiming = delivered_rules.DELIVERED_RULES.find((rule) =>
			rule.is_trigger({ name: 'Bash', input: { command } }),
		)

		expect(claiming?.id).toBe(direct_issue_comment.ROW.id)
	})

	// The real resolver, read from this kit checkout (`origin` is joshuafolkken/kit), so the default
	// `resolve_own` the guard runs with is pinned and not only an injected one.
	it("claims a write to the checkout's own repository spelled out", () => {
		const command = 'gh api repos/joshuafolkken/kit/issues/4709/comments -F body=@/tmp/x.md'
		const claiming = delivered_rules.DELIVERED_RULES.find((rule) =>
			rule.is_trigger({ name: 'Bash', input: { command } }),
		)

		expect(claiming?.id).toBe(direct_issue_comment.ROW.id)
	})
})
