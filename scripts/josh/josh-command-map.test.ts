import { describe, expect, it } from 'vitest'
import { ALIASES, CATEGORY_ORDER, COMMAND_MAP, type CommandEntry } from './josh-command-map'

const ALL_COMMAND_NAMES = Object.keys(COMMAND_MAP)
const VERSION_UPGRADE_COMMAND = 'version:upgrade'
const TEST_WATCH_COMMAND = 'test:watch'
const TEST_UI_COMMAND = 'test:ui'
const TEST_E2E_COMMAND = 'test:e2e'
const TEST_UNIT_COMMAND = 'test:unit'
const HEALTH_COMMAND = 'health'
const ALL_ALIAS_KEYS = Object.keys(ALIASES)
const DEVELOPMENT_CATEGORY = 'Development'

function get_command(name: string): CommandEntry | undefined {
	return COMMAND_MAP[name]
}

function get_alias(key: string): string | undefined {
	return ALIASES[key]
}

describe('COMMAND_MAP — required fields', () => {
	it('every command has a description', () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			expect(entry.description, `command ${name} missing description`).toBeTruthy()
		}
	})

	it('every command has a category', () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			expect(entry.category, `command ${name} missing category`).toBeTruthy()
		}
	})

	it('every command has at least one of script or shell', () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			const has_script = entry.script !== undefined
			const has_shell = entry.shell !== undefined

			expect(has_script || has_shell, `command ${name} has neither script nor shell`).toBe(true)
		}
	})

	it('every command does not have both script and shell', () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			const has_both = entry.script !== undefined && entry.shell !== undefined

			expect(has_both, `command ${name} has both script and shell`).toBe(false)
		}
	})
})

describe('COMMAND_MAP — command lookup by name', () => {
	it('resolves lint command with script and Development category', () => {
		const entry = get_command('lint')

		expect(entry).toBeDefined()
		expect(entry?.script).toBeDefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})

	it('resolves git command with script and Workflow category', () => {
		const entry = get_command('git')

		expect(entry).toBeDefined()
		expect(entry?.script).toBeDefined()
		expect(entry?.category).toBe('Workflow')
	})

	it('resolves bump command with script and Versioning category', () => {
		const entry = get_command('bump')

		expect(entry?.script).toBeDefined()
		expect(entry?.category).toBe('Versioning')
	})

	it('resolves version:upgrade command with script and Versioning category', () => {
		const entry = get_command(VERSION_UPGRADE_COMMAND)

		expect(entry?.script).toBeDefined()
		expect(entry?.category).toBe('Versioning')
	})
})

describe('COMMAND_MAP — new dev commands', () => {
	it('resolves test:watch command with shell and Development category', () => {
		const entry = get_command(TEST_WATCH_COMMAND)

		expect(entry).toBeDefined()
		expect(entry?.shell).toBeDefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})

	it('resolves test:ui command with shell and Development category', () => {
		const entry = get_command(TEST_UI_COMMAND)

		expect(entry).toBeDefined()
		expect(entry?.shell).toBeDefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})

	it('resolves health command with script and Development category', () => {
		const entry = get_command(HEALTH_COMMAND)

		expect(entry).toBeDefined()
		expect(entry?.script).toBeDefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})

	it('routes test:e2e through the guard script instead of a raw shell command', () => {
		const entry = get_command(TEST_E2E_COMMAND)

		expect(entry?.script).toBe('scripts/test-e2e-guard.ts')
		expect(entry?.shell).toBeUndefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})

	it('routes test:unit through the guard script instead of a raw shell command', () => {
		const entry = get_command(TEST_UNIT_COMMAND)

		expect(entry?.script).toBe('scripts/test-unit-guard.ts')
		expect(entry?.shell).toBeUndefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})
})

describe('COMMAND_MAP — tsx_arguments', () => {
	it('followup command has tsx_arguments with env-file flag', () => {
		const entry = get_command('followup')

		expect(entry?.tsx_arguments).toBeDefined()
		expect(entry?.tsx_arguments?.some((flag) => flag.includes('env-file'))).toBe(true)
	})

	it('notify command has tsx_arguments with env-file flag', () => {
		const entry = get_command('notify')

		expect(entry?.tsx_arguments?.some((flag) => flag.includes('env-file'))).toBe(true)
	})

	it('lint command has no tsx_arguments', () => {
		expect(get_command('lint')?.tsx_arguments).toBeUndefined()
	})
})

describe('COMMAND_MAP — requires_sveltekit', () => {
	it('check:svelte command requires sveltekit', () => {
		expect(get_command('check:svelte')?.requires_sveltekit).toBe(true)
	})

	it('check:svelte:ci command requires sveltekit', () => {
		expect(get_command('check:svelte:ci')?.requires_sveltekit).toBe(true)
	})

	it('lint command does not require sveltekit', () => {
		expect(get_command('lint')?.requires_sveltekit).toBeUndefined()
	})
})

describe('ALIASES — all resolve to valid COMMAND_MAP keys', () => {
	it('every alias points to an existing command', () => {
		for (const [alias, command] of Object.entries(ALIASES)) {
			expect(ALL_COMMAND_NAMES, `alias ${alias} → ${command} not found in COMMAND_MAP`).toContain(
				command,
			)
		}
	})

	it('resolves l alias to lint', () => {
		expect(get_alias('l')).toBe('lint')
	})

	it('resolves t alias to test', () => {
		expect(get_alias('t')).toBe('test')
	})

	it('resolves g alias to git', () => {
		expect(get_alias('g')).toBe('git')
	})

	it('resolves fu alias to followup', () => {
		expect(get_alias('fu')).toBe('followup')
	})

	it('resolves vu alias to version:upgrade', () => {
		expect(get_alias('vu')).toBe(VERSION_UPGRADE_COMMAND)
	})

	it('resolves tu alias to test:unit', () => {
		expect(get_alias('tu')).toBe('test:unit')
	})

	it('no duplicate alias keys', () => {
		expect(ALL_ALIAS_KEYS.length).toBe(new Set(ALL_ALIAS_KEYS).size)
	})
})

describe('ALIASES — new command aliases', () => {
	it('resolves tw alias to test:watch', () => {
		expect(get_alias('tw')).toBe(TEST_WATCH_COMMAND)
	})

	it('resolves tui alias to test:ui', () => {
		expect(get_alias('tui')).toBe(TEST_UI_COMMAND)
	})

	it('resolves he alias to health', () => {
		expect(get_alias('he')).toBe(HEALTH_COMMAND)
	})

	it('resolves swp alias to sync-workflow-pins', () => {
		expect(get_alias('swp')).toBe('sync-workflow-pins')
	})

	it('resolves dr alias to doctor', () => {
		expect(get_alias('dr')).toBe('doctor')
	})
})

describe('COMMAND_MAP — project-pinned shim removal', () => {
	it('no longer exposes the install command', () => {
		expect(COMMAND_MAP).not.toHaveProperty('install')
	})

	it('no longer exposes the il alias', () => {
		expect(ALIASES).not.toHaveProperty('il')
	})
})

describe('COMMAND_MAP — latest command authentication', () => {
	it('latest command shell exports NODE_AUTH_TOKEN from gh auth token', () => {
		const entry = get_command('latest')
		const shell_string = entry?.shell?.join(' ') ?? ''

		expect(shell_string).toContain('export NODE_AUTH_TOKEN=$(gh auth token)')
	})
})

describe('CATEGORY_ORDER — covers all command categories', () => {
	it('includes every category used in COMMAND_MAP', () => {
		const used_categories = new Set(Object.values(COMMAND_MAP).map((entry) => entry.category))

		for (const category of used_categories) {
			expect(CATEGORY_ORDER, `category ${category} missing from CATEGORY_ORDER`).toContain(category)
		}
	})

	it('has no duplicates', () => {
		expect(CATEGORY_ORDER.length).toBe(new Set(CATEGORY_ORDER).size)
	})

	it('starts with Development and ends with AI tools', () => {
		expect(CATEGORY_ORDER[0]).toBe(DEVELOPMENT_CATEGORY)
		expect(CATEGORY_ORDER.at(-1)).toBe('AI tools')
	})
})
