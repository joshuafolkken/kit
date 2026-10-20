import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const PACKAGE_JSON = 'package.json'
const CLAUDE_MD = 'CLAUDE.md'
const BASIC_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md'
const FULL_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.md'
const PROJECT_NOTES = '## Project notes\n'
const PRETTIER_IGNORE = '.prettierignore'
const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const CI_WORKFLOW = '.github/workflows/ci.yml'
const CODERABBIT = '.coderabbit.yaml'
const AGENT_POINTERS = ['AGENTS', 'GEMINI']
const CLAUDE_SETTINGS = '.claude/settings.json'
const OWN_PERMISSION = 'Bash(python -m unittest)'
// What `josh init` deliberately leaves out of a basic project `josh start` did not set up.
const FULL_ONLY_FILES = [
	CI_WORKFLOW,
	CLAUDE_SETTINGS,
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

function read_repository_file(name: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, name), 'utf8')
}

function write_manifest(profile: string): void {
	writeFileSync(project_file(PACKAGE_JSON), JSON.stringify({ private: true, josh: { profile } }))
}

// A basic project `josh start` set up, whose `.claude/settings.json` holds a permission of its own.
function write_workflow_project(): void {
	const manifest = { private: true, josh: { profile: BASIC, workflow: 'github' } }
	const settings_path = project_file(CLAUDE_SETTINGS)

	writeFileSync(project_file(PACKAGE_JSON), JSON.stringify(manifest))
	mkdirSync(project_file('.git'))
	mkdirSync(path.dirname(settings_path))
	writeFileSync(settings_path, JSON.stringify({ permissions: { allow: [OWN_PERMISSION] } }))
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

describe('josh sync in a basic project josh start set up (#3796)', () => {
	it('merges .claude/settings.json, keeping what the project added', async () => {
		write_workflow_project()
		const { main } = await import('./sync')

		main()
		const settings = read_project_file(CLAUDE_SETTINGS)

		expect(settings).toContain(OWN_PERMISSION)
		expect(settings).toContain('Bash(*)')
		expect(settings).toContain('enabledPlugins')
		expect(existsSync(project_file(CI_WORKFLOW))).toBe(false)
	})
})

describe('josh sync file set in a basic project', () => {
	it.each([BASIC, 'static'])(
		'writes no file init leaves out when profile is %s',
		async (profile) => {
			await run_sync(profile)

			for (const name of FULL_ONLY_FILES) expect(existsSync(project_file(name)), name).toBe(false)
		},
	)

	// `josh init` adds the full toolchain to no basic project, so `josh sync` adds none later either.
	it('adds no toolchain devDependencies, Git repository or not', async () => {
		mkdirSync(project_file('.git'))
		await run_sync(BASIC)

		expect(read_project_file(PACKAGE_JSON)).not.toContain('devDependencies')
	})

	it('writes the basic templates rather than the full copies', async () => {
		await run_sync(BASIC)

		expect(read_project_file(PRETTIER_IGNORE)).toBe(read_template('prettierignore.basic'))
		expect(read_project_file('.cursorrules')).toBe(read_template('cursorrules.basic'))
		expect(read_project_file(WORKSPACE_YAML)).toContain('esbuild: true')
		expect(read_project_file(WORKSPACE_YAML)).not.toContain('overrides:')
	})

	it.each(AGENT_POINTERS)(
		'replaces the full %s.md an earlier init wrote with the basic one',
		async (name) => {
			const filename = `${name}.md`

			writeFileSync(project_file(filename), read_repository_file(filename))
			await run_sync(BASIC)

			expect(read_project_file(filename)).toBe(read_template(`${name}.basic.md`))
			expect(read_project_file(filename)).not.toContain('prompts/')
		},
	)
})

describe('josh sync CLAUDE.md in a basic project', () => {
	it('creates a CLAUDE.md that imports only the basic rules', async () => {
		await run_sync(BASIC)

		expect(read_project_file(CLAUDE_MD)).toContain(BASIC_IMPORT)
		expect(read_project_file(CLAUDE_MD)).not.toContain(FULL_IMPORT)
	})

	it('removes the full import an earlier sync wrote above the basic one', async () => {
		const { init_logic } = await import('#scripts/init/init-logic')
		const basic = `${BASIC_IMPORT}\n\n## Project notes\n`

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
})

describe('josh sync AI files in a full project', () => {
	it('still writes the full file set and the full CLAUDE.md import', async () => {
		write_manifest('full')
		const { sync_ai_files } = await import('./sync-ai-files')

		sync_ai_files.sync_ai_copy_all(false)

		expect(existsSync(project_file(CI_WORKFLOW))).toBe(true)
		expect(existsSync(project_file(CODERABBIT))).toBe(true)
		expect(read_project_file(CLAUDE_MD)).toContain(FULL_IMPORT)
		expect(read_project_file(PRETTIER_IGNORE)).toBe(read_repository_file(PRETTIER_IGNORE))
	})

	it.each(AGENT_POINTERS)('still writes the %s.md that names the hook rules', async (name) => {
		write_manifest('full')
		const { sync_ai_files } = await import('./sync-ai-files')

		sync_ai_files.sync_ai_copy_all(false)

		expect(read_project_file(`${name}.md`)).not.toBe(read_template(`${name}.basic.md`))
		expect(read_project_file(`${name}.md`)).toContain('collaboration-workflow/principles.md')
	})
})
