import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMMAND_MAP, josh_logic, resolve_tsx_executable } from './josh-logic'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_VERSION = (
	JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string }
).version

const ENV_FILE_FLAG = '--env-file=.env'

const EXPECTED_COMMANDS_BY_CATEGORY = new Map<string, ReadonlyArray<string>>([
	['Project', ['init', 'sync', 'install']],
	['Workflow', ['git', 'followup', 'notify']],
	['Versioning', ['bump', 'version']],
	['Maintenance', ['overrides', 'audit']],
	['Git hooks', ['prevent-main-commit', 'check-commit-message']],
	['AI tools', ['prep', 'issue']],
])

const EXPECTED_CATEGORY_ORDER = [...EXPECTED_COMMANDS_BY_CATEGORY.keys()]
const EXPECTED_COMMANDS = [...EXPECTED_COMMANDS_BY_CATEGORY.values()].flat()

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

describe('COMMAND_MAP category', () => {
	it('each entry has a valid category', () => {
		for (const entry of Object.values(COMMAND_MAP)) {
			expect(EXPECTED_CATEGORY_ORDER).toContain(entry.category)
		}
	})
})

describe('josh_logic.format_help', () => {
	it('includes the toolkit header with author name', () => {
		expect(josh_logic.format_help()).toContain('Joshua Folkken')
	})

	it('includes the package version in the header', () => {
		expect(josh_logic.format_help()).toContain(`v${PACKAGE_VERSION}`)
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

	it('includes all category headers in correct order', () => {
		const help = josh_logic.format_help()
		const positions = EXPECTED_CATEGORY_ORDER.map((cat) => help.indexOf(cat))

		for (let index = 1; index < positions.length; index++) {
			const previous = positions[index - 1] ?? -1

			expect(positions[index]).toBeGreaterThan(previous)
		}
	})

	it('lists commands within each category in expected order', () => {
		const help = josh_logic.format_help()

		for (const cmds of EXPECTED_COMMANDS_BY_CATEGORY.values()) {
			const positions = cmds.map((cmd) => help.indexOf(`  ${cmd}`))

			for (let index = 1; index < positions.length; index++) {
				const previous = positions[index - 1] ?? -1

				expect(positions[index]).toBeGreaterThan(previous)
			}
		}
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

describe('resolve_tsx_executable', () => {
	it('returns a non-empty string', () => {
		expect(resolve_tsx_executable().length).toBeGreaterThan(0)
	})

	it('returns an absolute path when tsx exists in PACKAGE_DIR node_modules', () => {
		const result = resolve_tsx_executable()

		expect(path.isAbsolute(result)).toBe(true)
	})
})
