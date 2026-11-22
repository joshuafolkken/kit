import { derive_check } from '#scripts/document/derive-check'
import { lane_ledger_write_chain_stage } from '#scripts/lane/lane-ledger-write-chain-stage'
import { describe, expect, it, vi } from 'vitest'
import { run_chain, type ChainStage, type StageRunner } from './run-chain'
import { run_review } from './run-review'

const SELFCHECK = 'review:selfcheck'
const CHECK_RELATED = 'check:related'
const ACCEPTANCE_CHECK = 'acceptance:check'
const PREFLIGHT_CHECK = 'preflight:check'
const EXPORTS_UNUSED = 'exports:unused'
const GUARD_TESTS = 'guard-tests'
const BEFORE_REVIEW = [ACCEPTANCE_CHECK, PREFLIGHT_CHECK, EXPORTS_UNUSED, GUARD_TESTS]
const RUN_REVIEW = 'run:review'
const RUN_CUT = 'run:cut'
const [DERIVE_CHECK] = derive_check.DERIVE_CHECK_ARGV
const ISSUE = '5630'
const STOP_EXIT = 2
const STAGE_MS = 7_200_000
const START_MS = Date.parse('2026-01-01T00:00:00.000Z')

function stage_named(name: string): ChainStage {
	const stage = run_chain.main_line_stages([], false).find((candidate) => candidate.name === name)

	if (stage === undefined) throw new Error(`no stage ${name}`)

	return stage
}

describe('run_chain', () => {
	it('keeps main:merge out of the review stages a lane child runs', () => {
		expect(run_chain.review_stages([], false).map((stage) => stage.name)).toStrictEqual([
			SELFCHECK,
			CHECK_RELATED,
			...BEFORE_REVIEW,
			RUN_REVIEW,
		])
	})

	it('never carries run:cut, which is issued alone', () => {
		const argv = run_chain.main_line_stages([], true).flatMap((stage) => stage.argv)

		expect(argv).not.toContain(RUN_CUT)
	})

	it('answers undefined for a --from no stage carries', () => {
		expect(run_chain.stages_from(run_chain.main_line_stages([], false), RUN_CUT)).toBeUndefined()
	})
})

describe('run_chain — a run', () => {
	it('times each stage that ran in order, the stopped stage included', async () => {
		const runner = vi.fn<StageRunner>(async (argv) => ({
			code: argv[0] === CHECK_RELATED ? STOP_EXIT : 0,
			out: '',
		}))
		const stages = run_chain.review_stages([], false)
		const chain = await run_chain.run_stages(stages, ISSUE, vi.fn(), runner)

		expect(chain.stop?.stage.name).toBe(CHECK_RELATED)
		expect(chain.stages.map((stage) => stage.name)).toStrictEqual([SELFCHECK, CHECK_RELATED])
		expect(chain.stages.every((stage) => stage.elapsed_ms >= 0)).toBe(true)
		expect(chain.stages.map((stage) => Number.isNaN(Date.parse(stage.at)))).toStrictEqual([
			false,
			false,
		])
	})

	it('runs no command for a stage with no argv, only its hold', async () => {
		const runner = vi.fn<StageRunner>(async () => ({ code: 0, out: '' }))
		const hold = vi.fn(async () => ({ notice: 'held', next: () => 'fix it' }))
		const stage: ChainStage = { name: 'recheck', argv: [], next: () => '', hold }
		const chain = await run_chain.run_stages([stage], ISSUE, vi.fn(), runner)

		expect(runner).not.toHaveBeenCalled()
		expect(hold).toHaveBeenCalledWith(ISSUE)
		expect(chain.stop?.notice).toBe('held')
	})
})

// joshuafolkken/kit#8286: a ledger line per stage as it ends, the stopped stage's included.
describe('run_chain — the chain-stage ledger lines', () => {
	it('appends one chain-stage line as each stage ends, the stopped one marked stopped', async () => {
		const record = vi
			.spyOn(lane_ledger_write_chain_stage, 'record_chain_stage')
			.mockResolvedValue(undefined)
		const runner = vi.fn<StageRunner>(async (argv) => ({
			code: argv[0] === CHECK_RELATED ? STOP_EXIT : 0,
			out: '',
		}))

		await run_chain.run_stages(run_chain.review_stages([], false), ISSUE, vi.fn(), runner)

		expect(record.mock.calls.map(([line]) => [line.issue, line.name, line.result])).toStrictEqual([
			[Number(ISSUE), SELFCHECK, 'passed'],
			[Number(ISSUE), CHECK_RELATED, 'stopped'],
		])
		expect(record.mock.calls.every(([line]) => !Number.isNaN(Date.parse(line.at)))).toBe(true)
		record.mockRestore()
	})
})

// The ledger tail scans back by `at`, so a line dated at a long stage's start would stop it early.
describe('run_chain — the chain-stage line date', () => {
	it('dates each chain-stage line at its stage end, the chain entry at its start', async () => {
		const record = vi
			.spyOn(lane_ledger_write_chain_stage, 'record_chain_stage')
			.mockResolvedValue(undefined)

		vi.useFakeTimers({ toFake: ['Date'], now: START_MS })
		const runner = vi.fn<StageRunner>(async () => {
			vi.setSystemTime(START_MS + STAGE_MS)

			return { code: 0, out: '' }
		})
		const chain = await run_chain.run_stages([stage_named(SELFCHECK)], ISSUE, vi.fn(), runner)

		vi.useRealTimers()
		expect(chain.stages).toStrictEqual([
			{ name: SELFCHECK, at: new Date(START_MS).toISOString(), elapsed_ms: STAGE_MS },
		])
		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({ at: new Date(START_MS + STAGE_MS).toISOString() }),
		)
		record.mockRestore()
	})
})

describe('run_chain — a held stage and the reports', () => {
	it('marks a stage stopped on a hold', async () => {
		const record = vi
			.spyOn(lane_ledger_write_chain_stage, 'record_chain_stage')
			.mockResolvedValue(undefined)
		const hold = vi.fn(async () => ({ notice: 'on hold', next: () => '' }))
		const stage: ChainStage = { name: RUN_REVIEW, argv: [], next: () => '', hold }

		await run_chain.run_stages([stage], ISSUE, vi.fn())

		expect(record.mock.calls.map(([line]) => line.result)).toStrictEqual(['stopped'])
		record.mockRestore()
	})

	// joshuafolkken/kit#8705: a wait cut at the chunk is no stop.
	it('marks a stage whose wait was cut at the chunk pending, not stopped', async () => {
		const record = vi
			.spyOn(lane_ledger_write_chain_stage, 'record_chain_stage')
			.mockResolvedValue(undefined)
		const stage: ChainStage = { name: RUN_REVIEW, argv: [RUN_REVIEW], next: () => '' }
		const runner = vi.fn<StageRunner>(async () => ({
			code: run_review.PENDING_EXIT_CODE,
			out: '',
		}))

		await run_chain.run_stages([stage], ISSUE, vi.fn(), runner)

		expect(record.mock.calls.map(([line]) => line.result)).toStrictEqual(['pending'])
		record.mockRestore()
	})

	it('opens the stop report with the invocation, not an Issue citation', () => {
		const stage = stage_named(RUN_REVIEW)
		const stop = { stage, code: STOP_EXIT, next: stage.next }

		expect(run_chain.stop_report(stop, ISSUE)).toMatch(/^run:chain 5630 — stopped at run:review/u)
	})
})

// joshuafolkken/kit#7728: a hand-edited generated page stops the chain before the review.
describe('run_chain — the generated pages', () => {
	const stages = run_chain.review_stages([], true)

	it('checks them in kit just before run:review, with the argv the pre-detach runs', () => {
		expect(stages.map((stage) => stage.name)).toStrictEqual([
			SELFCHECK,
			CHECK_RELATED,
			DERIVE_CHECK,
			...BEFORE_REVIEW,
			RUN_REVIEW,
		])
		expect(stages.map((stage) => stage.argv)).toContainEqual(derive_check.DERIVE_CHECK_ARGV)
	})

	it('stops at the check without running run:review when a page drifted', async () => {
		const runner = vi.fn<StageRunner>(async (argv) => ({
			code: argv[0] === DERIVE_CHECK ? STOP_EXIT : 0,
			out: '',
		}))
		const chain = await run_chain.run_stages(stages, ISSUE, vi.fn(), runner)

		expect(chain.stop?.stage.name).toBe(DERIVE_CHECK)
		expect(runner).not.toHaveBeenCalledWith([RUN_REVIEW])
	})

	it('runs through run:review when the pages match', async () => {
		const runner = vi.fn<StageRunner>(async () => ({ code: 0, out: '' }))
		const chain = await run_chain.run_stages(stages, ISSUE, vi.fn(), runner)

		expect(chain.stop).toBeUndefined()
		expect(runner).toHaveBeenCalledWith([RUN_REVIEW])
	})
})

// joshuafolkken/kit#7727: ship's acceptance-map refusal asked before the review.
describe('run_chain — acceptance:check', () => {
	it('asks the acceptance map before run:review in the lane child and main line lists', () => {
		for (const stages of [
			run_chain.review_stages([], true),
			run_chain.main_line_stages([], true),
		]) {
			const names = stages.map((stage) => stage.name)

			expect(names.indexOf(ACCEPTANCE_CHECK)).toBe(names.indexOf(PREFLIGHT_CHECK) - 1)
			expect(names.indexOf(ACCEPTANCE_CHECK)).toBeLessThan(names.indexOf(RUN_REVIEW))
		}
	})

	it('resumes a stop at acceptance:check from that stage', () => {
		const stage = stage_named(ACCEPTANCE_CHECK)
		const stop = { stage, code: STOP_EXIT, next: stage.next }

		expect(run_chain.stop_report(stop, ISSUE)).toContain(
			'`pnpm josh run:chain 5630 --from acceptance:check`',
		)
	})
})

// joshuafolkken/kit#7773: ship's remaining preflight and pre-detach refusals asked before the review.
describe('run_chain — the ship refusals before the review', () => {
	const stages = run_chain.review_stages([], true)

	it.each([PREFLIGHT_CHECK, EXPORTS_UNUSED, GUARD_TESTS])(
		'stops at %s without running run:review, resuming from it',
		async (name) => {
			const stage = stage_named(name)
			const [command] = stage.argv
			const runner = vi.fn<StageRunner>(async (argv) => ({
				code: argv[0] === command ? STOP_EXIT : 0,
				out: '',
			}))
			const chain = await run_chain.run_stages(stages, ISSUE, vi.fn(), runner)

			expect(chain.stop?.stage.name).toBe(name)
			expect(runner).not.toHaveBeenCalledWith([RUN_REVIEW])
			expect(run_chain.stop_report({ stage, code: STOP_EXIT, next: stage.next }, ISSUE)).toContain(
				`--from ${name}\``,
			)
		},
	)

	it('runs the ship pre-detach argv for exports:unused and the guard tests', () => {
		expect(stage_named(EXPORTS_UNUSED).argv).toStrictEqual([EXPORTS_UNUSED])
		expect(stage_named(GUARD_TESTS).argv.slice(0, 2)).toStrictEqual([
			'test:unit',
			'--passWithNoTests',
		])
	})

	it('runs through run:review when every refusal passes', async () => {
		const runner = vi.fn<StageRunner>(async () => ({ code: 0, out: '' }))
		const chain = await run_chain.run_stages(stages, ISSUE, vi.fn(), runner)

		expect(chain.stop).toBeUndefined()
		expect(runner).toHaveBeenCalledWith([PREFLIGHT_CHECK])
		expect(runner).toHaveBeenLastCalledWith([RUN_REVIEW])
	})
})
