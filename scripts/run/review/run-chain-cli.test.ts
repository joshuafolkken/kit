import { split_resolution } from '#scripts/split/split-resolution'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_cli } from './run-chain-cli'

const josh_run_mock = vi.hoisted(() =>
	vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const SPLIT_REFUSAL = 'split notice unresolved: record a reason or file a split child'
const ISSUE_NUMBER = 5630

const MAIN_MERGE = 'main:merge'
const SELFCHECK = 'review:selfcheck'
const CHECK_RELATED = 'check:related'
const RUN_REVIEW = 'run:review'
const RUN_CUT = 'run:cut'
const ISSUE = '5630'
const FROM = '--from'
const MAIN_LINE = [[MAIN_MERGE], [SELFCHECK], [CHECK_RELATED], [RUN_REVIEW]]
const STOP_EXIT = 2
const UNPINNED_OK = ['--unpinned-ok', 'only logs']
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
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(split_resolution, 'ledger_refusal').mockResolvedValue(undefined)
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
	it('runs main:merge, the self-check, the scoped pair and run:review in order', async () => {
		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(0)

		expect(ran()).toStrictEqual(MAIN_LINE)
		expect(info_lines).toContain(
			'run:chain 5630 — ran main:merge → review:selfcheck → check:related → run:review',
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

describe('run_chain_cli.run — main:merge', () => {
	it('stops on a refused main:merge and points at settling it before a full rerun', async () => {
		stop_at(MAIN_MERGE)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(1)

		expect(ran()).toStrictEqual([[MAIN_MERGE]])
		expect(error_lines.join('\n')).toContain(
			'next: settle what `main:merge` refused (`chain-rule.md` → "Orchestration facts single-sourced here"), then rerun `pnpm josh run:chain 5630`',
		)
	})

	it('holds after main:merge on an unanswered split notice, before the review stages', async () => {
		vi.mocked(split_resolution.ledger_refusal).mockResolvedValue(SPLIT_REFUSAL)

		await expect(run_chain_cli.run([ISSUE])).resolves.toBe(1)

		expect(split_resolution.ledger_refusal).toHaveBeenCalledWith(ISSUE_NUMBER)
		expect(ran()).toStrictEqual([[MAIN_MERGE]])
		expect(error_lines.join('\n')).toContain(`stopped at main:merge (${SPLIT_REFUSAL})`)
		expect(error_lines.join('\n')).toContain(
			'issue `pnpm josh run:cut 5630` alone again, then rerun `pnpm josh run:chain 5630 --from review:selfcheck`',
		)
	})
})

describe('run_chain_cli.run — resume and forwarding', () => {
	it('resumes at the stage --from names', async () => {
		await expect(run_chain_cli.run([ISSUE, FROM, RUN_REVIEW])).resolves.toBe(0)

		expect(ran()).toStrictEqual([[RUN_REVIEW]])
	})

	it('forwards --unpinned-ok to run:review alone', async () => {
		await run_chain_cli.run([ISSUE, ...UNPINNED_OK])

		expect(ran().at(-1)).toStrictEqual([RUN_REVIEW, ...UNPINNED_OK])
		expect(ran()[0]).toStrictEqual([MAIN_MERGE])
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
	])('refuses %s with the usage and runs nothing', async (_label, argv) => {
		await expect(run_chain_cli.run(argv)).resolves.toBe(1)

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(error_lines.join('\n')).toContain(run_chain_cli.USAGE)
	})

	it('names the --join form in the usage', () => {
		expect(run_chain_cli.USAGE).toContain('<N> --join [--fixing] [--from <stage>]')
	})

	it('refuses a --from no stage carries and runs nothing', async () => {
		await expect(run_chain_cli.run([ISSUE, FROM, RUN_CUT])).resolves.toBe(1)

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(error_lines.join('\n')).toContain('no stage run:cut')
	})
})
