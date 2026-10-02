import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init_logic } from './init-logic'

const paths_mock = vi.hoisted(() => ({ root: '', package_dir: '' }))

vi.mock('./init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	get PACKAGE_DIR(): string {
		return paths_mock.package_dir
	},
	package_path: (relative_path: string): string => path.join(paths_mock.package_dir, relative_path),
}))
vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))
const mocked_execa = vi.mocked(execaSync)
const PACKAGE_JSON = 'package.json'
const INDEX_HTML = 'index.html'
const GITIGNORE = '.gitignore'
const GITHUB_DIR = '.github'
const BASIC_PROFILE_ENTRY = '"profile": "basic"'
const SECURITY_MD = 'SECURITY.md'
const BASIC_PRETTIER = 'prettier.config.mjs'
const NO_INSTALL = '--no-install'
const INSTALL_HINT = 'run `pnpm install`'
const PNPM_INSTALL = 'pnpm install'

function write_index_html(): void {
	writeFileSync(path.join(paths_mock.root, INDEX_HTML), '<h1>Hello</h1>')
}

// `init` does the setup only as the kit the project itself installed; any other kit hands off to that
// one first (joshuafolkken/kit#2794).
function install_project_kit(): void {
	const scope = path.join(paths_mock.root, 'node_modules', '@joshuafolkken')

	mkdirSync(scope, { recursive: true })
	symlinkSync(paths_mock.package_dir, path.join(scope, 'kit'))
}

// The cases below pin what `init` writes, so they skip the install it ends with; the install itself
// is pinned in its own describe (joshuafolkken/kit#2766).
async function run_init(args: ReadonlyArray<string> = [NO_INSTALL]): Promise<void> {
	const { main } = await import('./init')

	main(args)
}

function invoked_commands(): Array<string> {
	return mocked_execa.mock.calls.map((call) =>
		[call[0], ...(Array.isArray(call[1]) ? call[1] : [])].join(' '),
	)
}

async function rerun_with_python_settings(): Promise<{ settings: string; manifest: string }> {
	writeFileSync(path.join(paths_mock.root, 'site.css'), '')
	await run_init()
	const settings_path = path.join(paths_mock.root, '.vscode', 'settings.json')

	writeFileSync(settings_path, '{"[python]":{"editor.defaultFormatter":"python"}}')
	await run_init()

	return {
		settings: readFileSync(settings_path, 'utf8'),
		manifest: readFileSync(path.join(paths_mock.root, PACKAGE_JSON), 'utf8'),
	}
}

function fake_git_result(exit_code: number, stdout: string): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

beforeEach(() => {
	vi.resetModules()
	mocked_execa.mockReset()
	paths_mock.package_dir = fileURLToPath(new URL('../../', import.meta.url))
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'josh-basic-init-'))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('Git-free basic initialization', () => {
	it('creates a minimal manifest and no Git or GitHub files or commands', async () => {
		writeFileSync(path.join(paths_mock.root, 'main.py'), '')
		await run_init()

		expect(mocked_execa).not.toHaveBeenCalled()
		expect(existsSync(path.join(paths_mock.root, PACKAGE_JSON))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, GITIGNORE))).toBe(false)
		expect(existsSync(path.join(paths_mock.root, GITHUB_DIR))).toBe(false)
		expect(existsSync(path.join(paths_mock.root, 'lefthook.yml'))).toBe(false)
	})

	it('initializes an index.html site without Git', async () => {
		write_index_html()
		await run_init()

		expect(existsSync(path.join(paths_mock.root, BASIC_PRETTIER))).toBe(true)
		expect(readFileSync(path.join(paths_mock.root, '.prettierignore'), 'utf8')).not.toContain(
			'/static/',
		)
		expect(existsSync(path.join(paths_mock.root, GITHUB_DIR))).toBe(false)
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('tells the user to install what it added to package.json under --no-install', async () => {
		write_index_html()
		await run_init()

		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(INSTALL_HINT))
	})

	it('approves the esbuild and unrs-resolver builds so the first pnpm install succeeds', async () => {
		write_index_html()
		await run_init()
		const workspace = readFileSync(path.join(paths_mock.root, 'pnpm-workspace.yaml'), 'utf8')

		expect(workspace).toContain('allowBuilds:\n  esbuild: true\n  unrs-resolver: true\n')
		expect(workspace).not.toContain('overrides')
	})
})

describe('Git-free Web and node initialization', () => {
	it('uses a module-safe Prettier config for a CommonJS site', async () => {
		writeFileSync(path.join(paths_mock.root, PACKAGE_JSON), '{"type":"commonjs"}')
		writeFileSync(path.join(paths_mock.root, 'site.cjs'), 'module.exports = {}')
		await run_init()

		expect(existsSync(path.join(paths_mock.root, BASIC_PRETTIER))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, 'prettier.config.js'))).toBe(false)
	})

	it('omits Git lifecycle commands from a Git-free node manifest', async () => {
		writeFileSync(path.join(paths_mock.root, PACKAGE_JSON), '{"scripts":{"build":"tsc"}}')
		await run_init()
		const manifest = JSON.parse(readFileSync(path.join(paths_mock.root, PACKAGE_JSON), 'utf8')) as {
			scripts: Record<string, string>
		}

		expect(manifest.scripts['prepare']).toBeUndefined()
		expect(manifest.scripts['josh']).toBe('josh')
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('adds Web formatting on rerun while preserving Python settings', async () => {
		const { settings, manifest } = await rerun_with_python_settings()

		expect(settings).toContain('python')
		expect(manifest).toContain('"prettier"')
		expect(manifest).toContain(BASIC_PROFILE_ENTRY)
		expect(manifest).toContain(`"preinstall": ${JSON.stringify(init_logic.SAFE_CHAIN_CMD)}`)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('basic initialization after Git adoption', () => {
	it('adds Git files after Git is introduced without changing the profile', async () => {
		await run_init()
		mkdirSync(path.join(paths_mock.root, '.git'))
		mocked_execa.mockReturnValue(fake_git_result(1, ''))
		await run_init()

		const manifest = readFileSync(path.join(paths_mock.root, PACKAGE_JSON), 'utf8')

		expect(existsSync(path.join(paths_mock.root, GITIGNORE))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, '.gitattributes'))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, SECURITY_MD))).toBe(false)
		expect(manifest).toContain(BASIC_PROFILE_ENTRY)
	})

	// The boundary josh start relies on (joshuafolkken/kit#2197): init, first run or rerun, never
	// prompts and never creates a repository, a GitHub repository or a push — that is josh start's.
	it('never asks, creates a repository or pushes on a first run and a rerun', async () => {
		mkdirSync(path.join(paths_mock.root, '.git'))
		mocked_execa.mockReturnValue(fake_git_result(1, ''))
		await run_init()
		await run_init()
		const invoked = invoked_commands()

		expect(createInterface).not.toHaveBeenCalled()
		expect(invoked.filter((command) => /git init|repo create|push/u.test(command))).toStrictEqual(
			[],
		)
	})

	it('adds GitHub files only after a GitHub origin is added', async () => {
		mkdirSync(path.join(paths_mock.root, '.git'))
		mocked_execa.mockReturnValue(fake_git_result(0, 'git@github.com:owner/repo.git'))
		await run_init()

		expect(existsSync(path.join(paths_mock.root, SECURITY_MD))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, GITHUB_DIR, 'release.yml'))).toBe(true)
	})
})

// `init` ends by installing what it listed and formatting, so the quick start needs no separate
// `pnpm install` / `josh format` (joshuafolkken/kit#2766).
describe('the install and format init finishes with', () => {
	beforeEach(() => {
		install_project_kit()
	})

	it('installs, then formats, and drops the manual install hint', async () => {
		write_index_html()
		mocked_execa.mockReturnValue(fake_git_result(0, ''))
		await run_init([])

		expect(invoked_commands()).toStrictEqual([PNPM_INSTALL, 'pnpm exec josh format'])
		expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining(INSTALL_HINT))
	})

	it('fails without formatting when the install fails', async () => {
		write_index_html()
		mocked_execa.mockReturnValue(fake_git_result(1, ''))
		const { main } = await import('./init')

		expect(() => {
			main(['--profile', 'basic'])
		}).toThrow('pnpm install failed')
		expect(invoked_commands()).toStrictEqual([PNPM_INSTALL])
	})

	it('runs neither under --no-install', async () => {
		write_index_html()
		await run_init([NO_INSTALL, '--profile', 'basic'])

		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

// A `pnpm dlx` kit may be a stale cache entry; the version the project gets is pnpm's choice, and the
// setup is that version's (joshuafolkken/kit#2794).
describe('a kit run from outside the project', () => {
	// The bare package.json anchors pnpm to this directory rather than an ancestor project
	// (joshuafolkken/kit#2866); it carries no kit version or template, so #2794's guarantee holds.
	it('installs the project kit and hands the run to it, writing only a bare package.json itself', async () => {
		write_index_html()
		mocked_execa.mockReturnValue(fake_git_result(0, ''))
		await run_init(['--profile', 'basic'])

		expect(invoked_commands()).toStrictEqual([
			'pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit',
			'pnpm exec josh init --profile static',
		])
		const manifest = readFileSync(path.join(paths_mock.root, PACKAGE_JSON), 'utf8')

		expect(new Set(readdirSync(paths_mock.root))).toStrictEqual(new Set([INDEX_HTML, PACKAGE_JSON]))
		expect(JSON.parse(manifest)).toStrictEqual({ private: true })
	})

	it('fails without handing off when the kit install fails', async () => {
		write_index_html()
		mocked_execa.mockReturnValue(fake_git_result(1, ''))

		await expect(run_init([])).rejects.toThrow('@joshuafolkken/kit failed')
		expect(mocked_execa).toHaveBeenCalledTimes(1)
	})

	it('refuses a malformed profile before installing anything', async () => {
		write_index_html()

		await expect(run_init(['--profile', 'bogus'])).rejects.toThrow('Profile must be basic or full')
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('sets the project up itself under --no-install', async () => {
		write_index_html()
		await run_init([NO_INSTALL])

		expect(mocked_execa).not.toHaveBeenCalled()
		expect(existsSync(path.join(paths_mock.root, PACKAGE_JSON))).toBe(true)
	})
})

// joshuafolkken/kit#2829: a basic project set up before the rename imports the old paths, and
// re-running `init` moves exactly those kit-written references, keeping the project's own lines.
describe('basic initialization of a project set up before the rename', () => {
	it('moves the CLAUDE.md and Prettier imports onto the basic paths', async () => {
		write_index_html()
		const claude_md = path.join(paths_mock.root, 'CLAUDE.md')
		const prettier_config = path.join(paths_mock.root, BASIC_PRETTIER)

		writeFileSync(
			claude_md,
			'@node_modules/@joshuafolkken/kit/dist/CLAUDE.static.md\n\n- Own rule\n',
		)
		writeFileSync(
			prettier_config,
			"import { config } from '@joshuafolkken/kit/prettier/static'\n\nexport default config\n",
		)
		await run_init()

		expect(readFileSync(claude_md, 'utf8')).toBe(
			'@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md\n\n- Own rule\n',
		)
		expect(readFileSync(prettier_config, 'utf8')).toContain("'@joshuafolkken/kit/prettier/basic'")
	})

	it('still asks for the kit preset in a Prettier config of the project own', async () => {
		write_index_html()
		const prettier_config = path.join(paths_mock.root, BASIC_PRETTIER)
		const own_config = 'export default { semi: true }\n'

		writeFileSync(prettier_config, own_config)
		await run_init()

		expect(readFileSync(prettier_config, 'utf8')).toBe(own_config)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			`  ⚠ exists    ${BASIC_PRETTIER} — add manually:`,
		)
	})
})
