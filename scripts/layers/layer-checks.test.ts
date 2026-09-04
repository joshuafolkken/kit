import { gate_plan } from '#scripts/gate-plan'
import { describe, expect, it } from 'vitest'
import { layer_checks } from './layer-checks'

const TYPE_CHECK = 'type-check'
const UNIT_TESTS = 'unit-tests'

function checks_of(command: string): ReadonlyArray<string> {
	return layer_checks.resolve_command(command).checks
}

describe('layer_checks — reading a check off a command line', () => {
	it('names the tool a plain shell command runs', () => {
		expect(checks_of('pnpm exec eslint --quiet {staged_files}')).toStrictEqual(['eslint'])
	})

	it('reads a whole-project type check from the tsc flag rather than the binary alone', () => {
		expect(checks_of('pnpm exec tsc --noEmit')).toStrictEqual([TYPE_CHECK])
	})

	it('still reads the type check where the flag is not adjacent to the binary', () => {
		expect(checks_of('pnpm exec tsc --project tsconfig.json --noEmit')).toStrictEqual([TYPE_CHECK])
	})

	it('reads nothing from tsc without the flag, rather than guessing at a type check', () => {
		expect(checks_of('pnpm exec tsc --build')).toStrictEqual([])
	})
})

describe('layer_checks — the checks a command line names outright', () => {
	it('does not read the Playwright browser download as an E2E run', () => {
		expect(checks_of('./node_modules/.bin/playwright install --with-deps chromium')).toStrictEqual(
			[],
		)
	})

	it('reads a GitHub Action by name, so an action-shaped check is still a check', () => {
		expect(checks_of('google/osv-scanner-action/osv-scanner-action@v2.5.1')).toStrictEqual([
			'dependency-audit',
		])
	})
})

describe('layer_checks — expanding a josh sub-command', () => {
	it('expands josh gate into the checks gate-plan declares', () => {
		const expanded = checks_of('pnpm josh gate --verbose')

		expect(expanded).toStrictEqual(['cspell', 'eslint', 'prettier', TYPE_CHECK, UNIT_TESTS])
	})

	it('keeps the gate expansion tied to gate-plan rather than to a copy of its list', () => {
		expect(gate_plan.GATE_CHECKS.map((check) => check.target)).toStrictEqual([
			'lint',
			'check',
			'cspell:dot',
			'test:unit',
		])
	})

	it('expands a script-backed target through the declared table', () => {
		expect(checks_of('pnpm josh lint')).toStrictEqual(['eslint', 'prettier'])
	})

	it('expands a shell-backed target through its own argv in the command map', () => {
		expect(checks_of('pnpm josh check')).toStrictEqual([TYPE_CHECK])
	})

	it('follows both targets of a composite sh -c command', () => {
		expect(checks_of('sh -c pnpm josh test:unit && pnpm josh test:e2e')).toStrictEqual([
			'e2e-tests',
			UNIT_TESTS,
		])
	})
})

describe('layer_checks — a josh target that resolves to no check', () => {
	it('resolves a script-backed target whose own name is the check, without a note', () => {
		const resolved = layer_checks.resolve_command('pnpm josh test:e2e')

		expect(resolved.checks).toStrictEqual(['e2e-tests'])
		expect(resolved.unresolved).toStrictEqual([])
	})

	it('reports a josh target it cannot resolve instead of dropping the step', () => {
		const resolved = layer_checks.resolve_command('pnpm josh not-a-real-command')

		expect(resolved.checks).toStrictEqual([])
		expect(resolved.unresolved).toStrictEqual(['not-a-real-command'])
	})

	it('unions the tool named outright with what the josh target expands to', () => {
		expect(checks_of('pnpm josh secretlint-scan {staged_files}')).toStrictEqual(['secret-scan'])
	})
})
