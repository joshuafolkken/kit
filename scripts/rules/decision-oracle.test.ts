import { clone_scan } from '#scripts/clone/clone-scan'
import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { COMMAND_MAP } from '#scripts/josh/josh-logic'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { oracle_list_cli } from '#scripts/rules/oracle-list-cli'
import { run_hold_cli } from '#scripts/run/run-hold-cli'
import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2117: every decision oracle on the list must be registered as a josh command,
// and its declared vocabulary must match what the code uses. Two things can rot independently:
// a command can be renamed without updating the list, and the vocabulary tokens can drift.

describe('every oracle command is registered in COMMAND_MAP', () => {
	const unique_commands = [
		...new Set(
			decision_oracle.DECISION_ORACLES.map((oracle) => decision_oracle.get_command(oracle)),
		),
	]

	it.each(unique_commands)('%s is in COMMAND_MAP', (command) => {
		expect(COMMAND_MAP).toHaveProperty(command)
	})
})

describe('oracle:list is registered', () => {
	it('oracle:list is in COMMAND_MAP', () => {
		expect(COMMAND_MAP).toHaveProperty('oracle:list')
	})

	it('oracle:list prints every oracle name', () => {
		const lines: Array<string> = []
		const original = console.info

		console.info = (line: unknown) => {
			lines.push(String(line))
		}

		try {
			oracle_list_cli.print_list()
		} finally {
			console.info = original
		}

		for (const oracle of decision_oracle.DECISION_ORACLES) {
			expect(lines.some((line) => line.includes(oracle.name))).toBe(true)
		}
	})
})

describe('each oracle entry has required fields', () => {
	it.each(decision_oracle.DECISION_ORACLES)('$name has non-empty fields', (oracle) => {
		expect(oracle.name.length).toBeGreaterThan(0)
		expect(decision_oracle.get_command(oracle).length).toBeGreaterThan(0)
		expect(oracle.vocabulary.length).toBeGreaterThan(0)
		expect(oracle.single_source.length).toBeGreaterThan(0)
	})
})

describe('vocabulary matches the code for delegation oracle', () => {
	const DELEGATE_ORACLE = decision_oracle.find_oracle('delegate')

	it('delegate oracle exists', () => {
		expect(DELEGATE_ORACLE).toBeDefined()
	})

	it('delegate verdict is in declared vocabulary', () => {
		expect(DELEGATE_ORACLE?.vocabulary).toContain(delegation_policy.DELEGATE_VERDICT)
	})

	it('keep verdict is in declared vocabulary', () => {
		expect(DELEGATE_ORACLE?.vocabulary).toContain(delegation_policy.KEEP_VERDICT)
	})
})

describe('vocabulary matches the code for latest:scope oracle', () => {
	const SCOPE_ORACLE = decision_oracle.find_oracle('latest:scope')

	it('latest:scope oracle exists', () => {
		expect(SCOPE_ORACLE).toBeDefined()
	})

	it('required verdict is in declared vocabulary', () => {
		expect(SCOPE_ORACLE?.vocabulary).toContain(latest_scope_cli.REQUIRED_SCOPE)
	})

	it('skip verdict is in declared vocabulary', () => {
		expect(SCOPE_ORACLE?.vocabulary).toContain(latest_scope_cli.SKIPPED_SCOPE)
	})
})

describe('vocabulary matches the code for run:hold oracle', () => {
	const HOLD_ORACLE = decision_oracle.find_oracle('run:hold')

	it('run:hold oracle exists', () => {
		expect(HOLD_ORACLE).toBeDefined()
	})

	it('hold verdict is in declared vocabulary', () => {
		expect(HOLD_ORACLE?.vocabulary).toContain(run_hold_cli.HOLD_VERDICT)
	})

	it('busy verdict is in declared vocabulary', () => {
		expect(HOLD_ORACLE?.vocabulary).toContain(run_hold_cli.BUSY_VERDICT)
	})

	it('unknown verdict is in declared vocabulary', () => {
		expect(HOLD_ORACLE?.vocabulary).toContain(run_hold_cli.UNKNOWN_VERDICT)
	})
})

describe('vocabulary matches the code for clone:scan oracle', () => {
	const CLONE_ORACLE = decision_oracle.find_oracle('clone:scan')

	it('clone:scan oracle exists', () => {
		expect(CLONE_ORACLE).toBeDefined()
	})

	it('clean verdict is in declared vocabulary', () => {
		expect(CLONE_ORACLE?.vocabulary).toContain(clone_scan.CLEAN_VERDICT)
	})

	it('clones prefix is in declared vocabulary', () => {
		expect(CLONE_ORACLE?.vocabulary).toContain(clone_scan.CLONES_PREFIX)
	})
})
