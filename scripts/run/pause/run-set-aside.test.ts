import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_stash } from '#scripts/git/stash/git-stash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_set_aside } from './run-set-aside'

// joshuafolkken/kit#5846: the set-aside steps `run:pause` and `run:split` share. The stash stack and
// the Issue's comments are in-memory stand-ins, so a rerun reads back what the first run left.

const state = vi.hoisted(() => ({
	stashes: [] as Array<string>,
	has_work: true,
	comments: [] as Array<string>,
	calls: [] as Array<string>,
	release_code: 0,
}))

vi.mock('#scripts/git/stash/stash-push-cli', () => ({
	stash_push_cli: {
		set_aside: async ({ message }: { message: string }) => {
			state.calls.push('stash')
			if (!state.has_work) return 'clean'
			state.stashes.push(`On lane: ${message}`)

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

			return 'commented'
		},
	},
}))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({
	run_hold_cli: {
		run: async () => {
			state.calls.push('release')

			return state.release_code
		},
	},
}))

const REQUEST = {
	issue: '10',
	stash_message: 'aside: #10',
	marker: '<!-- aside #10 -->',
	headline: 'Set aside.',
}

beforeEach(() => {
	Object.assign(state, { stashes: [], has_work: true, comments: [], calls: [], release_code: 0 })
	vi.spyOn(git_stash, 'list').mockImplementation(async () =>
		state.stashes.map((subject, index) => ({ selector: `stash@{${String(index)}}`, subject })),
	)
})

describe('run_set_aside — the steps in order', () => {
	it('stashes, comments, runs the steps between and releases', async () => {
		const between = vi.fn(async () => {
			state.calls.push('between')

			return 'done'
		})

		const result = await run_set_aside.run_steps(
			run_set_aside.steps_of(REQUEST, [['between', between]]),
		)

		expect(result.kind).toBe('done')
		expect(state.calls).toStrictEqual(['stash', 'comment', 'between', 'release'])
		expect(state.comments[0]).toContain(REQUEST.marker)
		expect(state.comments[0]).toContain(`pnpm josh stash:pop "${REQUEST.stash_message}"`)
	})

	it('says nothing was stashed on a clean tree', async () => {
		state.has_work = false

		await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(state.comments[0]).toContain('nothing was stashed')
	})
})

describe('run_set_aside — a failure stops, and a rerun continues', () => {
	it('stops at a failing step before the release', async () => {
		const result = await run_set_aside.run_steps(
			run_set_aside.steps_of(REQUEST, [
				[
					'between',
					async () => {
						throw new Error('down')
					},
				],
			]),
		)

		expect(result).toMatchObject({ kind: 'failed', step: 'between', reason: 'down' })
		expect(state.calls).not.toContain('release')
	})

	it('skips the stash and comment already written on a rerun', async () => {
		await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))
		state.calls = []

		const result = await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(state.calls).toStrictEqual(['release'])
		expect(result.done.map(({ detail }) => detail)).toStrictEqual([
			'already',
			'already',
			'released',
		])
	})
})

describe('run_set_aside — a refused or unreadable write is a failure', () => {
	it('fails the release step when `run:release` refuses', async () => {
		state.release_code = 1

		const result = await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(result).toMatchObject({ kind: 'failed', step: 'release' })
	})

	it('fails the comment step on unreadable comments rather than posting again', async () => {
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValueOnce(undefined)

		const result = await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(result).toMatchObject({ kind: 'failed', step: 'comment' })
		expect(state.comments).toStrictEqual([])
	})
})
