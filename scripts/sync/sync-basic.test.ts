import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths_mock = vi.hoisted(() => ({ root: '' }))
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

vi.mock('#scripts/init/init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	PACKAGE_DIR: REPOSITORY_ROOT,
	package_path: (relative_path: string): string => path.join(REPOSITORY_ROOT, relative_path),
}))

const BASIC = 'basic'
const CLAUDE_MD = 'CLAUDE.md'
const BASIC_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md'
const STATIC_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.static.md'
const FULL_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.md'
const PROJECT_NOTES = '## Project notes\n'
const PRETTIER_CONFIG = 'prettier.config.mjs'
const PRETTIER_IGNORE = '.prettierignore'
const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const CI_WORKFLOW = '.github/workflows/ci.yml'
const CODERABBIT = '.coderabbit.yaml'
// What `josh init` deliberately leaves out of a basic project.
const FULL_ONLY_FILES = [
	CI_WORKFLOW,
	'.claude/settings.json',
	'.codex/hooks.json',
	'.codex/config.toml',
	CODERABBIT,
	'tsconfig.sonar.json',
	'sonar-project.properties',
	'eslint.config.js',
	'lefthook.yml',
]

function project_file(name: string): string {
	return path.join(paths_mock.root, name)
}

function read_project_file(name: string): string {
	return readFileSync(project_file(name), 'utf8')
}

function read_template(name: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, 'templates', name), 'utf8')
}

function prettier_config(preset: string): string {
	return `import { config } from '@joshuafolkken/kit/prettier/${preset}'\n\nexport default config\n`
}

function write_manifest(profile: string): void {
	writeFileSync(project_file('package.json'), JSON.stringify({ private: true, josh: { profile } }))
}

async function run_sync(profile: string): Promise<void> {
	write_manifest(profile)
	const { main } = await import('./sync')

	main()
}

beforeEach(() => {
	paths_mock.root = mkdtempSync(path.join(tmpdir(), 'sync-basic-'))
	writeFileSync(project_file('index.html'), '<h1>Hello</h1>')
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	vi.spyOn(console, 'warn').mockImplementation(() => {
		/* suppress */
	})
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('josh sync file set in a basic project', () => {
	it.each([BASIC, 'static'])(
		'writes no file init leaves out when profile is %s',
		async (profile) => {
			await run_sync(profile)

			for (const name of FULL_ONLY_FILES) expect(existsSync(project_file(name)), name).toBe(false)
		},
	)

	it('writes the basic templates rather than the full copies', async () => {
		await run_sync(BASIC)

		expect(read_project_file(PRETTIER_IGNORE)).toBe(read_template('prettierignore.basic'))
		expect(read_project_file('.cursorrules')).toBe(read_template('cursorrules.basic'))
		expect(read_project_file(WORKSPACE_YAML)).toContain('esbuild: true')
		expect(read_project_file(WORKSPACE_YAML)).not.toContain('overrides:')
	})
})

describe('josh sync path migration in a basic project', () => {
	it('creates a CLAUDE.md that imports only the basic rules', async () => {
		await run_sync(BASIC)

		expect(read_project_file(CLAUDE_MD)).toContain(BASIC_IMPORT)
		expect(read_project_file(CLAUDE_MD)).not.toContain(FULL_IMPORT)
	})

	it('moves a pre-rename CLAUDE.md import onto the basic path and adds no full import', async () => {
		writeFileSync(project_file(CLAUDE_MD), `${STATIC_IMPORT}\n\n## Project notes\n`)
		await run_sync(BASIC)

		expect(read_project_file(CLAUDE_MD)).toBe(`${BASIC_IMPORT}\n\n## Project notes\n`)
	})

	it('removes the full import an earlier sync wrote above the basic one', async () => {
		const { init_logic } = await import('#scripts/init/init-logic')
		const basic = `${STATIC_IMPORT}\n\n## Project notes\n`

		writeFileSync(project_file(CLAUDE_MD), init_logic.ensure_claude_md_import(basic))
		await run_sync(BASIC)

		expect(read_project_file(CLAUDE_MD)).toBe(`${BASIC_IMPORT}\n\n## Project notes\n`)
	})

	it('replaces the full import of a project switched from full with the basic header', async () => {
		const { init_ai_copy } = await import('#scripts/init/init-ai-copy')
		const { init_logic } = await import('#scripts/init/init-logic')

		writeFileSync(project_file(CLAUDE_MD), init_logic.ensure_claude_md_import(PROJECT_NOTES))
		await run_sync(BASIC)

		expect(read_project_file(CLAUDE_MD)).toBe(
			`${init_ai_copy.ensure_basic_claude_md(undefined)}\n${PROJECT_NOTES}`,
		)
	})

	it('moves a pre-rename prettier preset path onto the basic one', async () => {
		writeFileSync(project_file(PRETTIER_CONFIG), prettier_config('static'))
		await run_sync(BASIC)

		expect(read_project_file(PRETTIER_CONFIG)).toBe(prettier_config(BASIC))
	})
})

describe('josh sync AI files in a full project', () => {
	it('still writes the full file set and the full CLAUDE.md import', async () => {
		write_manifest('full')
		const { sync_ai_files } = await import('./sync-ai-files')

		sync_ai_files.sync_ai_copy_all(false)

		expect(existsSync(project_file(CI_WORKFLOW))).toBe(true)
		expect(existsSync(project_file(CODERABBIT))).toBe(true)
		expect(read_project_file(CLAUDE_MD)).toContain(FULL_IMPORT)
		expect(read_project_file(PRETTIER_IGNORE)).toBe(
			readFileSync(path.join(REPOSITORY_ROOT, PRETTIER_IGNORE), 'utf8'),
		)
	})
})
