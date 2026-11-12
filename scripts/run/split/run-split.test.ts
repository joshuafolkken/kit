import { git_stash } from '#scripts/git/stash/git-stash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_split } from './run-split'

// joshuafolkken/kit#5846: a split found mid-run as one command. The set-aside writes land in
// in-memory stand-ins — the stash stack, the Issue's comments and the hold — and every call is
// recorded in order, so each test pins which writes happened and in what order.

const state = vi.hoisted(() => ({
	stashes: [] as Array<string>,
	comments: [] as Array<string>,
	calls: [] as Array<string>,
	is_lane: false,
}))

vi.mock('#scripts/run/pause/run-set-aside-commit', () => ({
	run_set_aside_commit: {
		is_lane: async () => state.is_lane,
		message_of: (message: string) => `wip: ${message}`,
		is_committed: async () => state.calls.includes('commit'),
		commit: async () => {
			state.calls.push('commit')

			return 'committed'
		},
	},
}))

vi.mock('#scripts/git/stash/stash-push-cli', () => ({
	stash_push_cli: {
		set_aside: async ({ message }: { message: string }) => {
			state.calls.push('stash')
			state.stashes.push(`On 5846-lane: ${message}`)

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

vi.mock('#scripts/epic/epic-blocked-by', () => ({ epic_blocked_by: { tracking_with } }))

const epic_run = vi.hoisted(() => vi.fn())
const epic_create = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic', () => ({ epic_command: { run: epic_run, create: epic_create } }))

const audit_run = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-audit-cli', () => ({ epic_audit_cli: { run: audit_run } }))

const park_apply = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-park', () => ({ issue_park: { apply: park_apply } }))

const TITLE = 'Split work'
const CHILDREN = ['11', '12']
const INDEPENDENT = { issue: '10', children: CHILDREN, is_ordered: false, title: TITLE }
const ORDERED = { ...INDEPENDENT, is_ordered: true }
const NEEDS_DECISION = 'needs-decision'
const SET_ASIDE_AND_PLACE = ['stash', 'comment', 'epic', 'audit', 'release']
const TRACKED = { epic: 20, lists_children: false }

beforeEach(() => {
	Object.assign(state, { stashes: [], comments: [], calls: [], is_lane: false })
	vi.spyOn(git_stash, 'list').mockImplementation(async () =>
		state.stashes.map((subject, index) => ({ selector: `stash@{${String(index)}}`, subject })),
	)
	tracking_with.mockReset().mockResolvedValue(undefined)
	epic_run.mockReset().mockImplementation(async () => {
		state.calls.push('epic')

		return 0
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

describe('run_split.split — an epic already tracks the issue', () => {
	it('adds the children to it through `epic --add` and audits it', async () => {
		tracking_with.mockResolvedValue(TRACKED)

		const result = await run_split.split(INDEPENDENT)

		expect(result).toMatchObject({ kind: 'epic', epic: 20 })
		expect(epic_run).toHaveBeenCalledWith(['--add', '20', '11', '12'])
		expect(audit_run).toHaveBeenCalledWith(['20'])
		expect(state.calls).toStrictEqual(SET_ASIDE_AND_PLACE)
	})

	it('chains an ordered split after the issue with `--after`', async () => {
		tracking_with.mockResolvedValue(TRACKED)

		await run_split.split(ORDERED)

		expect(epic_run).toHaveBeenCalledWith(['--add', '20', '11', '12', '--after', '10'])
	})
})

describe('run_split.split — no epic tracks the issue', () => {
	it('creates an epic the issue heads and audits it', async () => {
		const result = await run_split.split(INDEPENDENT)

		expect(result).toMatchObject({ kind: 'epic', epic: 30 })
		expect(epic_create).toHaveBeenCalledWith([TITLE, '10', '11', '12'])
		expect(audit_run).toHaveBeenCalledWith(['30'])
		expect(state.calls).toStrictEqual(SET_ASIDE_AND_PLACE)
		expect(state.comments[0]).toContain('#10 continues beside #11, #12')
	})

	it('creates an ordered epic with `--ordered`', async () => {
		await run_split.split(ORDERED)

		expect(epic_create).toHaveBeenCalledWith([TITLE, '10', '11', '12', '--ordered'])
	})

	it('refuses without `--title` before writing anything', async () => {
		const result = await run_split.split({ ...INDEPENDENT, title: undefined })

		expect(result).toMatchObject({ kind: 'failed', step: 'title', done: [] })
		expect(state.calls).toStrictEqual([])
	})
})

describe('run_split.split — on the lane branch', () => {
	it('stashes a split the children take over, never a WIP commit that strands the lane', async () => {
		state.is_lane = true

		await run_split.split(INDEPENDENT)

		expect(state.calls).toStrictEqual(SET_ASIDE_AND_PLACE)
		expect(state.comments[0]).toContain('stash:pop')
	})

	it('commits a parked split, which resumes on its own lane', async () => {
		state.is_lane = true
		tracking_with.mockRejectedValue(new Error('cut short'))

		await run_split.split(INDEPENDENT)

		expect(state.calls).toStrictEqual(['commit', 'comment', 'park', 'release'])
		expect(state.comments[0]).toContain('pnpm josh main:merge')
	})
})

describe('run_split.split — the listing cannot tell', () => {
	it('parks the issue with `needs-decision` instead of placing the children', async () => {
		const reason = 'the epic listing was cut short'

		tracking_with.mockRejectedValue(new Error(reason))

		const result = await run_split.split(INDEPENDENT)

		expect(result.kind).toBe(NEEDS_DECISION)
		expect(state.calls).toStrictEqual(['stash', 'comment', 'park', 'release'])
		expect(park_apply).toHaveBeenCalledWith('10', NEEDS_DECISION, expect.stringContaining(reason))
		expect(epic_run).not.toHaveBeenCalled()
		expect(epic_create).not.toHaveBeenCalled()
	})

	it('fails the park step, keeping the hold, when the label is not applied', async () => {
		tracking_with.mockRejectedValue(new Error('down'))
		park_apply.mockResolvedValue({ is_labelled: false, is_commented: false })

		const result = await run_split.split(INDEPENDENT)

		expect(result).toMatchObject({ kind: 'failed', step: 'park' })
		expect(state.calls).not.toContain('release')
	})
})

describe('run_split.split — a failing step keeps the hold', () => {
	it('fails the place step when `epic --add` refuses', async () => {
		tracking_with.mockResolvedValue(TRACKED)
		epic_run.mockResolvedValue(1)

		const result = await run_split.split(INDEPENDENT)

		expect(result).toMatchObject({ kind: 'failed', step: 'place' })
		expect(result.done.map(({ step }) => step)).toStrictEqual(['set-aside', 'comment'])
		expect(audit_run).not.toHaveBeenCalled()
		expect(state.calls).not.toContain('release')
	})

	it('fails the place step when `epic` creates no readable epic', async () => {
		epic_create.mockResolvedValue({ kind: 'refused' })

		const result = await run_split.split(INDEPENDENT)

		expect(result).toMatchObject({ kind: 'failed', step: 'place' })
		expect(state.calls).not.toContain('release')
	})

	it('fails the audit step when `epic:audit` finds errors', async () => {
		audit_run.mockResolvedValue(1)

		const result = await run_split.split(INDEPENDENT)

		expect(result).toMatchObject({ kind: 'failed', step: 'audit' })
		expect(state.calls).not.toContain('release')
	})
})

describe('run_split.split — a rerun after a later step failed', () => {
	it('places nothing again when the tracking epic already lists every child', async () => {
		tracking_with.mockResolvedValue({ epic: 30, lists_children: true })

		const result = await run_split.split(INDEPENDENT)

		expect(tracking_with).toHaveBeenCalledWith('10', CHILDREN)
		expect(result).toMatchObject({ kind: 'epic', epic: 30 })
		expect(epic_run).not.toHaveBeenCalled()
		expect(epic_create).not.toHaveBeenCalled()
		expect(audit_run).toHaveBeenCalledWith(['30'])
		expect(state.calls).toStrictEqual(['stash', 'comment', 'audit', 'release'])
	})
})
