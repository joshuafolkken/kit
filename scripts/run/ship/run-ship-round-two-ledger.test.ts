import type { RoundTwoAnswer } from '#scripts/review/review-round2'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewVerdict } from './run-ship-review'
import { run_ship_round_two_ledger } from './run-ship-round-two-ledger'
import type { StepResult } from './run-ship-sync'

const { record_round_two_mock, current_verdict_mock } = vi.hoisted(() => ({
	record_round_two_mock: vi.fn(),
	current_verdict_mock: vi.fn(),
}))

vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_round_two: record_round_two_mock },
}))

vi.mock('./run-ship-reviewer', () => ({
	run_ship_reviewer: { SUCCESS_EXIT_CODE: 0, current_verdict: current_verdict_mock },
}))

// joshuafolkken/kit#7873: a round-2 run is recorded with its outcome, a skip and an unknown outcome without.

const ISSUE = '7873'
const RUN: RoundTwoAnswer = { verdict: 'required', code: 'live', reason: 'live delta' }
const SKIP: RoundTwoAnswer = { verdict: 'skip', code: 'empty', reason: 'no delta' }
const PASSED: StepResult = { code: 0, out: '' }
const FOUND: StepResult = { code: 1, out: '', cause: 'finding' }
const BROKEN: StepResult = { code: 1, out: '', cause: 'infra' }
const BLOCKING: ReviewVerdict = {
	kind: 'blocking',
	specs: ['bug-risks:medium:a.ts:1', 'fixed tests:low:b.ts:2', 'bug-risks:medium:c.ts:3'],
	report: [],
}

function recorded(): unknown {
	return record_round_two_mock.mock.calls.at(-1)?.[0]
}

describe('run_ship_round_two_ledger.record — the round-2 decision and its outcome', () => {
	beforeEach(() => {
		record_round_two_mock.mockClear()
		current_verdict_mock.mockReset()
	})

	it('records a skip without findings', async () => {
		await run_ship_round_two_ledger.record(ISSUE, SKIP)

		expect(recorded()).toStrictEqual({ issue: 7873, verdict: 'skip', code: 'empty' })
	})

	it('records a clean run with no findings as an empty list', async () => {
		current_verdict_mock.mockReturnValue({ kind: 'clean', specs: [], report: [] })

		await run_ship_round_two_ledger.record(ISSUE, RUN, PASSED)

		expect(recorded()).toStrictEqual({
			issue: 7873,
			verdict: 'required',
			code: 'live',
			findings: [],
		})
	})

	it('records a run stopped on findings with each kind once', async () => {
		current_verdict_mock.mockReturnValue(BLOCKING)

		await run_ship_round_two_ledger.record(ISSUE, RUN, FOUND)

		expect(recorded()).toMatchObject({ findings: ['bug-risks:medium', 'tests:low'] })
	})

	it.each([
		['a stop before any verdict', BROKEN, BLOCKING],
		['an unreadable findings file', PASSED, { kind: 'invalid', note: 'missing' }],
	])('leaves findings out on %s', async (_label: string, result: StepResult, verdict: unknown) => {
		current_verdict_mock.mockReturnValue(verdict)

		await run_ship_round_two_ledger.record(ISSUE, RUN, result)

		expect(recorded()).toStrictEqual({ issue: 7873, verdict: 'required', code: 'live' })
	})
})
