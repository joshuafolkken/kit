import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { DISTRIBUTED_ROOT_FILE, DISTRIBUTED_SKILL_FILE } from '#scripts/managed-config-fixture'
import { describe, expect, it } from 'vitest'
import { CLEAN_ANSWER, MANAGED_ANSWER, managed_config_scope_cli } from './managed-config-scope-cli'

const COMMAND = 'sync:scope'
const SCRIPT_PATH = 'scripts/sync/managed-config-scope-cli.ts'
const ALIAS = 'sys'

// The file under test is itself a path no distribution list holds, so it doubles as the negative
// case rather than introducing a second literal for the same string.
const UNDISTRIBUTED_FILE = SCRIPT_PATH

describe('managed_config_scope_cli.decide', () => {
	it('answers managed when any changed path is distributed', () => {
		expect(managed_config_scope_cli.decide([UNDISTRIBUTED_FILE, DISTRIBUTED_ROOT_FILE])).toBe(
			MANAGED_ANSWER,
		)
	})

	it('answers managed for a file under a distributed directory', () => {
		expect(managed_config_scope_cli.decide([DISTRIBUTED_SKILL_FILE])).toBe(MANAGED_ANSWER)
	})

	it('answers clean when nothing changed is distributed', () => {
		expect(managed_config_scope_cli.decide([UNDISTRIBUTED_FILE])).toBe(CLEAN_ANSWER)
	})

	it('answers clean for an empty change', () => {
		expect(managed_config_scope_cli.decide([])).toBe(CLEAN_ANSWER)
	})
})

describe('managed_config_scope_cli.format_reason', () => {
	// The list name is the half a reader cannot derive: the path matched a directory entry it does
	// not textually equal, which is the case joshuafolkken/kit#1578 records a run missing by eye.
	it('names the path and the list that claimed it', () => {
		const reason = managed_config_scope_cli.format_reason([DISTRIBUTED_SKILL_FILE], MANAGED_ANSWER)

		expect(reason).toContain(DISTRIBUTED_SKILL_FILE)
		expect(reason).toContain('AI_COPY_DIRECTORIES')
	})

	it('lists only the distributed paths, not the whole change', () => {
		const reason = managed_config_scope_cli.format_reason(
			[UNDISTRIBUTED_FILE, DISTRIBUTED_ROOT_FILE],
			MANAGED_ANSWER,
		)

		expect(reason).toContain(DISTRIBUTED_ROOT_FILE)
		expect(reason).not.toContain(UNDISTRIBUTED_FILE)
	})

	it('says so plainly when nothing is distributed', () => {
		expect(managed_config_scope_cli.format_reason([UNDISTRIBUTED_FILE], CLEAN_ANSWER)).toBe(
			'no changed path is distributed by josh sync',
		)
	})
})

describe('managed_config_scope_cli.run', () => {
	it('refuses an unknown flag rather than answering', async () => {
		await expect(managed_config_scope_cli.run(['--not-a-flag'])).resolves.not.toBe(0)
	})
})

describe('sync:scope registration', () => {
	it('is on the command map', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})

	it('states the two flags it accepts in its usage line', () => {
		expect(managed_config_scope_cli.USAGE).toContain('--staged')
		expect(managed_config_scope_cli.USAGE).toContain('--json')
	})
})
