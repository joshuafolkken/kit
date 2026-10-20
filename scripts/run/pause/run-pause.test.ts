import { epic_index } from '#scripts/epic/epic-index'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_stash } from '#scripts/git/stash/git-stash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pause } from './run-pause'

// joshuafolkken/kit#4160: the prerequisite pause as one command. Each write lands in an in-memory
// stand-in for where it really lands — the stash stack, the Issue's comments, its blocked-by
// relations, the epic and the hold — so a rerun reads back what the first run left.

const state = vi.hoisted(() => ({
	stashes: [] as Array<string>,
	has_work: true,
	comments: [] as Array<string>,
	blockers: [] as Array<number>,
	epics: [] as Array<{ number: number; body: string }>,
	calls: [] as Array<string>,
	failing: undefined as string | undefined,
}))

function fail_if(step: string): void {
	if (state.failing === step) throw new Error(`${step} is down`)
}

vi.mock('#scripts/git/stash/stash-push-cli', () => ({
	stash_push_cli: {
		set_aside: async ({ message }: { message: string }) => {
			fail_if('stash')
			state.calls.push('stash')
			if (!state.has_work) return 'clean'
			state.stashes.push(`On 4160-lane: ${message}`)

			return 'stashed'
		},
	},
}))

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: {
		issue_list_comments: async () => JSON.stringify(state.comments.map((body) => ({ body }))),
		issue_blocked_by_numbers: async () => [...state.blockers],
	},
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_comment: async (_issue: string, body: string) => {
			fail_if('comment')
			state.calls.push('comment')
			state.comments.push(body)

			return 'https://github.com/o/r/issues/10#issuecomment-1'
		},
		issue_add_blocked_by: async (_issue: string, blocker: string) => {
			state.calls.push('relation')
			state.blockers.push(Number(blocker))

			return state.failing !== 'record'
		},
	},
}))

const add_children = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-add', () => ({ epic_add: { add_children } }))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({
	run_hold_cli: {
		run: async () => {
			state.calls.push('release')

			return state.failing === 'release' ? 1 : 0
		},
	},
}))

const REQUEST = { issue: '10', prerequisite: '11' }
const MESSAGE = 'run:pause: #10 waits on #11'
const BLOCKED_BY = 'blocked-by'

beforeEach(() => {
	Object.assign(state, {
		stashes: [],
		has_work: true,
		comments: [],
		blockers: [],
		epics: [],
		calls: [],
		failing: undefined,
	})
	vi.spyOn(git_stash, 'list').mockImplementation(async () =>
		state.stashes.map((subject, index) => ({ selector: `stash@{${String(index)}}`, subject })),
	)
	vi.spyOn(epic_index, 'fetch_epics').mockImplementation(async () => ({
		cutoff: 'none',
		epics: state.epics,
	}))
	add_children.mockReset().mockImplementation(async () => {
		state.calls.push('epic')
		state.blockers.push(Number(REQUEST.prerequisite))

		return 0
	})
})

describe('run_pause.pause — the four steps in order', () => {
	it('stashes, comments, records the relation directly and releases when no epic tracks it', async () => {
		const result = await run_pause.pause(REQUEST)

		expect(result.kind).toBe('paused')
		expect(state.calls).toStrictEqual(['stash', 'comment', 'relation', 'release'])
		expect(state.stashes).toStrictEqual([`On 4160-lane: ${MESSAGE}`])
		expect(state.comments[0]).toContain(`pnpm josh stash:pop "${MESSAGE}"`)
		expect(state.blockers).toStrictEqual([11])
	})

	it('records the relation through `epic --add --before` when an epic tracks the issue', async () => {
		state.epics = [{ number: 7, body: '- [ ] #10' }]

		const result = await run_pause.pause(REQUEST)

		expect(state.calls).toStrictEqual(['stash', 'comment', 'epic', 'release'])
		expect(add_children).toHaveBeenCalledWith({
			epic_number: 7,
			children: [11],
			position: { kind: 'before', target: 10 },
		})
		expect(result.done.find(({ step }) => step === BLOCKED_BY)?.detail).toContain(
			'recorded in epic',
		)
	})

	it('writes the relation directly when the epic insertion recorded none', async () => {
		state.epics = [{ number: 7, body: '- [ ] #10\n- [ ] #11' }]
		add_children.mockImplementation(async () => 0)

		await run_pause.pause(REQUEST)

		expect(state.blockers).toStrictEqual([11])
	})

	it('says nothing was stashed on a clean tree', async () => {
		state.has_work = false

		await run_pause.pause(REQUEST)

		expect(state.comments[0]).toContain('nothing was stashed')
		expect(state.comments[0]).not.toContain('stash:pop')
	})
})

describe('run_pause.pause — a failure stops, and a rerun continues', () => {
	it('stops at the failing step and reports the steps already done', async () => {
		state.failing = 'comment'

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: 'comment', reason: 'comment is down' })
		expect(result.done.map(({ step }) => step)).toStrictEqual(['stash'])
		expect(state.calls).toStrictEqual(['stash'])
	})

	it('skips what the failed run already did on the rerun', async () => {
		state.failing = 'record'
		await run_pause.pause(REQUEST)
		state.failing = undefined
		state.calls = []

		const result = await run_pause.pause(REQUEST)

		expect(result.kind).toBe('paused')
		expect(state.calls).toStrictEqual(['release'])
		expect(state.stashes).toHaveLength(1)
		expect(state.comments).toHaveLength(1)
		expect(result.done.map(({ detail }) => detail).slice(0, 3)).toStrictEqual(
			Array.from({ length: 3 }, () => 'already'),
		)
	})

	it('fails the release step when `run:release` refuses', async () => {
		state.failing = 'release'

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: 'release' })
		expect(result.done).toHaveLength(3)
	})
})

describe('run_pause.pause — a read that fails is never a negative answer', () => {
	it('fails the comment step on unreadable comments rather than posting a second one', async () => {
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValueOnce(undefined)

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: 'comment' })
		expect(state.comments).toStrictEqual([])
	})

	it('fails the blocked-by step on an unreadable epic listing rather than reading it as no epic', async () => {
		vi.spyOn(epic_index, 'fetch_epics').mockResolvedValueOnce(undefined)

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: BLOCKED_BY })
		expect(state.blockers).toStrictEqual([])
	})

	it('fails the blocked-by step on a cut-short epic listing rather than reading it as no epic', async () => {
		vi.spyOn(epic_index, 'fetch_epics').mockResolvedValueOnce({ cutoff: 'row_limit', epics: [] })

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: BLOCKED_BY })
		expect(state.blockers).toStrictEqual([])
	})

	it('fails the blocked-by step when `epic --add` refuses', async () => {
		state.epics = [{ number: 7, body: '- [ ] #10' }]
		add_children.mockImplementation(async () => 1)

		const result = await run_pause.pause(REQUEST)

		expect(result).toMatchObject({ kind: 'failed', step: BLOCKED_BY })
		expect(state.calls).not.toContain('release')
	})
})
