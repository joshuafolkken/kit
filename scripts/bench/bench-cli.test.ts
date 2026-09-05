import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { time_distribution } from '#scripts/time/time-distribution'
import { describe, expect, it } from 'vitest'
import { bench_cli } from './bench-cli'
import { bench_interrupt } from './bench-interrupt'
import type { BenchReport, BenchRow } from './bench-report'
import { bench_targets } from './bench-targets'

const COMMAND_NAME = 'bench'
const SCRIPT_PATH = 'scripts/bench/bench-cli.ts'
const UNKNOWN_TARGET = 'lint:staged'

function row(cold_ms: ReadonlyArray<number>): BenchRow {
	return {
		target: 'lint',
		caches: [],
		failures: 0,
		cold: time_distribution.build(cold_ms),
		warm: time_distribution.build(cold_ms),
		speedup: undefined,
	}
}

function report(rows: ReadonlyArray<BenchRow>, is_interrupted = false): BenchReport {
	return { rows, notes: [], is_interrupted }
}

describe('josh bench — registration', () => {
	it('registers the command against its CLI script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe(SCRIPT_PATH)
	})

	it('registers the command in a category', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.category).toBe('AI tools')
	})

	it('registers the short alias', () => {
		const { bn } = ALIASES

		expect(bn).toBe(COMMAND_NAME)
	})
})

describe('josh bench — reading the command line', () => {
	it('measures the default set once when nothing is asked for', () => {
		expect(bench_cli.parse_options([])).toStrictEqual({
			is_json: false,
			repetitions: 1,
			names: [],
		})
	})

	it('carries the named targets through in order', () => {
		expect(bench_cli.parse_options(['gate', 'lint'])?.names).toStrictEqual(['gate', 'lint'])
	})

	it('accepts --json', () => {
		expect(bench_cli.parse_options(['--json'])?.is_json).toBe(true)
	})

	it('accepts a repetition count inside the range', () => {
		expect(bench_cli.parse_options(['--repeat', '3'])?.repetitions).toBe(3)
	})

	// The ceiling is a bound on the wall clock, not a style rule: one repetition of the whole default
	// set is already two runs of every gate check, and the cold lint alone is measured in minutes.
	it('refuses a repetition count above the ceiling', () => {
		const above = String(bench_cli.MAX_REPETITIONS + 1)

		expect(bench_cli.parse_options(['--repeat', above])).toBeUndefined()
	})

	it('refuses a repetition count below one', () => {
		expect(bench_cli.parse_options(['--repeat', '0'])).toBeUndefined()
	})

	it('refuses a repetition count that is not a whole number', () => {
		expect(bench_cli.parse_options(['--repeat', '2.5'])).toBeUndefined()
		expect(bench_cli.parse_options(['--repeat', 'many'])).toBeUndefined()
	})

	it('refuses an option it does not define', () => {
		expect(bench_cli.parse_options(['--fast'])).toBeUndefined()
	})

	it('names the repetition range in its usage line', () => {
		expect(bench_cli.USAGE).toContain(String(bench_cli.MAX_REPETITIONS))
	})
})

// `build` refuses before it starts a single child process, which is what lets this be a unit test:
// an unknown name never reaches the measuring half at all.
describe('josh bench — an unrecognized target measures nothing', () => {
	it('answers with no report rather than falling back to the default set', async () => {
		const options = { is_json: false, repetitions: 1, names: [UNKNOWN_TARGET] }

		await expect(bench_cli.build(options, process.cwd())).resolves.toBeUndefined()
	})

	it('has a target for every name it would print in the refusal', () => {
		for (const target of bench_targets.BENCH_TARGETS) {
			expect(bench_targets.find_target(target.name)).toBeDefined()
		}
	})
})

// The command's whole product is the figures, so a run that produced none has failed at what it was
// asked to do — and a `--json` consumer reading success off the exit code would take an empty report
// for an answer.
describe('josh bench — a report of nothing is not a success', () => {
	it('succeeds where at least one row was measured', () => {
		const mixed = report([row([1000]), row([])])

		expect(bench_cli.exit_code_for(mixed)).toBe(0)
	})

	it('fails where every row says not measured', () => {
		const nothing = report([row([]), row([])])

		expect(bench_cli.exit_code_for(nothing)).toBe(1)
	})

	it('fails where there is no row at all', () => {
		expect(bench_cli.exit_code_for(report([]))).toBe(1)
	})
})

// `0` means every target the command was asked for was measured, `1` keeps the meaning it has
// everywhere in this package — the measurement itself produced nothing usable — and the third value
// says the figures above it are real but incomplete (joshuafolkken/kit#1369, inside the family
// joshuafolkken/kit#1352 established).
describe('josh bench — an interrupted run is told apart from a failed one', () => {
	it('marks an interruption with neither the success code nor the plain failure one', () => {
		expect(bench_interrupt.INTERRUPTED_EXIT_CODE).not.toBe(0)
		expect(bench_interrupt.INTERRUPTED_EXIT_CODE).not.toBe(1)
	})

	it('marks a run a gate stopped after it had measured something', () => {
		const partial = report([row([1000]), row([])], true)

		expect(bench_cli.exit_code_for(partial)).toBe(bench_interrupt.INTERRUPTED_EXIT_CODE)
	})

	// The reason nothing was measured is known and said in the note, which is what makes this an
	// interruption rather than the empty report the code above it stands for.
	it('marks a run a gate stopped before its first reading', () => {
		const nothing = report([row([]), row([])], true)

		expect(bench_cli.exit_code_for(nothing)).toBe(bench_interrupt.INTERRUPTED_EXIT_CODE)
	})
})
