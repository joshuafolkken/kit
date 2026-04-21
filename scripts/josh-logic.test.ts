import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
	ALIASES,
	COMMAND_MAP,
	josh_logic,
	resolve_alias,
	resolve_tsx_executable,
} from './josh-logic'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_VERSION = (
	JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string }
).version

const ENV_FILE_FLAG = '--env-file=.env'
const ALIAS_PAD_WIDTH = 2
const CHECK_SVELTE_CMD = 'check:svelte'
const CHECK_SVELTE_CI_CMD = 'check:svelte:ci'
const CHECK_COMMIT_MESSAGE_CMD = 'check-commit-message'
const UNKNOWN_CMD = 'not-a-command'

const EXPECTED_COMMANDS_BY_CATEGORY = new Map<string, ReadonlyArray<string>>([
	[
		'Development',
		[
			'lint',
			'lint:prettier',
			'lint:eslint',
			'format',
			'format:prettier',
			'format:eslint',
			'cspell',
			'cspell:dot',
			'test:unit',
			'test:e2e',
			'test',
			'check',
			CHECK_SVELTE_CMD,
			CHECK_SVELTE_CI_CMD,
		],
	],
	['Project', ['init', 'sync', 'install']],
	['Workflow', ['git', 'followup', 'notify', 'main:sync', 'main:merge']],
	['Versioning', ['bump', 'version']],
	['Maintenance', ['overrides', 'audit', 'latest', 'latest:corepack', 'latest:update']],
	[
		'Git hooks',
		[
			'prevent-main-commit',
			CHECK_COMMIT_MESSAGE_CMD,
			'hook:install',
			'hook:uninstall',
			'hook:commit',
			'hook:push',
		],
	],
	['AI tools', ['prep', 'issue']],
])

function assert_positions_in_order(positions: ReadonlyArray<number>): void {
	for (const pos of positions) expect(pos).toBeGreaterThanOrEqual(0)

	for (let index = 1; index < positions.length; index++) {
		expect(positions[index]).toBeGreaterThan(positions[index - 1] ?? -1)
	}
}

const EXPECTED_CATEGORY_ORDER = [...EXPECTED_COMMANDS_BY_CATEGORY.keys()]
const EXPECTED_COMMANDS = [...EXPECTED_COMMANDS_BY_CATEGORY.values()].flat()

describe('COMMAND_MAP', () => {
	it('contains all expected commands', () => {
		for (const cmd of EXPECTED_COMMANDS) {
			expect(COMMAND_MAP).toHaveProperty(cmd)
		}
	})

	it('each entry has a script path or shell command, and a description', () => {
		for (const entry of Object.values(COMMAND_MAP)) {
			const has_impl =
				Boolean(entry.script) || (Array.isArray(entry.shell) && entry.shell.length > 0)

			expect(has_impl).toBe(true)
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

	it('shows alias before full name for aliased commands', () => {
		const help = josh_logic.format_help()

		expect(help).toContain('l,  lint')
		expect(help).toContain('tu, test:unit')
		expect(help).toContain(`cm, ${CHECK_COMMIT_MESSAGE_CMD}`)
	})
})

describe('josh_logic.format_help order', () => {
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
		const cmd_to_alias = new Map(Object.entries(ALIASES).map(([alias, cmd]) => [cmd, alias]))

		for (const cmds of EXPECTED_COMMANDS_BY_CATEGORY.values()) {
			const positions = cmds.map((cmd) => {
				const alias = cmd_to_alias.get(cmd)
				const prefix = alias ? `${alias}, `.padEnd(ALIAS_PAD_WIDTH + ALIAS_PAD_WIDTH) : ''

				return help.indexOf(`\n  ${prefix}${cmd}`)
			})

			assert_positions_in_order(positions)
		}
	})
})

describe('ALIASES', () => {
	it('every alias target exists in COMMAND_MAP', () => {
		for (const cmd of Object.values(ALIASES)) {
			expect(COMMAND_MAP).toHaveProperty(cmd)
		}
	})

	it('has no duplicate alias keys', () => {
		const keys = Object.keys(ALIASES)

		expect(new Set(keys).size).toBe(keys.length)
	})

	it('every command in COMMAND_MAP has an alias', () => {
		const aliased_commands = new Set(Object.values(ALIASES))

		for (const cmd of Object.keys(COMMAND_MAP)) {
			expect(aliased_commands.has(cmd)).toBe(true)
		}
	})
})

describe('resolve_alias', () => {
	it('resolves 1-char alias to full command name', () => {
		expect(resolve_alias('l')).toBe('lint')
		expect(resolve_alias('t')).toBe('test')
		expect(resolve_alias('g')).toBe('git')
	})

	it('resolves 2-char alias to full command name', () => {
		expect(resolve_alias('tu')).toBe('test:unit')
		expect(resolve_alias('sv')).toBe(CHECK_SVELTE_CMD)
		expect(resolve_alias('cm')).toBe(CHECK_COMMIT_MESSAGE_CMD)
	})

	it('returns input unchanged for full command names', () => {
		expect(resolve_alias('lint')).toBe('lint')
		expect(resolve_alias('test:unit')).toBe('test:unit')
	})

	it('returns input unchanged for unknown strings', () => {
		expect(resolve_alias(UNKNOWN_CMD)).toBe(UNKNOWN_CMD)
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

	it('returns 1 for check:svelte in a non-SvelteKit project directory', () => {
		expect(josh_logic.run_command(CHECK_SVELTE_CMD, [])).toBe(1)
	})

	it('returns 1 for check:svelte:ci in a non-SvelteKit project directory', () => {
		expect(josh_logic.run_command(CHECK_SVELTE_CI_CMD, [])).toBe(1)
	})

	it('resolves alias and does not return -1 for valid alias', () => {
		expect(josh_logic.run_command('sc', [])).toBe(1)
	})
})

describe('COMMAND_MAP shell commands', () => {
	/* eslint-disable dot-notation */
	it('lint uses sh -c for chaining', () => {
		expect(COMMAND_MAP['lint']?.shell?.[0]).toBe('sh')
	})

	it('lint:prettier delegates to pnpm exec prettier', () => {
		const shell = COMMAND_MAP['lint:prettier']?.shell ?? []

		expect(shell).toContain('prettier')
		expect(shell).toContain('pnpm')
	})

	it('hook:install delegates to lefthook install', () => {
		const shell = COMMAND_MAP['hook:install']?.shell ?? []

		expect(shell).toContain('lefthook')
		expect(shell).toContain('install')
	})

	it('latest uses sh -c for chaining', () => {
		expect(COMMAND_MAP['latest']?.shell?.[0]).toBe('sh')
	})

	it('test:e2e delegates to pnpm exec playwright test', () => {
		const shell = COMMAND_MAP['test:e2e']?.shell ?? []

		expect(shell).toContain('playwright')
		expect(shell).toContain('pnpm')
	})

	it('test uses sh -c for chaining test:unit and test:e2e', () => {
		const shell = COMMAND_MAP['test']?.shell ?? []

		expect(shell[0]).toBe('sh')
		expect(shell[2]).toContain('test:unit')
		expect(shell[2]).toContain('test:e2e')
	})
	/* eslint-enable dot-notation */
})

describe('COMMAND_MAP check commands', () => {
	it('check does not require sveltekit', () => {
		/* eslint-disable-next-line dot-notation */
		expect(COMMAND_MAP['check']?.requires_sveltekit).toBeUndefined()
	})

	it('check:svelte has requires_sveltekit flag', () => {
		expect(COMMAND_MAP[CHECK_SVELTE_CMD]?.requires_sveltekit).toBe(true)
	})

	it('check:svelte:ci has requires_sveltekit flag', () => {
		expect(COMMAND_MAP[CHECK_SVELTE_CI_CMD]?.requires_sveltekit).toBe(true)
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
