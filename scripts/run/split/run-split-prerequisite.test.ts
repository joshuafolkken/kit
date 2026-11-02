import { git_stash } from '#scripts/git/stash/git-stash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_split_prerequisite } from './run-split-prerequisite'

// joshuafolkken/kit#5895: a prerequisite found mid-run as one command. The set-aside writes land in
// in-memory stand-ins — the stash stack, the Issue's comments and the hold — and every call is
// recorded in order, so each test pins which writes happened and in what order.

const state = vi.hoisted(() => ({
	stashes: [] as Array<string>,
	comments: [] as Array<string>,
	calls: [] as Array<string>,
}))

vi.mock('#scripts/git/stash/stash-push-cli', () => ({
	stash_push_cli: {
		set_aside: async ({ message }: { message: string }) => {
			state.calls.push('stash')
			state.stashes.push(`On 5895-lane: ${message}`)

			return 'stashed'
		},
	},
}))

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: {
		issue_list_comments: async () => JSON.stringify(state.comments.map((body) => ({ body }))),
	},
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_comment: async (_issue: string, body: string) => {
			state.calls.push('comment')
			state.comments.push(body)

			return 'https://github.com/o/r/issues/10#issuecomment-1'
		},
	},
}))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({
	run_hold_cli: {
		run: async () => {
			state.calls.push('release')

			return 0
		},
	},
}))

const tracking_with = vi.hoisted(() => vi.fn())
const record = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-blocked-by', () => ({ epic_blocked_by: { tracking_with, record } }))

const epic_create = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic', () => ({ epic_command: { create: epic_create } }))

const audit_run = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-audit-cli', () => ({ epic_audit_cli: { run: audit_run } }))

const park_apply = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-park', () => ({ issue_park: { apply: park_apply } }))

const TITLE = 'Prerequisite work'
const REQUEST = { issue: '10', prerequisite: '11', title: TITLE }
const NEEDS_DECISION = 'needs-decision'
const BLOCKED_BY = 'blocked-by'

beforeEach(() => {
	Object.assign(state, { stashes: [], comments: [], calls: [] })
	vi.spyOn(git_stash, 'list').mockImplementation(async () =>
		state.stashes.map((subject, index) => ({ selector: `stash@{${String(index)}}`, subject })),
	)
	tracking_with.mockReset().mockResolvedValue(undefined)
	record.mockReset().mockImplementation(async () => {
		state.calls.push(BLOCKED_BY)

		return 'recorded in epic #30'
	})
	epic_create.mockReset().mockImplementation(async () => {
		state.calls.push('epic')

		return { kind: 'created', epic: 30 }
	})
	audit_run.mockReset().mockImplementation(async () => {
		state.calls.push('audit')

		return 0
	})
	park_apply.mockReset().mockImplementation(async () => {
		state.calls.push('park')

		return { is_labelled: true, is_commented: true }
	})
})

describe('run_split_prerequisite.prerequisite — no epic tracks the issue', () => {
	it('creates an ordered epic the prerequisite heads, then records the relation inside it', async () => {
		const result = await run_split_prerequisite.prerequisite(REQUEST)

		expect(result).toMatchObject({ kind: 'epic', epic: 30 })
		expect(tracking_with).toHaveBeenCalledWith('10', ['11'])
		expect(epic_create).toHaveBeenCalledWith([TITLE, '11', '10', '--ordered'])
		expect(record).toHaveBeenCalledWith(REQUEST)
		expect(audit_run).toHaveBeenCalledWith(['30'])
		expect(state.calls).toStrictEqual(['stash', 'comment', 'epic', BLOCKED_BY, 'audit', 'release'])
		expect(state.stashes[0]).toContain('run:pause: #10 waits on #11')
	})

	it('refuses without `--title` before writing anything', async () => {
		const result = await run_split_prerequisite.prerequisite({ ...REQUEST, title: undefined })

		expect(result).toMatchObject({ kind: 'failed', step: 'title', done: [] })
		expect(state.calls).toStrictEqual([])
	})
})

describe('run_split_prerequisite.prerequisite — an epic already tracks the issue', () => {
	it('leaves the placement to the relation’s own `epic --add --before` and audits that epic', async () => {
		tracking_with.mockResolvedValue({ epic: 20, lists_children: false })

		const result = await run_split_prerequisite.prerequisite(REQUEST)

		expect(result).toMatchObject({ kind: 'epic', epic: 20 })
		expect(epic_create).not.toHaveBeenCalled()
		expect(audit_run).toHaveBeenCalledWith(['20'])
		expect(state.calls).toStrictEqual(['stash', 'comment', BLOCKED_BY, 'audit', 'release'])
	})

	it('fails the audit step, keeping the hold, when `epic:audit` finds errors', async () => {
		tracking_with.mockResolvedValue({ epic: 20, lists_children: true })
		audit_run.mockResolvedValue(1)

		const result = await run_split_prerequisite.prerequisite(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: 'audit' })
		expect(state.calls).not.toContain('release')
	})
})

describe('run_split_prerequisite.prerequisite — the listing cannot tell', () => {
	it('parks the issue with `needs-decision`, recording no relation and creating no epic', async () => {
		const reason = 'the epic listing was cut short'

		tracking_with.mockRejectedValue(new Error(reason))

		const result = await run_split_prerequisite.prerequisite(REQUEST)

		expect(result.kind).toBe(NEEDS_DECISION)
		expect(state.calls).toStrictEqual(['stash', 'comment', 'park', 'release'])
		expect(park_apply).toHaveBeenCalledWith('10', NEEDS_DECISION, expect.stringContaining(reason))
		expect(park_apply).toHaveBeenCalledWith(
			'10',
			NEEDS_DECISION,
			expect.stringContaining('`pnpm josh run:park 10 --clear`'),
		)
		expect(record).not.toHaveBeenCalled()
		expect(epic_create).not.toHaveBeenCalled()
	})
})
