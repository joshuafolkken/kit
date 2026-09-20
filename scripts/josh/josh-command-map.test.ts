import { describe, expect, it } from 'vitest'
import { ALIASES, CATEGORY_ORDER, COMMAND_MAP, type CommandEntry } from './josh-command-map'
import { COMMAND_AUDIENCES, COMMAND_SIDE_EFFECTS } from './josh-command-types'
import { composite_arguments } from './josh-composite-arguments'

const ALL_COMMAND_NAMES = Object.keys(COMMAND_MAP)
const TEST_E2E_COMMAND = 'test:e2e'
const TEST_UNIT_COMMAND = 'test:unit'
const ALL_ALIAS_KEYS = Object.keys(ALIASES)
const DEVELOPMENT_CATEGORY = 'Development'
const OPTIONAL_ENV_FILE_FLAG = '--env-file-if-exists=.env'

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

// The reference triple is what the generated command catalog reads (joshuafolkken/kit#2064), so the
// vocabulary it is checked against is the one the type is derived from rather than a second copy.
describe('COMMAND_MAP — reference metadata', () => {
	it('every command has complete reference metadata', () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			const [arguments_synopsis, audience, side_effects] = entry.reference

			// Not `toBeTypeOf('string')`: the tuple types position 0 as a string, so that assertion
			// cannot fail. What can is a synopsis carrying padding, which the generated catalog would
			// render verbatim.
			expect(arguments_synopsis, `command ${name} has a padded synopsis`).toBe(
				arguments_synopsis.trim(),
			)
			expect(COMMAND_AUDIENCES, `command ${name} has invalid audience`).toContain(audience)
			expect(side_effects, `command ${name} missing side effects`).not.toHaveLength(0)

			for (const side_effect of side_effects) {
				expect(COMMAND_SIDE_EFFECTS, `command ${name} has invalid side effect`).toContain(
					side_effect,
				)
			}
		}
	})

	it('composite commands do not advertise arguments they reject', () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			if (!composite_arguments.is_composite_shell(entry.shell)) continue

			expect(entry.reference[0], `composite command ${name} advertises rejected arguments`).toBe('')
		}
	})

	// The per-command values are pinned by the snapshot below rather than by hand-picked examples:
	// three `toEqual` assertions duplicating snapshot entries meant every metadata edit had to be
	// made twice, and `josh-command-reference.test.ts` now checks each synopsis against its own
	// parser, which is what those examples were reaching for.
	it('keeps every canonical command and alias stable', () => {
		const references = Object.fromEntries(
			Object.entries(COMMAND_MAP).map(([name, entry]) => [name, entry.reference]),
		)

		expect({ aliases: ALIASES, references }).toMatchSnapshot()
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

	it('resolves version command with script and Versioning category', () => {
		const entry = get_command('version')

		expect(entry?.script).toBeDefined()
		expect(entry?.category).toBe('Versioning')
	})
})

describe('COMMAND_MAP — new dev commands', () => {
	it('routes test:e2e through the guard script instead of a raw shell command', () => {
		const entry = get_command(TEST_E2E_COMMAND)

		expect(entry?.script).toBe('scripts/test/test-e2e-guard.ts')
		expect(entry?.shell).toBeUndefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})

	it('routes test:unit through the guard script instead of a raw shell command', () => {
		const entry = get_command(TEST_UNIT_COMMAND)

		expect(entry?.script).toBe('scripts/test/test-unit-guard.ts')
		expect(entry?.shell).toBeUndefined()
		expect(entry?.category).toBe(DEVELOPMENT_CATEGORY)
	})
})

describe('COMMAND_MAP — tsx_arguments', () => {
	// joshuafolkken/kit#1564: the optional form, not merely "an env-file flag". Both commands are run
	// where no `.env` exists — a cloud session carries `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as
	// environment variables — and the mandatory form aborts before the script's first line there.
	it('followup command reads .env only when it exists', () => {
		const entry = get_command('followup')

		expect(entry?.tsx_arguments).toBeDefined()
		expect(entry?.tsx_arguments).toContain(OPTIONAL_ENV_FILE_FLAG)
	})

	it('notify command reads .env only when it exists', () => {
		const entry = get_command('notify')

		expect(entry?.tsx_arguments).toContain(OPTIONAL_ENV_FILE_FLAG)
	})

	// #820 put a `--env-file-if-exists=.env` flag here so `josh port` and `playwright.config.ts`
	// would read one file. #826 replaced it: the flag resolved `.env` against the working directory,
	// while the config resolves it at the project root, so the two disagreed again from a
	// subdirectory. The command now calls the same resolver the config does — carrying the flag as
	// well would only reload the whole file, secrets included, into this process.
	it('port command reads .env through the shared resolver rather than an env-file flag', () => {
		expect(get_command('port')?.tsx_arguments).toBeUndefined()
	})

	it('lint command has no tsx_arguments', () => {
		expect(get_command('lint')?.tsx_arguments).toBeUndefined()
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

	it('resolves tu alias to test:unit', () => {
		expect(get_alias('tu')).toBe('test:unit')
	})

	it('no duplicate alias keys', () => {
		expect(ALL_ALIAS_KEYS).toHaveLength(new Set(ALL_ALIAS_KEYS).size)
	})
})

describe('ALIASES — new command aliases', () => {
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

describe('COMMAND_MAP — side effects vocabulary', () => {
	it("'none' is exclusive — not combined with other side effects", () => {
		for (const [name, entry] of Object.entries(COMMAND_MAP)) {
			if (!entry.reference[2].includes('none')) continue
			expect(
				entry.reference[2],
				`command ${name} mixes 'none' with other side effects`,
			).toHaveLength(1)
		}
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
		expect(CATEGORY_ORDER).toHaveLength(new Set(CATEGORY_ORDER).size)
	})

	it('starts with Development and ends with AI tools', () => {
		expect(CATEGORY_ORDER[0]).toBe(DEVELOPMENT_CATEGORY)
		expect(CATEGORY_ORDER.at(-1)).toBe('AI tools')
	})
})
