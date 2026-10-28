// cspell:words coderabbit coderabbitai
import { git_gh_command } from '#scripts/gh/git-gh-command'
import {
	parse_pr_state_snapshot,
	type PrStateSnapshot,
	type RollupCheck,
} from '#scripts/gh/git-pr-checks-parse'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { poll } from '#scripts/lib/poll'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_coderabbit_retrigger, type PullComment } from './followup-coderabbit-retrigger'
import { followup_coderabbit_wait, type CodeRabbitWait } from './followup-coderabbit-wait'

// joshuafolkken/kit#5289: followup reads CodeRabbit's rate-limit window, waits it out, posts one
// `@coderabbitai review` and waits for the check again; a second rate limit is left to the person.

vi.mock('#scripts/gh/git-pr-checks-parse', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	parse_pr_state_snapshot: vi.fn(),
}))

const SECONDS = 1000
const MINUTES = 60 * SECONDS
const MARGIN = 15 * SECONDS
const NOTICE_AT = '2026-10-28T01:00:00Z'
const NOTICE_AT_MS = Date.parse(NOTICE_AT)
const BRANCH = '5289-lane'
const ONE_MINUTE = '**1 minute**'
const TWO_MINUTES = '**2 minutes**'
const NOT_A_NOTICE = 'Actionable comments posted: 0'
const RATE_LIMITED: RollupCheck = {
	name: 'CodeRabbit',
	status: 'pass',
	description: 'Rate limited',
}
const RUNNING: RollupCheck = { name: 'CodeRabbit', status: 'pending', description: 'In progress' }
const DONE: RollupCheck = { name: 'CodeRabbit', status: 'pass', description: 'Review completed' }
const STOP_AGAIN = { kind: 'stop', note: followup_coderabbit_retrigger.AGAIN_NOTE }
const STOP_UNREADABLE = { kind: 'stop', note: followup_coderabbit_retrigger.UNREADABLE_NOTE }

function notice(wait: string): string {
	return `> [!WARNING]\n> ## Rate limit exceeded\n>\n> Please wait ${wait} before requesting another review.`
}

function coderabbit(body: string, updated_at = NOTICE_AT): PullComment {
	return { body, author: { login: 'coderabbitai[bot]' }, updatedAt: updated_at }
}

function retrigger_at(updated_at: string): PullComment {
	return { body: followup_coderabbit_retrigger.RETRIGGER_BODY, updatedAt: updated_at }
}

function snapshot(check: RollupCheck): PrStateSnapshot {
	return { rollup: [check], merge_state_status: undefined, review_decision: undefined }
}

function wait_seeing(check: RollupCheck): CodeRabbitWait {
	const wait = followup_coderabbit_wait.new_wait()

	followup_coderabbit_wait.observe(wait, snapshot(check), 0)

	return wait
}

function comments_are(...comments: Array<PullComment>): void {
	vi.mocked(git_gh_command.pr_get_comments).mockResolvedValue(JSON.stringify(comments))
}

function checks_read(...checks: Array<RollupCheck>): void {
	for (const check of checks) {
		vi.mocked(parse_pr_state_snapshot).mockReturnValueOnce(snapshot(check))
	}
}

function use_run_spies(): void {
	beforeEach(() => {
		vi.spyOn(git_gh_command, 'pr_get_comments')
		vi.spyOn(git_gh_command, 'pr_comment').mockResolvedValue('')
		vi.spyOn(git_gh_command, 'pr_get_checks_snapshot').mockResolvedValue({
			pr_number: 1,
			snapshot_json: '{}',
		})
		vi.spyOn(poll, 'sleep').mockResolvedValue()
		vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
		vi.spyOn(Date, 'now').mockReturnValue(NOTICE_AT_MS)
		vi.spyOn(console, 'info').mockImplementation(vi.fn())
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.mocked(parse_pr_state_snapshot).mockReset()
	})
}

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
})

describe('followup_coderabbit_retrigger.decide — a stop', () => {
	it('stops on a pull request already retriggered', () => {
		const comments = [
			coderabbit(notice(ONE_MINUTE)),
			{ body: followup_coderabbit_retrigger.RETRIGGER_BODY, author: { login: 'joshuafolkken' } },
		]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual(STOP_AGAIN)
	})

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

describe('followup_coderabbit_retrigger.decide — a retrigger already on the pull request', () => {
	const LATER = '2026-10-28T01:05:00Z'

	it('waits for the review a retrigger newer than the notice asked for, whoever posted it', () => {
		const comments = [coderabbit(notice(ONE_MINUTE)), retrigger_at(LATER)]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual({
			kind: 'await',
		})
	})

	it('reads a notice newer than the retrigger as the second rate limit', () => {
		const comments = [coderabbit(notice(ONE_MINUTE), LATER), retrigger_at(NOTICE_AT)]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual(STOP_AGAIN)
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

	it('hands a rate limit after the retriggered review started to the person', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)))
		checks_read(RUNNING, RATE_LIMITED)

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({
			is_retriggered: true,
			notes: [followup_coderabbit_retrigger.AGAIN_NOTE],
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
		comments_are(coderabbit(notice(TWO_MINUTES)), retrigger_at('2026-10-28T01:01:00Z'))
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
		checks_read(RUNNING, RATE_LIMITED)

		const settled = await followup_coderabbit_retrigger.settle(
			'first',
			vi.fn(async () => 'second'),
			BRANCH,
			wait_seeing(RATE_LIMITED),
		)

		expect(settled).toStrictEqual({
			snapshot: 'second',
			is_retriggered: true,
			notes: [STOP_AGAIN.note],
		})
	})
})

describe('followup_coderabbit_retrigger.run — no retrigger', () => {
	use_run_spies()

	it('does nothing when the check wait did not end on a rate limit', async () => {
		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(DONE))

		expect(result).toStrictEqual({ is_retriggered: false, notes: [] })
		expect(git_gh_command.pr_get_comments).not.toHaveBeenCalled()
	})

	it('posts nothing a second time on the same pull request', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)), {
			body: followup_coderabbit_retrigger.RETRIGGER_BODY,
		})

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: false, notes: [STOP_AGAIN.note] })
		expect(git_gh_command.pr_comment).not.toHaveBeenCalled()
		expect(lane_ledger_write.record_stage).not.toHaveBeenCalled()
	})

	it('posts nothing when no window can be read', async () => {
		comments_are(coderabbit(NOT_A_NOTICE))

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: false, notes: [STOP_UNREADABLE.note] })
		expect(poll.sleep).not.toHaveBeenCalled()
		expect(git_gh_command.pr_comment).not.toHaveBeenCalled()
	})
})
