// cspell:words coderabbit coderabbitai
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { describe, expect, it, vi } from 'vitest'
import { followup_coderabbit_retrigger } from './followup-coderabbit-retrigger'
import { retrigger_fixture } from './followup-coderabbit-retrigger-fixture'

// joshuafolkken/kit#7079: a rate limit after `@coderabbitai review` is waited out and retriggered
// again, up to `RETRIGGER_CAP` per pull request; past it the run parks `run:stalled`. No note ever
// offers a bypass.

vi.mock('#scripts/gh/git-pr-checks-parse', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	parse_pr_state_snapshot: vi.fn(),
}))

const {
	BRANCH,
	DONE,
	MARGIN,
	MINUTES,
	NOTICE_AT,
	NOTICE_AT_MS,
	ONE_MINUTE,
	RATE_LIMITED,
	RUNNING,
	TWO_MINUTES,
	checks_read,
	coderabbit,
	comments_are,
	notice,
	retrigger_at,
	use_run_spies,
	wait_seeing,
} = retrigger_fixture
const { CAP_NOTE, AGAIN_NOTE, RETRIGGER_BODY, RETRIGGER_CAP } = followup_coderabbit_retrigger
const LATER = '2026-10-28T01:05:00Z'

function spent_retriggers(): Array<ReturnType<typeof retrigger_at>> {
	return Array.from({ length: RETRIGGER_CAP }, () => retrigger_at(NOTICE_AT))
}

describe('followup_coderabbit_retrigger.decide — another rate limit', () => {
	it('retriggers again on a notice newer than the retrigger, waiting out its window', () => {
		const comments = [coderabbit(notice(ONE_MINUTE), LATER), retrigger_at(NOTICE_AT)]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual({
			kind: 'retrigger',
			wait_ms: 6 * MINUTES + MARGIN,
		})
	})

	it('retriggers again on a retrigger with no time it was written, below the cap', () => {
		const comments = [
			coderabbit(notice(ONE_MINUTE)),
			{ body: RETRIGGER_BODY, author: { login: 'joshuafolkken' } },
		]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual({
			kind: 'retrigger',
			wait_ms: MINUTES + MARGIN,
		})
	})

	it('stops on a pull request retriggered up to the cap', () => {
		const comments = [coderabbit(notice(ONE_MINUTE)), ...spent_retriggers()]

		expect(followup_coderabbit_retrigger.decide(comments, NOTICE_AT_MS)).toStrictEqual({
			kind: 'stop',
			note: CAP_NOTE,
		})
	})
})

describe('followup_coderabbit_retrigger — never a bypass', () => {
	it.each([
		['the cap', CAP_NOTE],
		['another rate limit', AGAIN_NOTE],
		['an unreadable window', followup_coderabbit_retrigger.UNREADABLE_NOTE],
	])('the note on %s offers no bypass', (_case, note) => {
		expect(note).toContain('never bypass the check')
		expect(note).not.toContain('Tier C')
	})

	it('parks the run at the cap', () => {
		expect(CAP_NOTE).toContain('`run:stalled` at stage followup')
	})
})

describe('followup_coderabbit_retrigger.run — retriggers up to the cap', () => {
	use_run_spies()

	it('retriggers again when the retriggered review is rate-limited, until it lands', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)))
		checks_read(RUNNING, RATE_LIMITED, RUNNING, DONE)

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: true, notes: [] })
		expect(git_gh_command.pr_comment).toHaveBeenCalledTimes(2)
	})

	it('posts nothing but the retrigger, at most the cap times in one run', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)))
		checks_read(RUNNING, RATE_LIMITED, RUNNING, RATE_LIMITED, RUNNING, RATE_LIMITED)

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: true, notes: [AGAIN_NOTE] })
		expect(vi.mocked(git_gh_command.pr_comment).mock.calls).toStrictEqual(
			Array.from({ length: RETRIGGER_CAP }, () => [BRANCH, RETRIGGER_BODY]),
		)
	})

	it('posts nothing past the cap on the same pull request', async () => {
		comments_are(coderabbit(notice(TWO_MINUTES)), ...spent_retriggers())

		const result = await followup_coderabbit_retrigger.run(BRANCH, wait_seeing(RATE_LIMITED))

		expect(result).toStrictEqual({ is_retriggered: false, notes: [CAP_NOTE] })
		expect(git_gh_command.pr_comment).not.toHaveBeenCalled()
		expect(lane_ledger_write.record_stage).not.toHaveBeenCalled()
	})
})
