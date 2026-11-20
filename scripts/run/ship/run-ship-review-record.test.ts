import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_review } from './run-ship-review'

const josh_mock = vi.hoisted(() => vi.fn())
const scoped_pair_mock = vi.hoisted(() => vi.fn())
const verdict_text = vi.hoisted(() => ({ value: '' as string | undefined }))
const stop_log_record = vi.hoisted(() => vi.fn())

vi.mock('./run-ship-reviewer', async (import_original) => {
	const { run_ship_reviewer } = await import_original<Record<'run_ship_reviewer', object>>()
	const { run_ship_review: review } = await import('./run-ship-review')

	return {
		run_ship_reviewer: {
			...run_ship_reviewer,
			current_verdict: () => review.read_verdict(verdict_text.value),
			josh: josh_mock,
		},
	}
})
vi.mock('./run-ship-scoped', () => ({
	run_ship_scoped: { run_phases: vi.fn(), scoped_pair: scoped_pair_mock },
}))
vi.mock('#scripts/review/review-stop-log', () => ({
	review_stop_log: { record: stop_log_record, read: () => [] },
}))

const { run_ship_review_record } = await import('./run-ship-review-record')

const ISSUE = '8385'
const FIXED_MEDIUM = 'fixed bug-risks:medium:a.ts:7 — misses a null. More prose.'
const BLOCKING_HIGH = 'bug-risks:high:a.ts:7 — misses a null. More prose.'
const PASSING = { is_passing: true, note: 'ok' }
const STOPPING = { is_passing: false, note: 'stop' }

beforeEach(() => {
	josh_mock.mockReset().mockResolvedValue({ code: 0, out: '' })
	scoped_pair_mock.mockReset().mockResolvedValue({ code: 0, out: '' })
	stop_log_record.mockClear()
	verdict_text.value = ''
})

describe('run_ship_review_record.record_flags', () => {
	it('adds --comment to a passing round 2 only', () => {
		expect(run_ship_review_record.record_flags('2', PASSING)).toStrictEqual(['--comment'])
		expect(run_ship_review_record.record_flags('2', STOPPING)).toStrictEqual([])
		expect(run_ship_review_record.record_flags('1', PASSING)).toStrictEqual([])
	})
})

describe('run_ship_review_record.outcome_for_round', () => {
	it('judges a fixed verdict by its round', () => {
		const verdict = run_ship_review.read_verdict(FIXED_MEDIUM)

		if (verdict.kind === run_ship_review.VERDICT.INVALID) throw new Error(verdict.note)

		expect(run_ship_review_record.outcome_for_round('1', verdict).is_passing).toBe(true)
		expect(run_ship_review_record.outcome_for_round('2', verdict).is_passing).toBe(false)
	})
})

describe('run_ship_review_record.is_fix_verified', () => {
	it('passes a round with no fix without the scoped pair', async () => {
		expect(await run_ship_review_record.is_fix_verified(['code'])).toBe(true)
		expect(scoped_pair_mock).not.toHaveBeenCalled()
	})

	it('counts a fix only once the scoped pair is green', async () => {
		verdict_text.value = FIXED_MEDIUM
		scoped_pair_mock.mockResolvedValue({ code: 1, out: 'red' })

		expect(await run_ship_review_record.is_fix_verified(['code'])).toBe(false)
	})
})

describe('run_ship_review_record.record_and_route', () => {
	it('records the interaction slot with --interaction and passes a clean round', async () => {
		const result = await run_ship_review_record.record_and_route(
			ISSUE,
			'1',
			run_ship_review.round_one_outcome,
			'interaction',
		)

		expect(result.code).toBe(0)
		expect(josh_mock).toHaveBeenCalledWith(['review:record', '--issue', ISSUE, '--interaction'])
		expect(stop_log_record).toHaveBeenCalledOnce()
	})

	it('stops a blocking round as a finding', async () => {
		verdict_text.value = BLOCKING_HIGH

		const result = await run_ship_review_record.record_and_route(
			ISSUE,
			'1',
			run_ship_review.round_one_outcome,
		)

		expect(result).toHaveProperty('cause', 'finding')
	})

	it('stops an unreadable verdict as infra without recording', async () => {
		verdict_text.value = undefined

		const result = await run_ship_review_record.record_and_route(
			ISSUE,
			'1',
			run_ship_review.round_one_outcome,
		)

		expect(result).toHaveProperty('cause', 'infra')
		expect(josh_mock).not.toHaveBeenCalled()
	})
})
