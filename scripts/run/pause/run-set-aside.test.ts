import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_stash } from '#scripts/git/stash/git-stash'
import { session_language } from '#scripts/josh/session-language'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pause_comment } from './run-pause-comment'
import { run_set_aside } from './run-set-aside'

// joshuafolkken/kit#5846: the set-aside steps `run:pause` and `run:split` share. The stash stack and
// the Issue's comments are in-memory stand-ins, so a rerun reads back what the first run left.

const state = vi.hoisted(() => ({
	stashes: [] as Array<string>,
	has_work: true,
	comments: [] as Array<string>,
	calls: [] as Array<string>,
	release_code: 0,
	is_lane: false,
	commits: [] as Array<string>,
}))

vi.mock('./run-set-aside-commit', () => ({
	run_set_aside_commit: {
		is_lane: async () => state.is_lane,
		message_of: (message: string) => `wip: ${message}`,
		is_committed: async (message: string) => state.commits.includes(`wip: ${message}`),
		commit: async (message: string) => {
			state.calls.push('commit')
			if (!state.has_work) return 'clean'
			state.commits.push(`wip: ${message}`)

			return 'committed'
		},
	},
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

const NOTHING_SET_ASIDE = 'nothing was set aside'

const REQUEST = {
	issue: '10',
	stash_message: 'aside: #10',
	marker: '<!-- aside #10 -->',
	headline: 'Set aside.',
}

beforeEach(() => {
	vi.stubEnv(session_language.ENV_KEY, 'en')
	Object.assign(state, {
		stashes: [],
		has_work: true,
		comments: [],
		calls: [],
		release_code: 0,
		is_lane: false,
		commits: [],
	})
	vi.spyOn(git_stash, 'list').mockImplementation(async () =>
		state.stashes.map((subject, index) => ({ selector: `stash@{${String(index)}}`, subject })),
	)
})

afterEach(() => {
	vi.unstubAllEnvs()
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

	it('says nothing was set aside on a clean tree', async () => {
		state.has_work = false

		await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(state.comments[0]).toContain(NOTHING_SET_ASIDE)
	})
})

describe('run_set_aside — on the lane branch the work is committed, not stashed', () => {
	it('commits and names the main merge as the resume', async () => {
		state.is_lane = true

		await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(state.calls).toStrictEqual(['commit', 'comment', 'release'])
		expect(state.stashes).toStrictEqual([])
		expect(state.comments[0]).toContain(`\`wip: ${REQUEST.stash_message}\``)
		expect(state.comments[0]).toContain('pnpm josh main:merge')
		expect(state.comments[0]).not.toContain('stash:pop')
		expect(state.comments[0]).not.toContain('expect conflicts')
	})

	it('stashes work handed off to other issues even on the lane branch', async () => {
		state.is_lane = true

		await run_set_aside.run_steps(run_set_aside.steps_of({ ...REQUEST, is_handed_off: true }))

		expect(state.calls).toStrictEqual(['stash', 'comment', 'release'])
		expect(state.comments[0]).toContain('stash:pop')
	})

	it('says nothing was set aside when the lane tree was clean', async () => {
		Object.assign(state, { is_lane: true, has_work: false })

		await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

		expect(state.comments[0]).toContain(NOTHING_SET_ASIDE)
	})
})

// joshuafolkken/kit#7667: only the work line a person reads follows `JOSH_SESSION_LANG` (an empty value
// resolves as unset, to `ja`); the marker and the commands stay English, so either comment reads back.
const STASHED_CASE = {
	name: 'stashed',
	is_lane: false,
	has_work: true,
	ja: 'stash した',
	en: 'was stashed',
}
const WORK_CASES = [
	STASHED_CASE,
	{ name: 'committed', is_lane: true, has_work: true, ja: 'コミットした', en: 'was committed' },
	{ name: 'nothing', is_lane: false, has_work: false, ja: '何も退避していない', en: 'nothing was' },
]

async function comment_in(lang: string, work: typeof STASHED_CASE): Promise<string> {
	vi.stubEnv(session_language.ENV_KEY, lang)
	Object.assign(state, { is_lane: work.is_lane, has_work: work.has_work })
	await run_set_aside.run_steps(run_set_aside.steps_of(REQUEST))

	return state.comments[0] ?? ''
}

describe('run_set_aside — the work line follows the session language', () => {
	it.each(['', 'ja'].flatMap((lang) => WORK_CASES.map((work) => ({ lang, work }))))(
		'writes the $work.name line in Japanese when the language is "$lang"',
		async ({ lang, work }) => {
			const body = await comment_in(lang, work)

			expect(body).toContain(work.ja)
			expect(body).not.toContain(work.en)
		},
	)

	it.each(WORK_CASES)('writes the $name line in English when the language is en', async (work) => {
		const body = await comment_in('en', work)

		expect(body).toContain(work.en)
		expect(body).not.toContain(work.ja)
	})

	it.each(['ja', 'en'])(
		'keeps the commands and the marker a %s comment is found by',
		async (lang) => {
			const body = await comment_in(lang, STASHED_CASE)

			expect(body).toContain(`\`pnpm josh stash:pop "${REQUEST.stash_message}"\``)
			expect(body.endsWith(`\n${REQUEST.marker}`)).toBe(true)
			expect(await run_pause_comment.has_comment(REQUEST)).toBe(true)
		},
	)
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
