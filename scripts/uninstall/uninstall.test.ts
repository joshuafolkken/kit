import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths_mock = vi.hoisted(() => ({ root: '', package_dir: '' }))
const KIT = '@joshuafolkken/kit'
const KIT_CONTENT = `extends: node_modules/${KIT}/preset\n`
const AGENTS_MD = 'AGENTS.md'
const NESTED_FILE = '.github/release.yml'
const LEFTHOOK_YML = 'lefthook.yml'
const PACKAGE_JSON = 'package.json'
const YES = '--yes'
const TEMP_PREFIX = 'josh-uninstall-'
const OWN_WORKFLOW = '.github/own.yml'
const KIT_MANIFEST = '{"scripts":{"josh":"josh"}}'
const PROJECT_MANIFEST = JSON.stringify({
	name: 'site',
	scripts: { josh: 'josh' },
	devDependencies: { [KIT]: '1.0.0' },
	josh: { profile: 'basic' },
})

vi.mock('#scripts/init/init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	get PACKAGE_DIR(): string {
		return paths_mock.package_dir
	},
	package_path: (relative_path: string): string => path.join(paths_mock.package_dir, relative_path),
}))
vi.mock('./distributed-files', () => ({
	distributed_files: {
		list: () =>
			[AGENTS_MD, NESTED_FILE, LEFTHOOK_YML].map((destination) => ({
				dest: destination,
				distributed: KIT_CONTENT,
			})),
		kit_manifest: () => KIT_MANIFEST,
	},
}))
vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))
const mocked_execa = vi.mocked(execaSync)

function project_path(relative_path: string): string {
	return path.join(paths_mock.root, relative_path)
}

function write_project_file(relative_path: string, content: string = KIT_CONTENT): void {
	mkdirSync(path.dirname(project_path(relative_path)), { recursive: true })
	writeFileSync(project_path(relative_path), content)
}

function install_lefthook(): void {
	write_project_file(LEFTHOOK_YML)
	write_project_file('node_modules/.bin/lefthook', '')
	write_project_file('node_modules/.bin/lefthook.cmd', '')
	mkdirSync(project_path('.git'))
}

function answer_with(answer: string): void {
	const prompt: unknown = { question: vi.fn().mockResolvedValue(answer), close: vi.fn() }

	process.stdin.isTTY = true
	vi.mocked(createInterface).mockReturnValue(prompt as ReturnType<typeof createInterface>)
}

function fake_result(exit_code: number): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code }

	return value as ReturnType<typeof execaSync>
}

function printed(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

async function run_uninstall(args: ReadonlyArray<string> = []): Promise<void> {
	const { main } = await import('./uninstall')

	await main(args)
}

beforeEach(() => {
	vi.resetModules()
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(fake_result(0))
	paths_mock.package_dir = fileURLToPath(new URL('../../', import.meta.url))
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	write_project_file(AGENTS_MD)
	write_project_file(NESTED_FILE)
	write_project_file(PACKAGE_JSON, PROJECT_MANIFEST)
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	process.stdin.isTTY = false
	process.exitCode = undefined
	vi.restoreAllMocks()
})

describe('josh uninstall in kit own repository', () => {
	// A checkout is told apart by the name in its manifest, so a temporary one stands in for kit's.
	it('refuses and removes nothing, as josh init does', async () => {
		write_project_file(PACKAGE_JSON, JSON.stringify({ name: KIT }))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		await run_uninstall([YES])

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Refusing'))
		expect(process.exitCode).toBe(1)
		expect(existsSync(project_path(AGENTS_MD))).toBe(true)
		expect(console.info).not.toHaveBeenCalled()
	})
})

describe('josh uninstall without a confirmation', () => {
	it('removes nothing where there is no terminal to confirm on', async () => {
		await run_uninstall()

		expect(existsSync(project_path(AGENTS_MD))).toBe(true)
		expect(readFileSync(project_path(PACKAGE_JSON), 'utf8')).toBe(PROJECT_MANIFEST)
		expect(printed()).toContain('This is a preview')
	})

	it('removes nothing when the answer is no', async () => {
		answer_with('n')
		await run_uninstall()

		expect(existsSync(project_path(AGENTS_MD))).toBe(true)
		expect(printed()).toContain('Nothing was removed.')
	})

	it('shows the plan before it asks', async () => {
		await run_uninstall()

		expect(printed()).toMatch(/Remove [^\n]*\n {2}AGENTS\.md/u)
		expect(printed()).toContain(`${PACKAGE_JSON} scripts.josh`)
	})

	it('refuses an argument it does not know', async () => {
		await expect(run_uninstall(['--force'])).rejects.toThrow('Usage: josh uninstall')
		expect(existsSync(project_path(AGENTS_MD))).toBe(true)
	})
})

describe('josh uninstall once confirmed', () => {
	it('removes the untouched files and the directory the last one leaves empty', async () => {
		await run_uninstall([YES])

		expect(existsSync(project_path(AGENTS_MD))).toBe(false)
		expect(existsSync(project_path('.github'))).toBe(false)
	})

	it('removes on a yes typed at the terminal', async () => {
		answer_with('y')
		await run_uninstall()

		expect(existsSync(project_path(AGENTS_MD))).toBe(false)
	})

	it('takes the kit dependency and the profile record out of package.json', async () => {
		await run_uninstall([YES])

		const manifest: unknown = JSON.parse(readFileSync(project_path(PACKAGE_JSON), 'utf8'))

		expect(manifest).toStrictEqual({
			name: 'site',
			scripts: { josh: 'josh' },
		})
	})

	it('keeps a file the project edited and a directory that still holds one', async () => {
		write_project_file(AGENTS_MD, `${KIT_CONTENT}own line\n`)
		write_project_file(OWN_WORKFLOW, 'own')
		await run_uninstall([YES])

		expect(readFileSync(project_path(AGENTS_MD), 'utf8')).toContain('own line')
		expect(existsSync(project_path(OWN_WORKFLOW))).toBe(true)
		expect(printed()).toMatch(/Keep [^\n]*\n {2}AGENTS\.md/u)
	})

	it('says so when nothing of kit is left', async () => {
		await run_uninstall([YES])
		await run_uninstall([YES])

		expect(printed()).toContain('Nothing of kit is left to remove.')
	})
})

describe('josh uninstall and the git hooks', () => {
	it('uninstalls the hooks while the lefthook config is still there', async () => {
		install_lefthook()
		mocked_execa.mockImplementation(() => {
			expect(existsSync(project_path(LEFTHOOK_YML))).toBe(true)

			return fake_result(0)
		})
		await run_uninstall([YES])

		expect(mocked_execa).toHaveBeenCalledWith(
			expect.stringContaining('lefthook'),
			['uninstall'],
			expect.objectContaining({ cwd: paths_mock.root }),
		)
		expect(existsSync(project_path(LEFTHOOK_YML))).toBe(false)
	})

	it('goes on removing files when lefthook uninstall fails', async () => {
		install_lefthook()
		mocked_execa.mockReturnValue(fake_result(1))
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		await run_uninstall([YES])

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('lefthook uninstall failed'))
		expect(existsSync(project_path(AGENTS_MD))).toBe(false)
	})

	it('runs no lefthook where the project has no lefthook config', async () => {
		await run_uninstall([YES])

		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('leaves the hooks of a lefthook config that names kit nowhere', async () => {
		install_lefthook()
		write_project_file(LEFTHOOK_YML, 'pre-commit:\n  jobs: []\n')
		await run_uninstall([YES])

		expect(mocked_execa).not.toHaveBeenCalled()
		expect(printed()).not.toContain('lefthook uninstall')
	})
})
