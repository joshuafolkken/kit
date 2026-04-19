import { describe, expect, it } from 'vitest'
import { COMMAND_MAP, josh_logic } from './josh-logic'

const ENV_FILE_FLAG = '--env-file=.env'

const EXPECTED_COMMANDS = [
	'init',
	'sync',
	'git',
	'followup',
	'notify',
	'prep',
	'issue',
	'bump',
	'overrides',
	'audit',
	'prevent-main-commit',
	'check-commit-message',
	'version',
	'install',
]

describe('COMMAND_MAP', () => {
	it('contains all expected commands', () => {
		for (const cmd of EXPECTED_COMMANDS) {
			expect(COMMAND_MAP).toHaveProperty(cmd)
		}
	})

	it('each entry has a script path and description', () => {
		for (const entry of Object.values(COMMAND_MAP)) {
			expect(entry.script).toBeTruthy()
			expect(entry.description).toBeTruthy()
		}
	})
})

describe('josh_logic.format_help', () => {
	it('includes the toolkit header with author name', () => {
		expect(josh_logic.format_help()).toContain('Joshua Folkken')
	})

	it('includes all command names', () => {
		const help = josh_logic.format_help()

		for (const cmd of EXPECTED_COMMANDS) {
			expect(help).toContain(cmd)
		}
	})

	it('includes usage line', () => {
		expect(josh_logic.format_help()).toContain('Usage: josh <command>')
	})
})

describe('COMMAND_MAP env-file commands', () => {
	/* eslint-disable dot-notation -- Record<string, T> requires bracket notation per noPropertyAccessFromIndexSignature */
	it('followup includes --env-file=.env tsx argument', () => {
		expect(COMMAND_MAP['followup']?.tsx_arguments).toContain(ENV_FILE_FLAG)
	})

	it('notify includes --env-file=.env tsx argument', () => {
		expect(COMMAND_MAP['notify']?.tsx_arguments).toContain(ENV_FILE_FLAG)
	})
	/* eslint-enable dot-notation */
})

describe('josh_logic.run_command', () => {
	it('returns -1 for an unknown command', () => {
		expect(josh_logic.run_command('not-a-real-command', [])).toBe(-1)
	})

	it('returns -1 for inherited prototype keys like constructor', () => {
		expect(josh_logic.run_command('constructor', [])).toBe(-1)
	})
})
