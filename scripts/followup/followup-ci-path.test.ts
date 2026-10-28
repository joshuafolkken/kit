import type { PrStateSnapshot, RollupCheck } from '#scripts/gh/git-pr-checks-parse'
import { describe, expect, it, vi } from 'vitest'
import { followup_ci_path, type CiPath } from './followup-ci-path'

// joshuafolkken/kit#5295: followup's CI wait records when each pending check settled and which one
// settled last, so `lane:stats` can read the wait's critical path.

const SECONDS = 1000
const PENDING = 'pending'
const PASS = 'pass'
const FAIL = 'fail'

function check(name: string, status: string): RollupCheck {
	return { name, status }
}

function snapshot(...rollup: Array<RollupCheck>): PrStateSnapshot {
	return { rollup, merge_state_status: undefined, review_decision: undefined }
}

// One poll per `[seconds, checks]` pair, the clock reading `seconds` at it.
function polled(polls: ReadonlyArray<[number, Array<RollupCheck>]>): CiPath {
	const path = followup_ci_path.new_path()

	for (const [seconds, checks] of polls) {
		followup_ci_path.observe(path, snapshot(...checks), seconds * SECONDS)
	}

	return path
}

describe('followup_ci_path.record_of — the critical path', () => {
	it('times each pending check from the first poll to the poll that saw it settle', () => {
		const path = polled([
			[100, [check('lint', PENDING), check('test', PENDING)]],
			[130, [check('lint', PASS), check('test', PENDING)]],
			[190, [check('lint', PASS), check('test', FAIL)]],
		])

		expect(followup_ci_path.record_of(path)).toStrictEqual({
			last_check: 'test',
			check_ms: { lint: 30 * SECONDS, test: 90 * SECONDS },
		})
	})

	it('leaves out a check already settled at the first poll', () => {
		const path = polled([
			[0, [check('build', PASS), check('test', PENDING)]],
			[20, [check('build', PASS), check('test', PASS)]],
		])

		expect(followup_ci_path.record_of(path)).toStrictEqual({
			last_check: 'test',
			check_ms: { test: 20 * SECONDS },
		})
	})
})

describe('followup_ci_path.record_of — what it leaves out', () => {
	it('leaves CodeRabbit to its own coderabbit-wait row', () => {
		const path = polled([
			[0, [check('CodeRabbit', PENDING), check('test', PENDING)]],
			[10, [check('CodeRabbit', PENDING), check('test', PASS)]],
			[60, [check('CodeRabbit', PASS), check('test', PASS)]],
		])

		expect(followup_ci_path.record_of(path)).toStrictEqual({
			last_check: 'test',
			check_ms: { test: 10 * SECONDS },
		})
	})

	it('records nothing where no check was seen to settle', () => {
		const path = polled([[0, [check('test', PENDING)]]])

		expect(followup_ci_path.record_of(path)).toStrictEqual({})
	})
})

describe('followup_ci_path.observer_of — the first wait only', () => {
	it('ignores the polls of a later wait', async () => {
		const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
		const path = followup_ci_path.new_path()

		await followup_ci_path.observer_of(path)(snapshot(check('test', PENDING)))
		clock.mockReturnValue(5 * SECONDS)
		await followup_ci_path.observer_of(path)(snapshot(check('test', PASS)))

		expect(followup_ci_path.record_of(path)).toStrictEqual({})
		clock.mockRestore()
	})
})
