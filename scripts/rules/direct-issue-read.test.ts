import { describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	BODY_JQ_COMMAND,
	BODY_READ_API_COMMAND,
	BODY_READ_COMMAND,
	COMMENTED_READ_COMMAND,
	STATE_CHECK_COMMAND,
} from './delivered-rules-fixture'
import { direct_issue_read } from './direct-issue-read'

const { OWN } = vi.hoisted(() => ({ OWN: 'joshuafolkken/kit' }))

vi.mock('#scripts/issue/session-cite', () => ({
	session_cite: { session_repo: (): string => OWN },
}))

// joshuafolkken/kit#4663, #4703: a `gh api` or `gh issue view` read of one issue or its comments
// prints an untrusted author's text whole, where `pnpm josh issue:read` withholds it. The refused set
// is a read of the checkout's own `…/issues/<N>`, its comments or its timeline, under the placeholder
// or spelled out; the silent set is the josh reads, a projection that leaves the body out, writes,
// other endpoints and another repository named outright.

describe('direct_issue_read.is_direct_issue_read — refuses', () => {
	it.each([
		'gh api repos/joshuafolkken/kit/issues/4663/comments',
		'gh api repos/JoshuaFolkken/Kit/issues/4663',
		'gh api repos/{owner}/{repo}/issues/4663/timeline',
		'gh issue view 4663',
		'gh issue view 4663 --comments',
		'gh issue view 4663 --json body,comments',
		'gh issue view 4663 --json comments',
		'gh issue view 4663 --json=comments',
		'gh issue view 4663 --json=title,comments',
		"gh issue view 4663 --json 'title,comments'",
		'gh issue view 4663 --json "title,comments"',
		'gh issue view 4663 -R joshuafolkken/kit --comments',
		'gh issue view 4663 -R github.com/joshuafolkken/kit --comments',
		'gh --repo joshuafolkken/kit issue view 4663 --comments',
		'gh issue view https://github.com/joshuafolkken/kit/issues/4663 --comments',
		'gh issue view --json title,comments https://github.com/joshuafolkken/kit/issues/4663',
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
		"gh api repos/{owner}/{repo}/issues/4663/timeline --jq '.[].event'",
		'gh issue view 4663 --json state,labels',
		'gh issue view 4663 --repo joshuafolkken/other --comments',
		'gh issue view https://github.com/sveltejs/kit/issues/123 --comments',
		'gh issue view --json title,comments https://github.com/sveltejs/kit/issues/123',
		"gh issue view --jq '.title' --json title,comments https://github.com/sveltejs/kit/issues/123",
		'gh issue view 4663 --web',
		'gh issue view --help',
		'gh pr view 5 --comments',
		'gh api --help repos/{owner}/{repo}/issues/5',
		'echo "gh api repos/{owner}/{repo}/issues/4663"',
	])('is silent on %j', (command) => {
		expect(direct_issue_read.is_direct_issue_read(command)).toBe(false)
	})
})

// The `issue-comments` fixtures name another repository, so they reach that row and not this one.
describe('direct_issue_read.is_direct_issue_read — the issue-comments fixtures', () => {
	it.each([
		BODY_JQ_COMMAND,
		BODY_READ_API_COMMAND,
		BODY_READ_COMMAND,
		COMMENTED_READ_COMMAND,
		STATE_CHECK_COMMAND,
	])('leaves %j to the issue-comments row', (command) => {
		expect(direct_issue_read.is_direct_issue_read(command)).toBe(false)
	})
})

// joshuafolkken/kit#7330: a line that is only `gh issue view <N>` carries every argument `issue:read`
// takes, so it is rewritten to that command instead of refused.
const ISSUE = '4663'
const VIEW = `gh issue view ${ISSUE}`
const READ = `pnpm josh issue:read ${ISSUE}`
const READ_OWN = `${READ} --repo ${OWN}`
const DESCRIPTION = 'Read the issue'

describe('direct_issue_read.issue_read_command — rewrites a standalone view', () => {
	it.each([
		[VIEW, READ],
		[`  ${VIEW}  `, READ],
		[`${VIEW} --repo ${OWN}`, READ_OWN],
		[`${VIEW} -R ${OWN}`, READ_OWN],
		[`${VIEW} --repo=${OWN}`, READ_OWN],
		[`gh issue view --repo ${OWN} ${ISSUE}`, READ_OWN],
	])('rewrites %j to %j', (command, expected) => {
		expect(direct_issue_read.issue_read_command(command)).toBe(expected)
	})

	it.each([
		`${VIEW} | head`,
		`${VIEW} > /tmp/issue.md`,
		`${VIEW} && pnpm josh ms`,
		`${VIEW}\npnpm josh ms`,
		`${VIEW} --comments`,
		`${VIEW} --json body,comments`,
		`${VIEW} -R github.com/${OWN}`,
		`${VIEW} --repo ${OWN} --comments`,
		`${VIEW} 4664`,
		`gh issue view https://github.com/${OWN}/issues/${ISSUE}`,
		`gh --repo ${OWN} issue view ${ISSUE}`,
		`${VIEW} --web`,
		`${VIEW} --repo joshuafolkken/other`,
		`gh api repos/${OWN}/issues/${ISSUE}`,
		READ,
	])('leaves %j as it is', (command) => {
		expect(direct_issue_read.issue_read_command(command)).toBeUndefined()
	})
})

describe('direct_issue_read.ROW.rewrite — the call made right', () => {
	it('swaps the Bash command for issue:read and keeps the other input fields', () => {
		const input = { command: VIEW, description: DESCRIPTION }

		expect(direct_issue_read.ROW.rewrite({ name: 'Bash', input })).toEqual({
			command: READ,
			description: DESCRIPTION,
		})
	})

	it('leaves a non-Bash call alone', () => {
		expect(
			direct_issue_read.ROW.rewrite({ name: 'Read', input: { command: VIEW } }),
		).toBeUndefined()
	})

	// The rewrite is `issue:read` itself, whose untrusted-comment withholding is pinned in
	// `issue-read-trust.test.ts`: the rewritten line is the josh read the row keeps, and fires no more.
	it('lands on the read that withholds untrusted comments, which the row keeps', () => {
		const rewritten = direct_issue_read.ROW.rewrite({ name: 'Bash', input: { command: VIEW } })
		const call = { name: 'Bash', input: rewritten ?? {} }

		expect(direct_issue_read.ROW.keeps(call)).toBe(true)
		expect(direct_issue_read.ROW.is_trigger(call)).toBe(false)
		expect(direct_issue_read.ISSUE_READ_NOTE).toContain('withholds')
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
