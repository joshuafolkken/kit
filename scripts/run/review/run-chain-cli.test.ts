import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_cli } from './run-chain-cli'

const josh_run_mock = vi.hoisted(() =>
	vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const MAIN_MERGE = 'main:merge'
const SELFCHECK = 'review:selfcheck'
const CHECK_RELATED = 'check:related'
const ACCEPTANCE_CHECK = 'acceptance:check'
const RUN_REVIEW = 'run:review'
const RUN_CUT = 'run:cut'
const ISSUE = '5630'
const FROM = '--from'
const MAIN_LINE = [[MAIN_MERGE], [SELFCHECK], [CHECK_RELATED], [ACCEPTANCE_CHECK], [RUN_REVIEW]]
const STOP_EXIT = 2
const UNPINNED_OK = ['--unpinned-ok', 'only logs']
const ACCEPT_METRICS = ['--accept-metrics', 'a new command']
const TITLE = 'Title #5630'
const RESUME_PAST_SELFCHECK = '`pnpm josh run:chain 5630 --from check:related`'

const info_lines: Array<string> = []
const error_lines: Array<string> = []

function ran(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map(([argv]) => argv)
}

function stop_at(name: string): void {
	josh_run_mock.mockImplementation(async (argv) => ({
		code: argv[0] === name ? STOP_EXIT : 0,
		out: `${String(argv[0])} out`,
	}))
}

beforeEach(() => {
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValue({ code: 0, out: '' })
	info_lines.length = 0
	error_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		error_lines.push(line)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_chain_cli.run — the chain', () => {
	it('runs main:merge, the self-check, the scoped pair, the acceptance map and run:review in order', async () => {
		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(0)

		expect(ran()).toStrictEqual(MAIN_LINE)
		expect(info_lines).toContain(
			'run:chain 5630 — ran main:merge → review:selfcheck → check:related → acceptance:check → run:review',
		)
	})

	it('runs the review stages without main:merge in a lane child', async () => {
		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(true)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(0)

		expect(ran()).toStrictEqual(MAIN_LINE.slice(1))
		expect(info_lines).toContain(
			'run:chain 5630 — ran review:selfcheck → check:related → acceptance:check → run:review',
		)
	})

	it('stops at the first stage that exits non-zero and prints its next action', async () => {
		stop_at(CHECK_RELATED)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(1)

		expect(ran()).toStrictEqual(MAIN_LINE.slice(0, 3))
		expect(info_lines).toContain('check:related out')
		expect(error_lines.join('\n')).toContain('run:chain 5630 — stopped at check:related (exit 2)')
		expect(error_lines.join('\n')).toContain(RESUME_PAST_SELFCHECK)
	})

	it('offers a self-check hit that is no defect the resume past it', async () => {
		stop_at(SELFCHECK)

		await run_chain_cli.run([ISSUE])

		expect(error_lines.join('\n')).toContain('rerun `pnpm josh run:chain 5630`;')
		expect(error_lines.join('\n')).toContain(RESUME_PAST_SELFCHECK)
	})
})

// joshuafolkken/kit#7727: ship's acceptance-map refusal asked before the review, not at ship's preflight.
describe('run_chain_cli.run — acceptance:check', () => {
	it('stops on a missing acceptance-map row before run:review, naming the resume at acceptance:check', async () => {
		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(true)
		stop_at(ACCEPTANCE_CHECK)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(1)

		expect(ran()).not.toContainEqual([RUN_REVIEW])
		expect(error_lines.join('\n')).toContain(
			'run:chain 5630 — stopped at acceptance:check (exit 2)',
		)
		expect(error_lines.join('\n')).toContain('`pnpm josh run:chain 5630 --from acceptance:check`')
	})
})

describe('run_chain_cli.run — main:merge', () => {
	it('stops on a refused main:merge and points at settling it before a full rerun', async () => {
		stop_at(MAIN_MERGE)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(1)

		expect(ran()).toStrictEqual([[MAIN_MERGE]])
		expect(error_lines.join('\n')).toContain(
			'next: settle what `main:merge` refused (`chain-rule.md` → "Orchestration facts single-sourced here"), then rerun `pnpm josh run:chain 5630`',
		)
	})

	// joshuafolkken/kit#7183: `lane:plan` warned once, so the chain reads no split notice and repeats none.
	it('goes on past main:merge to the review stages without repeating a size notice', async () => {
		const target = vi.spyOn(lane_ledger, 'target')

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(0)

		expect(ran()).toStrictEqual(MAIN_LINE)
		expect(target).not.toHaveBeenCalled()
		expect(error_lines.join('\n')).not.toMatch(/size warning|split notice/u)
	})
})

describe('run_chain_cli.run — resume and forwarding', () => {
	it('resumes at the stage --from names', async () => {
		await expect(run_chain_cli.run([ISSUE, FROM, RUN_REVIEW])).resolves.toBe(0)

		expect(ran()).toStrictEqual([[RUN_REVIEW]])
	})

	it('resumes at acceptance:check, then runs run:review', async () => {
		await expect(run_chain_cli.run([ISSUE, FROM, ACCEPTANCE_CHECK])).resolves.toBe(0)

		expect(ran()).toStrictEqual([[ACCEPTANCE_CHECK], [RUN_REVIEW]])
	})

	it('forwards --unpinned-ok to run:review alone', async () => {
		await run_chain_cli.run([ISSUE, ...UNPINNED_OK])

		expect(ran().at(-1)).toStrictEqual([RUN_REVIEW, ...UNPINNED_OK])
		expect(ran()[0]).toStrictEqual([MAIN_MERGE])
	})

	// joshuafolkken/kit#7599: the metrics accept reason rides the same way, in one pass.
	it('forwards --accept-metrics to run:review alone, beside --unpinned-ok', async () => {
		await run_chain_cli.run([ISSUE, ...UNPINNED_OK, ...ACCEPT_METRICS])

		expect(ran().at(-1)).toStrictEqual([RUN_REVIEW, ...UNPINNED_OK, ...ACCEPT_METRICS])
		expect(ran().slice(0, -1).flat()).not.toContain(ACCEPT_METRICS[0])
	})
})

describe('run_chain_cli.run — refusals', () => {
	it.each([
		['no issue', []],
		['two issues', [ISSUE, '5631']],
		['a non-number', ['abc']],
		['an unknown flag', [ISSUE, '--bogus']],
		['--fixing without --join', [ISSUE, '--fixing']],
		['--unpinned-ok on the join', [ISSUE, '--join', ...UNPINNED_OK]],
		['--accept-metrics on the join', [ISSUE, '--join', ...ACCEPT_METRICS]],
		['--ship without --join', [ISSUE, '--ship', TITLE]],
		['--ship without a title', [ISSUE, '--join', '--ship']],
		['--ship without an issue suffix', [ISSUE, '--join', '--ship', 'Title']],
		['--ship for another issue', [ISSUE, '--join', '--ship', 'Title #5631']],
		['--ship with opening flags', [ISSUE, '--join', '--ship', TITLE, ...UNPINNED_OK]],
	])('refuses %s with the usage and runs nothing', async (_label, argv) => {
		await expect(run_chain_cli.run(argv)).resolves.toBe(1)

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(error_lines.join('\n')).toContain(run_chain_cli.USAGE)
	})

	it('names the --accept-metrics reason in the usage', () => {
		expect(run_chain_cli.USAGE).toContain('[--accept-metrics "<reason>"]')
	})

	it('names the --join form in the usage', () => {
		expect(run_chain_cli.USAGE).toContain('<N> --join [--fixing] [--from <stage>]')
		expect(run_chain_cli.USAGE).toContain('[--ship "<title> #<N>"]')
	})

	it('refuses a --from no stage carries and runs nothing', async () => {
		await expect(run_chain_cli.run([ISSUE, FROM, RUN_CUT])).resolves.toBe(1)

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(error_lines.join('\n')).toContain('no stage run:cut')
	})
})

// joshuafolkken/kit#7024: every run writes one `chain` ledger line, a stop naming its stage and reason.
function recorded(): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(lane_ledger_write, 'record_chain').mockResolvedValue()
}

describe('run_chain_cli.run — the ledger line', () => {
	it('records a stage that exited non-zero as an exit stop at that stage', async () => {
		const record = recorded()

		stop_at(CHECK_RELATED)
		await run_chain_cli.run([ISSUE])

		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({ issue: 5630, join: false, stage: CHECK_RELATED, reason: 'exit' }),
		)
	})

	it('records a finished run with no stage or reason', async () => {
		const record = recorded()

		await run_chain_cli.run([ISSUE])

		expect(record).toHaveBeenCalledWith({
			issue: 5630,
			join: false,
			elapsed_ms: expect.any(Number) as number,
			stages: expect.any(Array) as Array<unknown>,
		})
	})

	// joshuafolkken/kit#7736: the line carries each stage that ran, the stopped one last.
	it('records the stages that ran through the stopped one', async () => {
		const record = recorded()

		stop_at(CHECK_RELATED)
		await run_chain_cli.run([ISSUE, FROM, CHECK_RELATED])

		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({
				stages: [expect.objectContaining({ name: CHECK_RELATED }) as unknown],
			}),
		)
	})

	it('records nothing when the arguments are refused', async () => {
		const record = recorded()

		await run_chain_cli.run([ISSUE, FROM, RUN_CUT])

		expect(record).not.toHaveBeenCalled()
	})
})
