import { describe, expect, it } from 'vitest'
import { COMMAND_MAP, josh_logic } from './josh-logic'

const ENV_FILE_FLAG = '--env-file=.env'

const EXPECTED_COMMANDS = [
	'init',
	'sync',
	'git',
	'git-followup',
	'telegram-test',
	'prep',
	'issue-prep',
	'bump-version',
	'overrides-check',
	'security-audit',
	'prevent-main-commit',
	'check-commit-message',
	'version-check',
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
	it('git-followup includes --env-file=.env tsx argument', () => {
		expect(COMMAND_MAP['git-followup']?.tsx_arguments).toContain(ENV_FILE_FLAG)
	})

	it('telegram-test includes --env-file=.env tsx argument', () => {
		expect(COMMAND_MAP['telegram-test']?.tsx_arguments).toContain(ENV_FILE_FLAG)
	})
})

describe('josh_logic.run_command', () => {
	it('returns -1 for an unknown command', () => {
		expect(josh_logic.run_command('not-a-real-command', [])).toBe(-1)
	})

	it('returns -1 for inherited prototype keys like constructor', () => {
		expect(josh_logic.run_command('constructor', [])).toBe(-1)
	})
})
