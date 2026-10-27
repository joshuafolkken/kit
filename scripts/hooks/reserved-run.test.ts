import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { core_budget } from '#scripts/gate/core-budget'
import { core_weights } from '#scripts/gate/core-weights'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reserved_run } from './reserved-run'

// joshuafolkken/kit#2351: the pre-push `pnpm install` and `pnpm josh audit` were outside the core
// budget, so eight lanes pushing at once spiked a machine the gate thought it had to itself. What is
// pinned here is the argument parse — the weight and the command it guards — and that a guarded command
// runs and its exit code is returned while the reservation is released around it.

const AUDIT_WEIGHT = 1
const EXPLICIT_MB = 3000
const FOUR_WORKERS = 4
const THREE_WORKERS = 3
const { MEMORY_MB } = core_weights
const ESLINT_FOUR = ['pnpm', 'exec', 'eslint', '.', '--concurrency', String(FOUR_WORKERS)]

describe('reserved_run.parse_arguments', () => {
	it('reads the weight and the command it guards', () => {
		expect(
			reserved_run.parse_arguments([String(AUDIT_WEIGHT), '--', 'pnpm', 'josh', 'audit']),
		).toEqual({ weight: AUDIT_WEIGHT, command: ['pnpm', 'josh', 'audit'] })
	})

	// A missing separator, a non-integer weight, and an empty command are each a usage error rather than
	// a reservation of some default — a pre-push command that ran unguarded would be the bug this exists
	// to remove. A zero or negative weight is rejected too: it would subtract from the ledger's cumulative
	// sum and let a sibling admit past the budget.
	it.each([
		['no separator', ['1', 'pnpm', 'install']],
		['a non-integer weight', ['heavy', '--', 'pnpm', 'install']],
		['a zero weight', ['0', '--', 'pnpm', 'install']],
		['a negative weight', ['-3', '--', 'pnpm', 'install']],
		['nothing to run', ['1', '--']],
		['a `--memory` with no value', ['1', '--memory', '--', 'pnpm', 'install']],
		['a non-integer `--memory`', ['1', '--memory', 'lots', '--', 'pnpm', 'install']],
		['a zero `--memory`', ['1', '--memory', '0', '--', 'pnpm', 'install']],
		['an unknown option', ['1', '--cores', '2', '--', 'pnpm', 'install']],
	])('rejects %s', (_label: string, argv: ReadonlyArray<string>) => {
		expect(reserved_run.parse_arguments(argv)).toBeUndefined()
	})

	// joshuafolkken/kit#4582: the explicit memory a caller knows better than the estimate.
	it('reads `--memory <MB>` before the separator', () => {
		expect(
			reserved_run.parse_arguments(['2', '--memory', String(EXPLICIT_MB), '--', 'pnpm', 'install']),
		).toEqual({ weight: 2, memory_mb: EXPLICIT_MB, command: ['pnpm', 'install'] })
	})
})

// joshuafolkken/kit#4582: the reservation carried no memory, so a 12 GB four-worker eslint was admitted
// beside four other lanes. The claim now carries the explicit `--memory`, else the estimate, else none.
function options_of(argv: ReadonlyArray<string>): {
	command: string
	memory_mb: number | undefined
} {
	const parsed = reserved_run.parse_arguments(argv)

	if (parsed === undefined) throw new Error('usage error')

	return reserved_run.reservation_options(parsed)
}

describe('reserved_run.reservation_options', () => {
	it('reserves a four-worker eslint at four times the lint memory', () => {
		expect(options_of(['4', '--', ...ESLINT_FOUR]).memory_mb).toBe(MEMORY_MB.lint * FOUR_WORKERS)
	})

	it('reads a shell script handed through argv', () => {
		const argv = ['4', '--', 'sh', '-c', ESLINT_FOUR.join(' ')]

		expect(options_of(argv).memory_mb).toBe(MEMORY_MB.lint * FOUR_WORKERS)
	})

	it('reserves vitest at its worker count', () => {
		const argv = ['2', '--', 'vitest', 'run', '--maxWorkers', '3']

		expect(options_of(argv).memory_mb).toBe(MEMORY_MB.unit_worker * THREE_WORKERS)
	})

	it('prefers an explicit `--memory` over the estimate', () => {
		const argv = ['4', '--memory', String(EXPLICIT_MB), '--', 'pnpm', 'exec', 'eslint', '.']

		expect(options_of(argv).memory_mb).toBe(EXPLICIT_MB)
	})

	// The argv is re-read as a shell line, so a separator inside one argument must not cut it.
	it('keeps a separator inside one argument from reading as a command', () => {
		const argv = ['1', '--', 'git', 'commit', '-m', 'a; eslint .']

		expect(options_of(argv)).toEqual({
			command: "git commit -m 'a; eslint .'",
			memory_mb: undefined,
		})
	})

	// A `josh` command reserves its own place; reading it here would count it twice.
	it('leaves a command the table does not know at no memory', () => {
		expect(options_of([String(AUDIT_WEIGHT), '--', 'pnpm', 'josh', 'audit'])).toEqual({
			command: 'pnpm josh audit',
			memory_mb: undefined,
		})
	})
})

describe('reserved_run.run_reserved', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
	})

	// The whole path: a guarded command runs while a place is held, and its exit code is what the caller
	// returns. `node --version` exits 0 and needs nothing installed, so it exercises the wrapper without
	// depending on the surrounding project.
	it('runs the guarded command and returns its exit code', async () => {
		expect(
			await reserved_run.run_reserved([String(AUDIT_WEIGHT), '--', process.execPath, '--version']),
		).toBe(0)
	})

	// joshuafolkken/kit#5147: `pnpm josh` starts at the package root, so the command runs where it was typed.
	it('runs the command in the directory pnpm was called from', async () => {
		const typed_in = realpathSync(tmpdir())
		const check = `process.exit(process.cwd() === ${JSON.stringify(typed_in)} ? 0 : 3)`

		vi.stubEnv('INIT_CWD', typed_in)

		expect(
			await reserved_run.run_reserved([String(AUDIT_WEIGHT), '--', process.execPath, '-e', check]),
		).toBe(0)
	})

	// A usage error never runs a command and never holds a place; it is a non-zero exit the caller
	// propagates.
	it('returns a failure code on a usage error', async () => {
		expect(await reserved_run.run_reserved(['not-a-weight'])).toBe(1)
	})

	// joshuafolkken/kit#4582: the estimate reaches the ledger only if the claim carries it.
	it('hands the reservation options to the core budget', async () => {
		vi.spyOn(unit_worker_share, 'is_nested_run').mockReturnValue(false)
		const reserve = vi.spyOn(core_budget, 'with_core_reservation').mockResolvedValue(0)

		await reserved_run.run_reserved([String(FOUR_WORKERS), '--', ...ESLINT_FOUR])

		expect(reserve).toHaveBeenCalledWith(FOUR_WORKERS, expect.any(Function), {
			command: ESLINT_FOUR.join(' '),
			memory_mb: MEMORY_MB.lint * FOUR_WORKERS,
		})
	})
})
