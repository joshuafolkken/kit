// cspell:words coderabbit coderabbitai
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { parse_pr_state_snapshot } from '#scripts/gh/git-pr-checks-parse'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { poll } from '#scripts/lib/poll'
import { describe, expect, it, vi } from 'vitest'
import { followup_coderabbit_retrigger } from './followup-coderabbit-retrigger'
import { retrigger_fixture } from './followup-coderabbit-retrigger-fixture'

// joshuafolkken/kit#5289: followup reads CodeRabbit's rate-limit window, waits it out, posts
// `@coderabbitai review` and waits for the check again. The retriggers past the first and the cap:
// `followup-coderabbit-retrigger-cap.test.ts`.

vi.mock('#scripts/gh/git-pr-checks-parse', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	parse_pr_state_snapshot: vi.fn(),
}))

const {
	BRANCH,
	DONE,
	MARGIN,
	MINUTES,
	NOTICE_AT_MS,
	ONE_MINUTE,
	RATE_LIMITED,
	RUNNING,
	SECONDS,
	TWO_MINUTES,
	checks_read,
	coderabbit,
	comments_are,
	notice,
	retrigger_at,
	snapshot,
	use_run_spies,
	wait_seeing,
} = retrigger_fixture
const RETRIGGERED_AT = '2026-10-28T01:01:00Z'
const NOT_A_NOTICE = 'Actionable comments posted: 0'
const STOP_UNREADABLE = { kind: 'stop', note: followup_coderabbit_retrigger.UNREADABLE_NOTE }

describe('followup_coderabbit_retrigger.parse_wait_ms', () => {
	it.each([
		['**12 minutes and 34 seconds**', 12 * MINUTES + 34 * SECONDS],
		['45 seconds', 45 * SECONDS],
		[ONE_MINUTE, MINUTES],
		['1 hour and 2 minutes', 62 * MINUTES],
		['5 min 3 sec', 5 * MINUTES + 3 * SECONDS],
	])('reads %s', (wait, expected) => {
		expect(followup_coderabbit_retrigger.parse_wait_ms(notice(wait))).toBe(expected)
	})

	it('reads nothing from a comment that is no rate-limit notice', () => {
		expect(
			followup_coderabbit_retrigger.parse_wait_ms('Please wait 5 minutes before merging.'),
		).toBeUndefined()
	})

	it('reads nothing from a rate-limit notice that states no wait', () => {
		expect(
			followup_coderabbit_retrigger.parse_wait_ms('> ## Rate limit exceeded\n> Try later.'),
		).toBeUndefined()
	})
})

describe('followup_coderabbit_retrigger.decide — a retrigger', () => {
	it('waits to the window’s end, counted from when the notice was written, and a margin', () => {
		const comments = [coderabbit(notice('**10 minutes**'))]

		expect(
			followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS + 4 * MINUTES),
		).toStrictEqual({ kind: 'retrigger', wait_ms: 6 * MINUTES + MARGIN })
	})

	it('waits the margin alone for a window already over', () => {
		const comments = [coderabbit(notice(ONE_MINUTE))]

		expect(
			followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS + 9 * MINUTES),
		).toStrictEqual({ kind: 'retrigger', wait_ms: MARGIN })
	})

	it('waits for the review a retrigger newer than the notice asked for, whoever posted it', () => {
		const comments = [coderabbit(notice(ONE_MINUTE)), retrigger_at('2026-10-28T01:05:00Z')]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual({
			kind: 'await',
		})
	})
})

describe('followup_coderabbit_retrigger.decide — a stop', () => {
	it.each([
		['a notice from someone else', { ...coderabbit(notice(ONE_MINUTE)), author: { login: 'me' } }],
		[
			'a notice from a lookalike login',
			{ ...coderabbit(notice(ONE_MINUTE)), author: { login: 'coderabbitai-x' } },
		],
		['a notice with no time it was written', coderabbit(notice(ONE_MINUTE), 'unknown')],
		['no notice at all', coderabbit(NOT_A_NOTICE)],
	])('stops with the reason on %s', (_case, comment) => {
		expect(followup_coderabbit_retrigger.decide([comment], NOTICE_AT_MS)).toStrictEqual(
			STOP_UNREADABLE,
		)
	})

	it('stops on a window longer than followup waits', () => {
		const decision = followup_coderabbit_retrigger.decide(
			[coderabbit(notice('**45 minutes**'))],
			NOTICE_AT_MS,
		)

		expect(decision.kind).toBe('stop')
		expect(JSON.stringify(decision)).toContain('46 more minutes')
	})
})

describe('followup_coderabbit_retrigger.run — a retrigger', () => {
	use_run_spies()

	it('waits out the window, posts once, records it and waits for the review', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)))
		checks_read(RATE_LIMITED, RUNNING, DONE)

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: true, notes: [] })
		expect(poll.sleep).toHaveBeenNthCalledWith(1, 2 * MINUTES + MARGIN)
		expect(vi.mocked(git_gh_command.pr_comment).mock.calls).toStrictEqual([
			[BRANCH, followup_coderabbit_retrigger.RETRIGGER_BODY],
		])
		expect(lane_ledger_write.record_stage).toHaveBeenCalledWith({
			stage: lane_ledger_write.CODERABBIT_RETRIGGER_STAGE,
			elapsed_ms: 2 * MINUTES + MARGIN,
		})
	})

	it('lets the merge go ahead when the retriggered review is still running', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)))
		vi.mocked(parse_pr_state_snapshot).mockReturnValue(snapshot(RUNNING))

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({
			is_retriggered: true,
			notes: [followup_coderabbit_retrigger.UNFINISHED_NOTE],
		})
	})
})

describe('followup_coderabbit_retrigger.run — the review it waits for', () => {
	use_run_spies()

	it('waits for a retrigger already posted without posting another', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)), retrigger_at(RETRIGGERED_AT))
		checks_read(RUNNING, DONE)

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: true, notes: [] })
		expect(git_gh_command.pr_comment).not.toHaveBeenCalled()
		expect(poll.sleep).not.toHaveBeenCalledWith(2 * MINUTES + MARGIN)
	})

	it('times the retriggered review into the CodeRabbit wait', async () => {
		const wait = wait_seeing(RATE_LIMITED)
		let now_ms = 0

		vi.spyOn(performance, 'now').mockImplementation(() => (now_ms += SECONDS))
		comments_are(coderabbit(notice(TWO_MINUTES)))
		checks_read(RUNNING, RUNNING, DONE)
		await followup_coderabbit_retrigger.run(BRANCH, wait)

		expect(wait.wait_ms).toBe(2 * SECONDS)
	})
})

// #6868: the review wait reads on the PR completion schedule, not a fixed thirty seconds.
describe('followup_coderabbit_retrigger.run — the review wait’s cadence', () => {
	use_run_spies()

	it('reads every 30 seconds four times, then every 20 seconds', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)), retrigger_at(RETRIGGERED_AT))
		checks_read(RUNNING, RUNNING, RUNNING, RUNNING, RUNNING, RUNNING, DONE)
		await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(vi.mocked(poll.sleep).mock.calls.flat()).toStrictEqual([
			30 * SECONDS,
			30 * SECONDS,
			30 * SECONDS,
			30 * SECONDS,
			20 * SECONDS,
			20 * SECONDS,
		])
	})
})

describe('followup_coderabbit_retrigger.settle', () => {
	use_run_spies()

	it('keeps the first snapshot when nothing was retriggered', async () => {
		const wait_for_green = vi.fn(async () => 'second')

		const settled = await followup_coderabbit_retrigger.settle(
			'first',
			wait_for_green,
			BRANCH,
			wait_seeing(DONE),
		)

		expect(settled).toStrictEqual({ snapshot: 'first', is_retriggered: false, notes: [] })
		expect(wait_for_green).not.toHaveBeenCalled()
	})

	it('reads the checks again after a retriggered review', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)))
		checks_read(RUNNING, DONE)

		const settled = await followup_coderabbit_retrigger.settle(
			'first',
			vi.fn(async () => 'second'),
			BRANCH,
			wait_seeing(RATE_LIMITED),
		)

		expect(settled).toStrictEqual({ snapshot: 'second', is_retriggered: true, notes: [] })
	})
})

describe('followup_coderabbit_retrigger.run — no retrigger', () => {
	use_run_spies()

	it('does nothing when the check wait did not end on a rate limit', async () => {
		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(DONE))

		expect(result).toStrictEqual({ is_retriggered: false, notes: [] })
		expect(git_gh_command.pr_get_comments).not.toHaveBeenCalled()
	})

	it('posts nothing when no window can be read', async () => {
		comments_are(coderabbit(NOT_A_NOTICE))

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: false, notes: [STOP_UNREADABLE.note] })
		expect(poll.sleep).not.toHaveBeenCalled()
		expect(git_gh_command.pr_comment).not.toHaveBeenCalled()
	})
})
