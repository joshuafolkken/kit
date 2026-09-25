import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
	ALIASES,
	COMMAND_MAP,
	josh_logic,
	resolve_alias,
	resolve_tsx_executable,
	UNKNOWN_COMMAND_EXIT_CODE,
} from './josh-logic'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKAGE_VERSION = (
	JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string }
).version

const ENV_FILE_FLAG = '--env-file-if-exists=.env'
const MANDATORY_ENV_FILE_FLAG = '--env-file=.env'
const ALIAS_PAD_WIDTH = 2
const CHECK_COMMIT_MESSAGE_CMD = 'check-commit-message'
const UNKNOWN_CMD = 'not-a-command'
const USAGE_LINE = 'Usage: josh <command>'
const ALL_HINT = "Run 'josh --all'"

// These representative developer commands appear in the default listing.
const EXPECTED_COMMAND_ENTRIES: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
	['Development', ['gate', 'lint', 'lines', 'format', 'cspell:dot', 'test:unit', 'test', 'check']],
	['Project', ['init', 'sync']],
	['Workflow', ['git', 'pr', 'main:sync', 'main:merge']],
	['Versioning', ['version']],
	['Maintenance', ['doctor', 'audit']],
	['AI tools', ['rule:value']],
]

// Commands the default help hides and `--all` reveals across non-developer audiences.
const DETAIL_ONLY_COMMANDS: ReadonlyArray<string> = [
	'prevent-main-commit',
	CHECK_COMMIT_MESSAGE_CMD,
	'eval',
	'bump',
	'followup',
]

const EXPECTED_COMMANDS_BY_CATEGORY = new Map<string, ReadonlyArray<string>>(
	EXPECTED_COMMAND_ENTRIES,
)

function assert_positions_in_order(positions: ReadonlyArray<number>): void {
	for (const pos of positions) expect(pos).toBeGreaterThanOrEqual(0)

	for (let index = 1; index < positions.length; index++) {
		expect(positions[index]).toBeGreaterThan(positions[index - 1] ?? -1)
	}
}

const EXPECTED_CATEGORY_ORDER = EXPECTED_COMMAND_ENTRIES.map(([category]) => category)
const EXPECTED_COMMANDS = EXPECTED_COMMAND_ENTRIES.flatMap(([, commands]) => commands)

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

// AI tools and Git hooks have no developer-facing commands.
const VALID_CATEGORIES: ReadonlyArray<string> = [
	...EXPECTED_CATEGORY_ORDER,
	'Git hooks',
	'AI tools',
]

describe('COMMAND_MAP category', () => {
	it('each entry has a valid category', () => {
		for (const entry of Object.values(COMMAND_MAP)) {
			expect(VALID_CATEGORIES).toContain(entry.category)
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
		expect(josh_logic.format_help()).toContain(USAGE_LINE)
	})

	it('shows alias before full name for aliased commands', () => {
		const help = josh_logic.format_help()

		expect(help).toContain('l,  lint')
		expect(help).toContain('tu, test:unit')
		expect(help).toContain('ga, gate')
	})
})

describe('josh_logic.format_help audience split', () => {
	it('hides non-developer commands and points at --all by default', () => {
		const help = josh_logic.format_help()

		for (const cmd of DETAIL_ONLY_COMMANDS) expect(help).not.toContain(cmd)
		expect(help).toContain(ALL_HINT)
	})

	it('lists non-developer commands and drops the --all hint under --all', () => {
		const help = josh_logic.format_help(true)

		for (const cmd of DETAIL_ONLY_COMMANDS) expect(help).toContain(cmd)
		expect(help).not.toContain(ALL_HINT)
	})

	it('drops a category left empty once its maintenance commands are hidden', () => {
		expect(josh_logic.format_help()).not.toContain('Git hooks')
		expect(josh_logic.format_help(true)).toContain('Git hooks')
	})
})

describe('josh_logic.format_unknown_command', () => {
	it('names the command that was not recognized', () => {
		expect(josh_logic.format_unknown_command(UNKNOWN_CMD)).toContain(
			`Unknown command: ${UNKNOWN_CMD}`,
		)
	})

	// #1928 cut the full listing to one line: the #825 stdout contract still holds (the caller sends
	// this to stderr), but a name a kit cannot resolve no longer dumps the whole toolkit index.
	it('answers in one line without the full help listing', () => {
		const reported = josh_logic.format_unknown_command(UNKNOWN_CMD)

		expect(reported).not.toContain(josh_logic.format_help())
		expect(reported).toContain("Run 'josh --help'")
		expect(reported).toContain("'josh --all' for the full list")
		expect(reported.split('\n')).toHaveLength(1)
	})

	it('suggests the closest command when the typo is near one', () => {
		expect(josh_logic.format_unknown_command('gat')).toContain("Did you mean 'gate'?")
	})

	it('offers no suggestion when nothing is close', () => {
		expect(josh_logic.format_unknown_command('zzzzzzzz')).not.toContain('Did you mean')
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

// joshuafolkken/kit#1564: the mandatory form is asserted absent as well as the optional one present.
// A regression back to `--env-file=.env` is not a missing flag — it is a flag that kills both
// commands before node starts on any machine with no `.env`, credentials in the environment or not.
describe('COMMAND_MAP env-file commands', () => {
	it('followup reads .env only when it exists', () => {
		expect(COMMAND_MAP['followup']?.tsx_arguments).toContain(ENV_FILE_FLAG)
		expect(COMMAND_MAP['followup']?.tsx_arguments).not.toContain(MANDATORY_ENV_FILE_FLAG)
	})

	it('notify reads .env only when it exists', () => {
		expect(COMMAND_MAP['notify']?.tsx_arguments).toContain(ENV_FILE_FLAG)
		expect(COMMAND_MAP['notify']?.tsx_arguments).not.toContain(MANDATORY_ENV_FILE_FLAG)
	})
})

const SKIP_COMMIT_FLAG = '--skip-commit'
const SKIP_PUSH_FLAG = '--skip-push'
const YES_FLAG = '-y'

describe('COMMAND_MAP pr command', () => {
	it('pr command has default_script_arguments with -y --skip-commit --skip-push', () => {
		const default_arguments = COMMAND_MAP['pr']?.default_script_arguments ?? []

		expect(default_arguments).toContain(YES_FLAG)
		expect(default_arguments).toContain(SKIP_COMMIT_FLAG)
		expect(default_arguments).toContain(SKIP_PUSH_FLAG)
	})

	it('pr command shares the git workflow script', () => {
		expect(COMMAND_MAP['pr']?.script).toBe(COMMAND_MAP['git']?.script)
	})
})

describe('josh_logic.spawn_script — default_script_arguments injection', () => {
	it('injects default_script_arguments between script path and user args', () => {
		const spy = vi.spyOn(josh_logic, 'spawn_script').mockReturnValue(0)
		const tsx_executable = 'tsx'
		const script_path = path.join(PACKAGE_DIR, 'scripts-ai/git-workflow.ts')
		const user_arguments = ['feat: my feature #42']
		const expected_arguments = [
			script_path,
			YES_FLAG,
			SKIP_COMMIT_FLAG,
			SKIP_PUSH_FLAG,
			...user_arguments,
		]

		josh_logic.spawn_script(tsx_executable, expected_arguments)

		expect(spy).toHaveBeenCalledWith(
			tsx_executable,
			expect.arrayContaining([YES_FLAG, SKIP_COMMIT_FLAG, SKIP_PUSH_FLAG]),
		)
		spy.mockRestore()
	})
})

// Reported through a promise since joshuafolkken/kit#1342, where a script command the dispatcher
// can evaluate in its own process is awaited rather than spawned.
describe('josh_logic.run_command', () => {
	it('reports the unknown-command code for an unknown command', async () => {
		await expect(josh_logic.run_command('not-a-real-command', [])).resolves.toBe(
			UNKNOWN_COMMAND_EXIT_CODE,
		)
	})

	it('reports the unknown-command code for inherited prototype keys like constructor', async () => {
		await expect(josh_logic.run_command('constructor', [])).resolves.toBe(UNKNOWN_COMMAND_EXIT_CODE)
	})
})

describe('COMMAND_MAP shell commands', () => {
	it('lint uses a script for parallel execution', () => {
		expect(COMMAND_MAP['lint']?.script).toBeDefined()
		expect(COMMAND_MAP['lint']?.shell).toBeUndefined()
	})

	it('latest uses sh -c for chaining', () => {
		expect(COMMAND_MAP['latest']?.shell?.[0]).toBe('sh')
	})

	it('test:e2e delegates to the guard script so it can skip when playwright is absent', () => {
		expect(COMMAND_MAP['test:e2e']?.shell).toBeUndefined()
		expect(COMMAND_MAP['test:e2e']?.script).toBe('scripts/test/test-e2e-guard.ts')
	})

	it('test:unit delegates to the guard script so it can skip when vitest is absent', () => {
		expect(COMMAND_MAP['test:unit']?.shell).toBeUndefined()
		expect(COMMAND_MAP['test:unit']?.script).toBe('scripts/test/test-unit-guard.ts')
	})

	it('test uses sh -c for chaining test:unit and test:e2e', () => {
		const shell = COMMAND_MAP['test']?.shell ?? []

		expect(shell[0]).toBe('sh')
		expect(shell[2]).toContain('test:unit')
		expect(shell[2]).toContain('test:e2e')
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
