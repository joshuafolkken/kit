import { describe, expect, it } from 'vitest'
import { reserved_run } from './reserved-run'

// joshuafolkken/kit#2351: the pre-push `pnpm install` and `pnpm josh audit` were outside the core
// budget, so eight lanes pushing at once spiked a machine the gate thought it had to itself. What is
// pinned here is the argument parse — the weight and the command it guards — and that a guarded command
// runs and its exit code is returned while the reservation is released around it.

const AUDIT_WEIGHT = 1

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
	])('rejects %s', (_label: string, argv: ReadonlyArray<string>) => {
		expect(reserved_run.parse_arguments(argv)).toBeUndefined()
	})
})

describe('reserved_run.run_reserved', () => {
	// The whole path: a guarded command runs while a place is held, and its exit code is what the caller
	// returns. `node --version` exits 0 and needs nothing installed, so it exercises the wrapper without
	// depending on the surrounding project.
	it('runs the guarded command and returns its exit code', async () => {
		expect(
			await reserved_run.run_reserved([String(AUDIT_WEIGHT), '--', process.execPath, '--version']),
		).toBe(0)
	})

	// A usage error never runs a command and never holds a place; it is a non-zero exit the caller
	// propagates.
	it('returns a failure code on a usage error', async () => {
		expect(await reserved_run.run_reserved(['not-a-weight'])).toBe(1)
	})
})
