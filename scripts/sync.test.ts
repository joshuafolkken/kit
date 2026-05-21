import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PACKAGE_DIR } from './init-paths'
import { sync } from './sync'

const TEST_DIR = path.join(tmpdir(), 'sync-test')
const SRC_PATH = path.join(TEST_DIR, 'src', 'gitignore')
const GITIGNORE_DEST_NAME = '.gitignore'
const DEST_PATH = path.join(TEST_DIR, 'dest', GITIGNORE_DEST_NAME)

beforeEach(() => {
	mkdirSync(path.join(TEST_DIR, 'src'), { recursive: true })
	mkdirSync(path.join(TEST_DIR, 'dest'), { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('sync_file_mapping', () => {
	it('copies src to dest when src exists', () => {
		writeFileSync(SRC_PATH, 'node_modules\n')
		sync.sync_file_mapping(SRC_PATH, DEST_PATH)

		expect(existsSync(DEST_PATH)).toBe(true)
		expect(readFileSync(DEST_PATH, 'utf8')).toBe('node_modules\n')
	})

	it('creates dest directory when it does not exist', () => {
		const nested_destination = path.join(TEST_DIR, 'new', 'nested', GITIGNORE_DEST_NAME)

		writeFileSync(SRC_PATH, 'node_modules\n')
		sync.sync_file_mapping(SRC_PATH, nested_destination)

		expect(existsSync(nested_destination)).toBe(true)
	})

	it('warns and does not throw when src does not exist', () => {
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {
			/* suppress */
		})
		const missing_source = path.join(TEST_DIR, 'src', 'missing')

		expect(() => {
			sync.sync_file_mapping(missing_source, DEST_PATH)
		}).not.toThrow()
		expect(warn_spy).toHaveBeenCalledOnce()
		expect(warn_spy.mock.calls[0]?.[0]).toContain('skipped')
	})

	it('does not create dest file when src does not exist', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {
			/* suppress */
		})
		const missing_source = path.join(TEST_DIR, 'src', 'missing')

		sync.sync_file_mapping(missing_source, DEST_PATH)

		expect(existsSync(DEST_PATH)).toBe(false)
	})
})

const WORKSPACE_YAML_NAME = 'pnpm-workspace.yaml'
const WORKSPACE_SRC = path.join(TEST_DIR, 'src', WORKSPACE_YAML_NAME)
const WORKSPACE_DEST = path.join(TEST_DIR, 'dest', WORKSPACE_YAML_NAME)
const TEMPLATE_CONTENT = 'allowBuilds:\n  esbuild: true\n\nminimumReleaseAgeExclude:\n  - vite\n'
const DEPRECATED_ONLY_BUILT_KEY = 'onlyBuiltDependencies:'

describe('sync_workspace_yaml', () => {
	it('writes template content when dest does not exist', () => {
		writeFileSync(WORKSPACE_SRC, TEMPLATE_CONTENT)
		sync.sync_workspace_yaml(WORKSPACE_SRC, WORKSPACE_DEST)

		expect(readFileSync(WORKSPACE_DEST, 'utf8')).toBe(TEMPLATE_CONTENT)
	})

	it('preserves user-defined keys and drops deprecated onlyBuiltDependencies', () => {
		const existing = `packages:\n  - "@joshuafolkken/kit"\n${DEPRECATED_ONLY_BUILT_KEY}\n  - esbuild\n`

		writeFileSync(WORKSPACE_SRC, TEMPLATE_CONTENT)
		writeFileSync(WORKSPACE_DEST, existing)
		sync.sync_workspace_yaml(WORKSPACE_SRC, WORKSPACE_DEST)

		const result = readFileSync(WORKSPACE_DEST, 'utf8')

		expect(result).toContain('packages:')
		expect(result).not.toContain(DEPRECATED_ONLY_BUILT_KEY)
	})

	it('creates destination directory when workspace dest path does not exist', () => {
		const nested = path.join(TEST_DIR, 'nested', 'dir', WORKSPACE_YAML_NAME)

		writeFileSync(WORKSPACE_SRC, TEMPLATE_CONTENT)
		sync.sync_workspace_yaml(WORKSPACE_SRC, nested)

		expect(existsSync(nested)).toBe(true)
	})

	it('drops deprecated onlyBuiltDependencies and uses template allowBuilds', () => {
		const existing = `${DEPRECATED_ONLY_BUILT_KEY}\n  - old-value\n`

		writeFileSync(WORKSPACE_SRC, TEMPLATE_CONTENT)
		writeFileSync(WORKSPACE_DEST, existing)
		sync.sync_workspace_yaml(WORKSPACE_SRC, WORKSPACE_DEST)

		const result = readFileSync(WORKSPACE_DEST, 'utf8')

		expect(result).toContain('allowBuilds:')
		expect(result).not.toContain(DEPRECATED_ONLY_BUILT_KEY)
		expect(result).not.toContain('old-value')
	})
})

const PRETTIER_DEST = path.join(TEST_DIR, 'dest', 'prettier.config.js')
const PRETTIERRC_PATH = path.join(TEST_DIR, 'dest', '.prettierrc')
const OLD_PRETTIER_CONTENT = `{\n\t"useTabs": true,\n\t"tailwindStylesheet": "./src/app.css"\n}`
const NEW_PRETTIER_CONTENT = `import { config } from '@joshuafolkken/kit/prettier'\n\nexport default {\n\t...config,\n\ttailwindStylesheet: './src/app.css',\n}\n`
const KIT_PRETTIER_IMPORT = "from '@joshuafolkken/kit/prettier'"
const APP_CSS_STYLESHEET = "tailwindStylesheet: './src/app.css'"

describe('migrate_prettierrc', () => {
	it('returns false and does nothing when .prettierrc does not exist', () => {
		const is_migrated = sync.migrate_prettierrc(PRETTIER_DEST)

		expect(is_migrated).toBe(false)
		expect(existsSync(PRETTIER_DEST)).toBe(false)
	})

	it('returns true, writes prettier.config.js, and deletes .prettierrc', () => {
		writeFileSync(PRETTIERRC_PATH, OLD_PRETTIER_CONTENT)
		const is_migrated = sync.migrate_prettierrc(PRETTIER_DEST)

		expect(is_migrated).toBe(true)
		expect(existsSync(PRETTIERRC_PATH)).toBe(false)
		expect(existsSync(PRETTIER_DEST)).toBe(true)
	})

	it('preserves tailwindStylesheet from .prettierrc during migration', () => {
		writeFileSync(PRETTIERRC_PATH, OLD_PRETTIER_CONTENT)
		sync.migrate_prettierrc(PRETTIER_DEST)

		const migrated_content = readFileSync(PRETTIER_DEST, 'utf8')

		expect(migrated_content).toContain(KIT_PRETTIER_IMPORT)
		expect(migrated_content).toContain(APP_CSS_STYLESHEET)
	})

	it('uses default tailwindStylesheet when .prettierrc has no tailwindStylesheet', () => {
		writeFileSync(PRETTIERRC_PATH, `{\n\t"useTabs": true\n}`)
		sync.migrate_prettierrc(PRETTIER_DEST)

		expect(readFileSync(PRETTIER_DEST, 'utf8')).toContain(
			"tailwindStylesheet: './src/routes/layout.css'",
		)
	})
})

describe('sync_prettier_config', () => {
	it('does nothing when file does not exist', () => {
		sync.sync_prettier_config(PRETTIER_DEST)
		expect(existsSync(PRETTIER_DEST)).toBe(false)
	})

	it('migrates .prettierrc when it exists and logs migrated', () => {
		writeFileSync(PRETTIERRC_PATH, OLD_PRETTIER_CONTENT)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync.sync_prettier_config(PRETTIER_DEST)

		expect(existsSync(PRETTIERRC_PATH)).toBe(false)
		expect(existsSync(PRETTIER_DEST)).toBe(true)
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('migrated'))
	})

	it('rewrites old JSON format to kit template, preserving tailwindStylesheet', () => {
		writeFileSync(PRETTIER_DEST, OLD_PRETTIER_CONTENT)
		sync.sync_prettier_config(PRETTIER_DEST)

		const synced_content = readFileSync(PRETTIER_DEST, 'utf8')

		expect(synced_content).toContain(KIT_PRETTIER_IMPORT)
		expect(synced_content).toContain(APP_CSS_STYLESHEET)
	})

	it('does not rewrite file that already matches merged output', () => {
		writeFileSync(PRETTIER_DEST, NEW_PRETTIER_CONTENT)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync.sync_prettier_config(PRETTIER_DEST)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
		expect(readFileSync(PRETTIER_DEST, 'utf8')).toBe(NEW_PRETTIER_CONTENT)
	})
})

const PLAYWRIGHT_CONFIG_FILENAME = 'playwright.config.ts'
const PLAYWRIGHT_DEST = path.join(TEST_DIR, 'dest', PLAYWRIGHT_CONFIG_FILENAME)
const PLAYWRIGHT_TEMPLATE_HEADER =
	"import { defineConfig, devices, type ReporterDescription } from '@playwright/test'"
const PLAYWRIGHT_TEMPLATE = readFileSync(path.join(PACKAGE_DIR, PLAYWRIGHT_CONFIG_FILENAME), 'utf8')

describe('sync_playwright_config', () => {
	it('does nothing when playwright.config.ts does not exist', () => {
		sync.sync_playwright_config(PLAYWRIGHT_DEST)

		expect(existsSync(PLAYWRIGHT_DEST)).toBe(false)
	})

	it('overwrites outdated file with current template', () => {
		const legacy = `import { defineConfig } from '@playwright/test'\nexport default defineConfig({})\n`

		writeFileSync(PLAYWRIGHT_DEST, legacy)
		sync.sync_playwright_config(PLAYWRIGHT_DEST)

		expect(readFileSync(PLAYWRIGHT_DEST, 'utf8')).toContain(PLAYWRIGHT_TEMPLATE_HEADER)
	})

	it('logs unchanged when file already matches template', () => {
		writeFileSync(PLAYWRIGHT_DEST, PLAYWRIGHT_TEMPLATE)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync.sync_playwright_config(PLAYWRIGHT_DEST)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
		expect(readFileSync(PLAYWRIGHT_DEST, 'utf8')).toBe(PLAYWRIGHT_TEMPLATE)
	})
})

const WRANGLER_JSONC_NAME = 'wrangler.jsonc'
const WRANGLER_SRC = path.join(TEST_DIR, 'src', WRANGLER_JSONC_NAME)
const WRANGLER_DEST = path.join(TEST_DIR, 'dest', WRANGLER_JSONC_NAME)
const OLD_DATE = '2025-01-01'
const NEW_DATE = '2026-05-12'
const WRANGLER_TEMPLATE = `{\n\t"compatibility_date": "${NEW_DATE}"\n}\n`
const WRANGLER_EXISTING = `{\n\t"compatibility_date": "${OLD_DATE}",\n\t"name": "myapp"\n}\n`

describe('sync_wrangler_jsonc_merge', () => {
	it('updates compatibility_date in existing wrangler.jsonc', () => {
		writeFileSync(WRANGLER_SRC, WRANGLER_TEMPLATE)
		writeFileSync(WRANGLER_DEST, WRANGLER_EXISTING)
		sync.sync_wrangler_jsonc_merge(WRANGLER_SRC, WRANGLER_DEST)

		expect(readFileSync(WRANGLER_DEST, 'utf8')).toContain(`"compatibility_date": "${NEW_DATE}"`)
	})

	it('preserves other fields when updating compatibility_date', () => {
		writeFileSync(WRANGLER_SRC, WRANGLER_TEMPLATE)
		writeFileSync(WRANGLER_DEST, WRANGLER_EXISTING)
		sync.sync_wrangler_jsonc_merge(WRANGLER_SRC, WRANGLER_DEST)

		expect(readFileSync(WRANGLER_DEST, 'utf8')).toContain('"name": "myapp"')
	})

	it('creates file from template when destination does not exist', () => {
		writeFileSync(WRANGLER_SRC, WRANGLER_TEMPLATE)
		sync.sync_wrangler_jsonc_merge(WRANGLER_SRC, WRANGLER_DEST)

		expect(existsSync(WRANGLER_DEST)).toBe(true)
		expect(readFileSync(WRANGLER_DEST, 'utf8')).toContain(`"compatibility_date": "${NEW_DATE}"`)
	})
})

const NO_REFERENCES_CONTENT = 'no references here\n'

describe('sync_ai_file', () => {
	it('writes file content to destination', () => {
		writeFileSync(SRC_PATH, NO_REFERENCES_CONTENT)
		sync.sync_ai_file(SRC_PATH, DEST_PATH)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(NO_REFERENCES_CONTENT)
	})

	it('transforms prompts/ references to node_modules package path', () => {
		writeFileSync(SRC_PATH, 'see `prompts/refactoring.md`\n')
		sync.sync_ai_file(SRC_PATH, DEST_PATH)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(
			'see `node_modules/@joshuafolkken/kit/prompts/refactoring.md`\n',
		)
	})

	it('creates nested destination directory for ai file', () => {
		const nested_destination = path.join(TEST_DIR, 'nested', 'dir', 'CLAUDE.md')

		writeFileSync(SRC_PATH, 'content\n')
		sync.sync_ai_file(SRC_PATH, nested_destination)

		expect(existsSync(nested_destination)).toBe(true)
	})
})
