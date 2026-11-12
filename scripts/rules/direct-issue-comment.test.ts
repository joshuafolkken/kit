import path from 'node:path'
import { hook_context } from '#scripts/hooks/hook-context'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { direct_issue_comment } from './direct-issue-comment'

// joshuafolkken/kit#4221: a comment posted outside `pnpm josh issue:comment` carries no run marker, so
// the run reads it as a person's update and its review goes stale. The refused set is `gh issue
// comment` and a `gh api` write to one issue's comment collection; the silent set is the command
// itself, comment reads, and writes elsewhere. The checkout's repository is fixed to `OWN`
// (joshuafolkken/kit#4737: its `owner/repo` spelled out is the checkout's own repository too).

const OWN = { owner: 'joshuafolkken', repo: 'kit' }
const OUTSIDE_REPOSITORY = temporary_directory('suite')('direct-issue-comment-')
const OWN_SPELLED_OUT_WRITE =
	'gh api repos/joshuafolkken/kit/issues/4709/comments -F body=@/tmp/x.md'

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

// joshuafolkken/kit#7330: a standalone body-file post maps exactly onto `issue:comment`, which reads the
// file as it is; an inline `--body` is trimmed and has `\n` expanded there, so it stays refused.
const CWD_CONTEXT = hook_context_fixture.of(OUTSIDE_REPOSITORY, process.env)
const ABSOLUTE_BODY = '/work/.josh/tmp/body.md'

describe('direct_issue_comment.issue_comment_command — rewrites a standalone body-file post', () => {
	it.each([
		[`gh issue comment 7 --body-file ${ABSOLUTE_BODY}`, ABSOLUTE_BODY],
		[`gh issue comment 7 -F ${ABSOLUTE_BODY}`, ABSOLUTE_BODY],
		[`gh issue comment --body-file=${ABSOLUTE_BODY} 7`, ABSOLUTE_BODY],
		[`  gh issue comment 7 --body-file ${ABSOLUTE_BODY}  `, ABSOLUTE_BODY],
		['gh issue comment 7 -F .josh/tmp/b.md', path.join(OUTSIDE_REPOSITORY, '.josh/tmp/b.md')],
	])('rewrites %j to read %j', (command, file) => {
		expect(direct_issue_comment.issue_comment_command(command, CWD_CONTEXT)).toBe(
			`pnpm josh issue:comment 7 --body-file ${file}`,
		)
	})

	it.each([
		'gh issue comment 7 --body x',
		'gh issue comment 7 -b x',
		'gh issue comment 7 --body-file -',
		`gh issue comment 7 --body-file ${ABSOLUTE_BODY} --edit-last`,
		`gh issue comment 7 --repo joshuafolkken/kit --body-file ${ABSOLUTE_BODY}`,
		`gh issue comment 7 8 --body-file ${ABSOLUTE_BODY}`,
		`gh issue comment 7 --body-file ${ABSOLUTE_BODY} && echo done`,
		`gh issue comment 7 --body-file "${ABSOLUTE_BODY}"`,
		'gh issue comment 7 --body-file $BODY',
		`cd x && gh issue comment 7 --body-file ${ABSOLUTE_BODY}`,
	])('leaves %j refused', (command) => {
		expect(direct_issue_comment.issue_comment_command(command, CWD_CONTEXT)).toBeUndefined()
	})
})

describe('direct_issue_comment.ROW.rewrite — the call made right', () => {
	it('rewrites the Bash input, keeping its other fields, and nothing else', () => {
		const command = `gh issue comment 7 -F ${ABSOLUTE_BODY}`
		const input = { command, description: 'Post' }
		const { rewrite } = direct_issue_comment.ROW

		expect(rewrite({ name: 'Bash', input }, () => '', CWD_CONTEXT)).toEqual({
			command: `pnpm josh issue:comment 7 --body-file ${ABSOLUTE_BODY}`,
			description: 'Post',
		})
		expect(rewrite({ name: 'Read', input }, () => '', CWD_CONTEXT)).toBeUndefined()
	})

	it('rewrites to a call the row keeps', () => {
		const command = `gh issue comment 7 -F ${ABSOLUTE_BODY}`
		const rewritten = direct_issue_comment.ROW.rewrite(
			{ name: 'Bash', input: { command } },
			() => '',
			CWD_CONTEXT,
		)
		const call = { name: 'Bash', input: rewritten }

		expect(direct_issue_comment.ROW.keeps(call)).toBe(true)
		expect(direct_issue_comment.ROW.is_trigger(call, CWD_CONTEXT)).toBe(false)
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
			rule.is_trigger({ name: 'Bash', input: { command } }, hook_context.from_process()),
		)

		expect(claiming?.id).toBe(direct_issue_comment.ROW.id)
	})

	// The real resolver, read from this kit checkout (`origin` is joshuafolkken/kit), so the default
	// `resolve_own` the guard runs with is pinned and not only an injected one.
	it("claims a write to the checkout's own repository spelled out", () => {
		const command = OWN_SPELLED_OUT_WRITE
		const claiming = delivered_rules.DELIVERED_RULES.find((rule) =>
			rule.is_trigger({ name: 'Bash', input: { command } }, hook_context.from_process()),
		)

		expect(claiming?.id).toBe(direct_issue_comment.ROW.id)
	})

	// joshuafolkken/kit#6973: the checkout is the hook call's cwd, not the process's — a cwd outside any
	// repository has no own repository, so the owner spelled out is not the checkout's.
	it("reads the checkout's repository under the call context's cwd", () => {
		const command = OWN_SPELLED_OUT_WRITE
		const context = hook_context_fixture.of(OUTSIDE_REPOSITORY, process.env)

		expect(direct_issue_comment.ROW.is_trigger({ name: 'Bash', input: { command } }, context)).toBe(
			false,
		)
	})
})
