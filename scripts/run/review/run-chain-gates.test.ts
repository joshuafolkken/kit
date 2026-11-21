import { metrics_totals } from '#scripts/gate/metrics-totals'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_cli } from './run-chain-cli'

const josh_run_mock = vi.hoisted(() =>
	vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const ISSUE = '7926'
const RUN_REVIEW = 'run:review'
const CHECK_RELATED = 'check:related'
const GROWTH = 'ai_cost.on_demand_bytes merge-base 366026 → current 366149 (+123)'
const SCOPED_REFUSAL = '⛔ scoped checks not green on this tree — test:related'
const REASON = 'a new command'
const ACCEPT = ['--accept-metrics', REASON]
const ACCEPTANCE_CHECK = 'acceptance:check'
const FROM = '--from'
const FROM_REVIEW = [ISSUE, FROM, RUN_REVIEW]
const METRICS_TOTALS = 'metrics-totals'
const FROM_METRICS = [FROM, METRICS_TOTALS]
const STOPPED = 1
const UNPINNED_OK = '--unpinned-ok'

const printed: Array<string> = []

function ran(): ReadonlyArray<string | undefined> {
	return josh_run_mock.mock.calls.map(([argv]) => argv[0])
}

function output(): string {
	return printed.join('\n')
}

// `undefined` passes the totals; a string is the failed run's output.
function totals_answer(failure: string | undefined): ReturnType<typeof vi.spyOn> {
	const result = { output: failure ?? '', exit_code: failure === undefined ? 0 : 1, elapsed_ms: 0 }

	return vi.spyOn(metrics_totals, 'totals_check').mockResolvedValue(result)
}

function recorded(): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(lane_ledger_write, 'record_chain').mockResolvedValue()
}

beforeEach(() => {
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(undefined)
	totals_answer(undefined)
	printed.length = 0

	for (const channel of ['info', 'error'] as const) {
		vi.spyOn(console, channel).mockImplementation((line: string) => {
			printed.push(line)
		})
	}
})

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#7926: a metrics growth asks its reason right after check:related.
describe('run_chain_gates — the metrics growth', () => {
	it('stops after check:related, before run:review, asking for the reason (ac-64bc9e6f)', async () => {
		totals_answer(GROWTH)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(STOPPED)

		expect(ran()).toContain(CHECK_RELATED)
		expect(ran()).not.toContain(RUN_REVIEW)
		expect(ran()).not.toContain(ACCEPTANCE_CHECK)
		expect(output()).toContain(GROWTH)
		expect(output()).toContain('stopped at metrics-totals (a metrics total grew past its approval)')
		expect(output()).toContain(
			'`pnpm josh run:chain 7926 --accept-metrics "<why>" --from metrics-totals`',
		)
	})

	it('keeps a given --unpinned-ok reason, quoted, in the rerun it prints', async () => {
		totals_answer(GROWTH)

		await run_chain_cli.run([ISSUE, UNPINNED_OK, 'only logs'])

		expect(output()).toContain(
			'`pnpm josh run:chain 7926 --unpinned-ok \'only logs\' --accept-metrics "<why>" --from metrics-totals`',
		)
	})

	it('quotes a reason holding a $ and a backtick so a pasted rerun expands neither', async () => {
		totals_answer(GROWTH)

		await run_chain_cli.run([ISSUE, UNPINNED_OK, 'costs $HOME `id`'])

		expect(output()).toContain("--unpinned-ok 'costs $HOME `id`' --accept-metrics")
	})
})

describe('run_chain_gates — the resume after a metrics growth', () => {
	it('resumes with the reason through to run:review, which receives it (ac-64bc9e6f)', async () => {
		const totals = totals_answer(GROWTH)

		await expect(run_chain_cli.run([ISSUE, ...ACCEPT, ...FROM_METRICS])).resolves.toBe(0)

		expect(totals).not.toHaveBeenCalled()
		expect(josh_run_mock.mock.calls.at(-1)?.[0]).toStrictEqual([RUN_REVIEW, ...ACCEPT])
	})

	it('stops again on a resume with no reason (ac-eb12ed7d)', async () => {
		totals_answer(GROWTH)

		await expect(run_chain_cli.run([ISSUE, ...FROM_METRICS])).resolves.toBe(STOPPED)

		expect(ran()).not.toContain(RUN_REVIEW)
	})

	it('goes on to run:review when no total grew', async () => {
		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(0)

		expect(ran().at(-1)).toBe(RUN_REVIEW)
	})
})

// joshuafolkken/kit#7926: a --from run:review entry asks the scoped checks before any stage.
describe('run_chain_gates — the --from run:review entry', () => {
	it('refuses a tree whose scoped checks are not green without running run:review (ac-0f48f439)', async () => {
		vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(SCOPED_REFUSAL)

		await expect(run_chain_cli.run(FROM_REVIEW)).resolves.toBe(STOPPED)

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(output()).toContain(SCOPED_REFUSAL)
		expect(output()).toContain('`pnpm josh run:chain 7926 --from check:related`')
	})

	it('runs run:review on a green tree', async () => {
		await expect(run_chain_cli.run(FROM_REVIEW)).resolves.toBe(0)

		expect(ran()).toStrictEqual([RUN_REVIEW])
	})

	it.each([
		['--join', ['--join']],
		['--join --fixing', ['--join', '--fixing']],
	])('asks nothing of the scoped checks on %s --from run:review', async (_label, join) => {
		const scoped = vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(SCOPED_REFUSAL)

		// The join's run:review fails, so the run stops there and no later stage writes to the repository.
		josh_run_mock.mockResolvedValue({ code: STOPPED, out: '' })
		await run_chain_cli.run([...FROM_REVIEW, ...join])

		expect(scoped).not.toHaveBeenCalled()
		expect(ran()).toStrictEqual([RUN_REVIEW])
	})

	it('asks nothing of the scoped checks on any other entry', async () => {
		const scoped = vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(SCOPED_REFUSAL)

		await run_chain_cli.run([ISSUE, FROM, ACCEPTANCE_CHECK])

		expect(scoped).not.toHaveBeenCalled()
		expect(ran().at(-1)).toBe(RUN_REVIEW)
	})
})

// joshuafolkken/kit#7926: the ledger line tells the two procedural stops from a real failure.
describe('run_chain_gates — the ledger line (ac-306555cd)', () => {
	it.each([
		['metrics-growth', [ISSUE], METRICS_TOTALS],
		['scoped-not-green', FROM_REVIEW, 'scoped-green'],
	])('records a %s stop with its exit code', async (refusal, argv, stage) => {
		const record = recorded()

		totals_answer(GROWTH)
		vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(SCOPED_REFUSAL)
		await run_chain_cli.run(argv)

		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({ stage, reason: 'hold', exit_code: 0, refusal }),
		)
	})

	it('records a failed stage with its exit code and no refusal kind', async () => {
		const record = recorded()

		josh_run_mock.mockImplementation(async (argv) => ({
			code: argv[0] === CHECK_RELATED ? 2 : 0,
			out: '',
		}))
		await run_chain_cli.run([ISSUE])

		expect(record).toHaveBeenCalledWith(
			expect.not.objectContaining({ refusal: expect.anything() as unknown }),
		)
		expect(record).toHaveBeenCalledWith(expect.objectContaining({ exit_code: 2 }))
	})
})
