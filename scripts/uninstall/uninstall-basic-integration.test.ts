import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths_mock = vi.hoisted(() => ({ root: '', package_dir: '' }))

vi.mock('#scripts/init/init-paths', () => ({
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
const AGENTS_MD = 'AGENTS.md'
const OWN_NOTES = 'notes.txt'
const OWN_LINE = '\n- Own rule\n'
const YES = '--yes'
const GITIGNORE = '.gitignore'
const REVIEW_TITLE = 'Review by hand'
const GITHUB_ORIGIN = 'git@github.com:owner/repo.git'

function project_path(relative_path: string): string {
	return path.join(paths_mock.root, relative_path)
}

function project_files(): Array<string> {
	return readdirSync(paths_mock.root, { recursive: true, encoding: 'utf8' })
		.filter((entry) => !entry.startsWith('.git/') && entry !== '.git')
		.toSorted((first, second) => first.localeCompare(second))
}

async function run_init(): Promise<void> {
	const { main } = await import('#scripts/init/init')

	main(['--no-install'])
}

async function run_uninstall(args: ReadonlyArray<string>): Promise<string> {
	const { main } = await import('./uninstall')
	const info = vi.mocked(console.info)

	info.mockClear()
	await main(args)

	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

// The lines of the "Review by hand" section, without the `package.json ` each manifest entry carries.
function reviewed_entries(output: string): Array<string> {
	const [, section = ''] = output.split(REVIEW_TITLE)
	const [body = ''] = section.split('\n\n', 1)

	return body
		.split('\n')
		.slice(1)
		.map((line) => line.trim().replace(`${PACKAGE_JSON} `, ''))
}

function manifest_entries(): Array<string> {
	const manifest = JSON.parse(readFileSync(project_path(PACKAGE_JSON), 'utf8')) as Record<
		string,
		unknown
	>

	return Object.entries(manifest).flatMap(([field, value]) =>
		typeof value === 'object' && value !== null
			? Object.keys(value).map((key) => `${field}.${key}`)
			: field,
	)
}

function fake_git_result(exit_code: number, stdout: string): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

beforeEach(() => {
	vi.resetModules()
	mocked_execa.mockReset()
	paths_mock.package_dir = fileURLToPath(new URL('../../', import.meta.url))
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'josh-basic-uninstall-'))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	writeFileSync(project_path(INDEX_HTML), '<h1>Hello</h1>')
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('uninstalling a basic project that held only index.html', () => {
	it('leaves no file kit created besides the manifest it merged into', async () => {
		await run_init()
		await run_uninstall([YES])

		expect(project_files()).toStrictEqual([INDEX_HTML, PACKAGE_JSON])
	})

	it('lists for review exactly the manifest entries that are left', async () => {
		await run_init()
		const output = await run_uninstall([YES])

		expect(reviewed_entries(output)).toStrictEqual(manifest_entries())
		expect(manifest_entries()).not.toContain('devDependencies.@joshuafolkken/kit')
		expect(manifest_entries()).not.toContain('josh.profile')
	})

	it('removes nothing without a confirmation', async () => {
		await run_init()
		const before = project_files()
		const output = await run_uninstall([])

		expect(project_files()).toStrictEqual(before)
		expect(output).toContain('This is a preview')
	})
})

describe('uninstalling a basic GitHub project the user has worked in', () => {
	beforeEach(() => {
		mkdirSync(project_path('.git'))
		mocked_execa.mockReturnValue(fake_git_result(0, GITHUB_ORIGIN))
		writeFileSync(project_path(OWN_NOTES), 'mine')
	})

	it('keeps the user files and an edited distributed file, and names the edited one', async () => {
		await run_init()
		const edited = `${readFileSync(project_path(AGENTS_MD), 'utf8')}${OWN_LINE}`

		writeFileSync(project_path(AGENTS_MD), edited)
		const output = await run_uninstall([YES])

		expect(readFileSync(project_path(AGENTS_MD), 'utf8')).toBe(edited)
		expect(readFileSync(project_path(OWN_NOTES), 'utf8')).toBe('mine')
		expect(output).toMatch(/Keep [^\n]*\n(?: {2}[^\n]+\n)* {2}AGENTS\.md/u)
	})

	it('removes the GitHub files kit wrote and the directory they were alone in', async () => {
		await run_init()
		await run_uninstall([YES])

		expect(project_files()).toStrictEqual([GITIGNORE, INDEX_HTML, OWN_NOTES, PACKAGE_JSON])
	})

	it('keeps the ignore file kit created and names it for review', async () => {
		await run_init()
		const created = readFileSync(project_path(GITIGNORE), 'utf8')
		const output = await run_uninstall([YES])

		expect(readFileSync(project_path(GITIGNORE), 'utf8')).toBe(created)
		expect(output).toMatch(/Review by hand[^\n]*\n(?: {2}[^\n]+\n)* {2}\.gitignore — /u)
	})

	it('keeps a file the project already had under a distributed name', async () => {
		const own_ignore = 'my-build/\n'

		writeFileSync(project_path(GITIGNORE), own_ignore)
		await run_init()
		await run_uninstall([YES])

		expect(readFileSync(project_path(GITIGNORE), 'utf8')).toContain(own_ignore)
	})
})
