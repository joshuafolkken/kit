import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const TEST_DIR = path.join(tmpdir(), 'sync-configs-test')
const VSCODE_DIR = path.join(TEST_DIR, '.vscode')
const UNCHANGED_LABEL = 'unchanged'

beforeEach(() => {
	mkdirSync(VSCODE_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function silence_console_info(): void {
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
}

function assert_logs_unchanged(setup: () => void, run: () => void): void {
	setup()
	const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})

	run()
	expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(UNCHANGED_LABEL))
}

const NPMRC_DEST = path.join(TEST_DIR, '.npmrc')
const NPMRC_UP_TO_DATE = init_logic.generate_npmrc()

describe('sync_configs.sync_npmrc', () => {
	it('does nothing when .npmrc does not exist', () => {
		sync_configs.sync_npmrc(NPMRC_DEST)
		expect(existsSync(NPMRC_DEST)).toBe(false)
	})

	it('logs unchanged when all required lines present', () => {
		assert_logs_unchanged(
			() => {
				writeFileSync(NPMRC_DEST, NPMRC_UP_TO_DATE)
			},
			() => {
				sync_configs.sync_npmrc(NPMRC_DEST)
			},
		)
	})

	it('appends missing lines when outdated', () => {
		writeFileSync(NPMRC_DEST, 'engine-strict=true\n')
		silence_console_info()
		sync_configs.sync_npmrc(NPMRC_DEST)
		expect(readFileSync(NPMRC_DEST, 'utf8')).toContain('confirmModulesPurge=false')
	})
})

const ESLINT_DEST = path.join(TEST_DIR, 'eslint.config.js')
const ESLINT_VANILLA_UP_TO_DATE = init_logic.generate_eslint_config()

const VANILLA_ESLINT_OUTDATED = `import js from '@eslint/js'\nimport ts from 'typescript-eslint'\n\nexport default ts.config(\n\tjs.configs.recommended,\n\t...ts.configs.recommended,\n)\n`
const VANILLA_ESLINT_WITH_USER_RULES = `import js from '@eslint/js'\nimport ts from 'typescript-eslint'\n\nexport default ts.config(\n\tjs.configs.recommended,\n\t...ts.configs.recommended,\n\t{\n\t\trules: {\n\t\t\t'no-console': 'warn',\n\t\t},\n\t},\n)\n`

describe('sync_configs.sync_eslint_config — baseline', () => {
	it('does nothing when eslint.config.js does not exist', () => {
		sync_configs.sync_eslint_config(ESLINT_DEST)
		expect(existsSync(ESLINT_DEST)).toBe(false)
	})

	it('logs unchanged when file matches generated template', () => {
		assert_logs_unchanged(
			() => {
				writeFileSync(ESLINT_DEST, ESLINT_VANILLA_UP_TO_DATE)
			},
			() => {
				sync_configs.sync_eslint_config(ESLINT_DEST)
			},
		)
	})
})

describe('sync_configs.sync_eslint_config — migration', () => {
	it('migrates vanilla outdated config to strict create_vanilla_config shape', () => {
		writeFileSync(ESLINT_DEST, VANILLA_ESLINT_OUTDATED)
		silence_console_info()
		sync_configs.sync_eslint_config(ESLINT_DEST)
		expect(readFileSync(ESLINT_DEST, 'utf8')).toBe(ESLINT_VANILLA_UP_TO_DATE)
	})

	it('preserves user-added rules when migrating vanilla outdated config', () => {
		writeFileSync(ESLINT_DEST, VANILLA_ESLINT_WITH_USER_RULES)
		silence_console_info()
		sync_configs.sync_eslint_config(ESLINT_DEST)

		const result = readFileSync(ESLINT_DEST, 'utf8')

		expect(result).toContain('create_vanilla_config')
		expect(result).toContain("'no-console': 'warn'")
	})

	it('leaves hand-rolled non-vanilla config unchanged (safe fallback)', () => {
		const hand_rolled = `import { custom } from './my-config.js'\n\nexport default custom()\n`

		assert_logs_unchanged(
			() => {
				writeFileSync(ESLINT_DEST, hand_rolled)
			},
			() => {
				sync_configs.sync_eslint_config(ESLINT_DEST)
			},
		)
		expect(readFileSync(ESLINT_DEST, 'utf8')).toBe(hand_rolled)
	})
})

const TSCONFIG_DEST = path.join(TEST_DIR, 'tsconfig.json')
const TSCONFIG_EXTENDS_ENTRY = init_logic.get_tsconfig_extends_entry()
const TSCONFIG_UP_TO_DATE = `${JSON.stringify({ extends: [TSCONFIG_EXTENDS_ENTRY] }, undefined, '\t')}\n`

describe('sync_configs.sync_tsconfig', () => {
	it('does nothing when tsconfig.json does not exist', () => {
		sync_configs.sync_tsconfig(TSCONFIG_DEST)
		expect(existsSync(TSCONFIG_DEST)).toBe(false)
	})

	it('logs unchanged when tsconfig extends already contains kit preset', () => {
		assert_logs_unchanged(
			() => {
				writeFileSync(TSCONFIG_DEST, TSCONFIG_UP_TO_DATE)
			},
			() => {
				sync_configs.sync_tsconfig(TSCONFIG_DEST)
			},
		)
	})

	it('prepends preset entry when outdated', () => {
		writeFileSync(TSCONFIG_DEST, '{"extends": ["./other.json"]}\n')
		silence_console_info()
		sync_configs.sync_tsconfig(TSCONFIG_DEST)
		expect(readFileSync(TSCONFIG_DEST, 'utf8')).toContain(TSCONFIG_EXTENDS_ENTRY)
	})
})

const CSPELL_DEST = path.join(TEST_DIR, 'cspell.config.yaml')
const CSPELL_UP_TO_DATE = init_logic.generate_cspell_config()
const CSPELL_IMPORT_VALUE = init_logic.get_cspell_import_value()

describe('sync_configs.sync_cspell_config', () => {
	it('does nothing when cspell.config.yaml does not exist', () => {
		sync_configs.sync_cspell_config(CSPELL_DEST)
		expect(existsSync(CSPELL_DEST)).toBe(false)
	})

	it('logs unchanged when cspell import already present', () => {
		assert_logs_unchanged(
			() => {
				writeFileSync(CSPELL_DEST, CSPELL_UP_TO_DATE)
			},
			() => {
				sync_configs.sync_cspell_config(CSPELL_DEST)
			},
		)
	})

	it('adds import entry when outdated', () => {
		writeFileSync(CSPELL_DEST, "version: '0.2'\nwords: []\n")
		silence_console_info()
		sync_configs.sync_cspell_config(CSPELL_DEST)
		expect(readFileSync(CSPELL_DEST, 'utf8')).toContain(CSPELL_IMPORT_VALUE)
	})
})

const LEFTHOOK_DEST = path.join(TEST_DIR, 'lefthook.yml')
const LEFTHOOK_EXTENDS_VALUE = init_logic.get_lefthook_extends_value()
const LEFTHOOK_UP_TO_DATE = init_logic.generate_lefthook_config()

describe('sync_configs.sync_lefthook_config', () => {
	it('does nothing when lefthook.yml does not exist', () => {
		sync_configs.sync_lefthook_config(LEFTHOOK_DEST)
		expect(existsSync(LEFTHOOK_DEST)).toBe(false)
	})

	it('logs unchanged when lefthook extends already contains kit preset', () => {
		assert_logs_unchanged(
			() => {
				writeFileSync(LEFTHOOK_DEST, LEFTHOOK_UP_TO_DATE)
			},
			() => {
				sync_configs.sync_lefthook_config(LEFTHOOK_DEST)
			},
		)
	})

	it('adds extends entry when outdated', () => {
		writeFileSync(LEFTHOOK_DEST, 'extends:\n  - other.yml\n')
		silence_console_info()
		sync_configs.sync_lefthook_config(LEFTHOOK_DEST)
		expect(readFileSync(LEFTHOOK_DEST, 'utf8')).toContain(LEFTHOOK_EXTENDS_VALUE)
	})
})

const VSCODE_EXTENSIONS_DEST = path.join(VSCODE_DIR, 'extensions.json')
const VSCODE_SETTINGS_DEST = path.join(VSCODE_DIR, 'settings.json')
const EDITOR_FORMAT_ON_SAVE_KEY = 'editor.formatOnSave'

function populate_via_sync(
	initial_content: string,
	sync_function: (destination_path: string) => void,
	destination_path: string,
): string {
	writeFileSync(destination_path, initial_content)
	silence_console_info()
	sync_function(destination_path)

	return readFileSync(destination_path, 'utf8')
}

describe('sync_configs.sync_vscode_extensions_json', () => {
	it('does nothing when .vscode/extensions.json does not exist', () => {
		sync_configs.sync_vscode_extensions_json(VSCODE_EXTENSIONS_DEST)
		expect(existsSync(VSCODE_EXTENSIONS_DEST)).toBe(false)
	})

	it('logs unchanged when all kit recommendations already listed', () => {
		const populated = populate_via_sync(
			'{"recommendations": []}',
			sync_configs.sync_vscode_extensions_json,
			VSCODE_EXTENSIONS_DEST,
		)

		assert_logs_unchanged(
			() => {
				writeFileSync(VSCODE_EXTENSIONS_DEST, populated)
			},
			() => {
				sync_configs.sync_vscode_extensions_json(VSCODE_EXTENSIONS_DEST)
			},
		)
	})

	it('adds missing recommendations when outdated', () => {
		writeFileSync(VSCODE_EXTENSIONS_DEST, '{"recommendations": ["custom.extension"]}')
		silence_console_info()
		sync_configs.sync_vscode_extensions_json(VSCODE_EXTENSIONS_DEST)

		const result = readFileSync(VSCODE_EXTENSIONS_DEST, 'utf8')

		expect(result).toContain('custom.extension')
		expect(result).toContain('esbenp.prettier-vscode')
	})
})

describe('sync_configs.sync_vscode_settings_json', () => {
	it('does nothing when .vscode/settings.json does not exist', () => {
		sync_configs.sync_vscode_settings_json(VSCODE_SETTINGS_DEST)
		expect(existsSync(VSCODE_SETTINGS_DEST)).toBe(false)
	})

	it('logs unchanged when all kit settings keys present', () => {
		const populated = populate_via_sync(
			'{}',
			sync_configs.sync_vscode_settings_json,
			VSCODE_SETTINGS_DEST,
		)

		assert_logs_unchanged(
			() => {
				writeFileSync(VSCODE_SETTINGS_DEST, populated)
			},
			() => {
				sync_configs.sync_vscode_settings_json(VSCODE_SETTINGS_DEST)
			},
		)
	})

	it('adds missing keys when outdated', () => {
		writeFileSync(VSCODE_SETTINGS_DEST, '{"custom.key": true}')
		silence_console_info()
		sync_configs.sync_vscode_settings_json(VSCODE_SETTINGS_DEST)

		const result = readFileSync(VSCODE_SETTINGS_DEST, 'utf8')

		expect(result).toContain('custom.key')
		expect(result).toContain(EDITOR_FORMAT_ON_SAVE_KEY)
	})
})

describe('sync_configs.sync_vscode_settings_json kit-only filtering', () => {
	it('does not distribute kit-only SonarLint settings to consumers', () => {
		const populated = populate_via_sync(
			'{}',
			sync_configs.sync_vscode_settings_json,
			VSCODE_SETTINGS_DEST,
		)

		expect(populated).not.toContain('sonarlint')
		expect(populated).toContain(EDITOR_FORMAT_ON_SAVE_KEY)
	})
})
