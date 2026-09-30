import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const GITIGNORE = '.gitignore'
const GITHUB_DIR = '.github'
const STATIC_PROFILE_ENTRY = '"profile": "static"'
const SECURITY_MD = 'SECURITY.md'
const STATIC_PRETTIER = 'prettier.config.mjs'
const NO_INSTALL = '--no-install'
const INSTALL_HINT = 'run `pnpm install`'
const PNPM_INSTALL = 'pnpm install'

function write_index_html(): void {
	writeFileSync(path.join(paths_mock.root, 'index.html'), '<h1>Hello</h1>')
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
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'josh-static-init-'))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('Git-free static initialization', () => {
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

		expect(existsSync(path.join(paths_mock.root, STATIC_PRETTIER))).toBe(true)
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

		expect(existsSync(path.join(paths_mock.root, STATIC_PRETTIER))).toBe(true)
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
		expect(manifest).toContain(STATIC_PROFILE_ENTRY)
		expect(manifest).toContain(`"preinstall": ${JSON.stringify(init_logic.SAFE_CHAIN_CMD)}`)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('static initialization after Git adoption', () => {
	it('adds Git files after Git is introduced without changing the profile', async () => {
		await run_init()
		mkdirSync(path.join(paths_mock.root, '.git'))
		mocked_execa.mockReturnValue(fake_git_result(1, ''))
		await run_init()

		const manifest = readFileSync(path.join(paths_mock.root, PACKAGE_JSON), 'utf8')

		expect(existsSync(path.join(paths_mock.root, GITIGNORE))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, '.gitattributes'))).toBe(true)
		expect(existsSync(path.join(paths_mock.root, SECURITY_MD))).toBe(false)
		expect(manifest).toContain(STATIC_PROFILE_ENTRY)
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
			main(['--profile', 'static'])
		}).toThrow('pnpm install failed')
		expect(invoked_commands()).toStrictEqual([PNPM_INSTALL])
	})

	it('runs neither under --no-install', async () => {
		write_index_html()
		await run_init([NO_INSTALL, '--profile', 'static'])

		expect(mocked_execa).not.toHaveBeenCalled()
	})
})
