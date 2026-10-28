import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/build/local-bin', () => ({ resolve_package_bin: vi.fn() }))
vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: vi.fn() } }))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const { resolve_package_bin } = await import('#scripts/build/local-bin')
const { git_spawn_sync } = await import('#scripts/git/git-spawn-sync')
const mocked_git_read = vi.mocked(git_spawn_sync.read)
const { eslint_daemon } = await import('./eslint-daemon')

// joshuafolkken/kit#4867: the daemon's type program keeps the old copy of a module it read but never
// linted, so a shell edit to it — one the edit hook never sees — has to restart the daemon, and an edit
// the hook linted must not.

const CLI = '/kit/node_modules/eslint_d/bin/eslint_d.js'
const IMPORTER = 'src/importer.ts'
const IMPORTED = 'src/imported.ts'
const PNPM_ESLINT = ['exec', 'eslint', IMPORTER]
const ESLINT_DIRECTORY = 'node_modules/eslint'
const DAEMON = 'token 4321 77 hash'
const JSON_BODY = '{}'
const EXPORTS_BEFORE = 'export const a = 1\n'
const EXPORTS_AFTER = 'export const a = 1\nexport const b = 2\n'
const HEAD = 'aaaa'

const project_root = mkdtempSync(path.join(tmpdir(), 'eslint-daemon-sources-'))

function write_file(relative: string, content: string = JSON_BODY): void {
	const file = path.join(project_root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

// git under one commit, answering `changed` as the files that differ from it.
function answer_changed(changed: string): void {
	mocked_git_read.mockImplementation((git_arguments) => {
		if (git_arguments[0] === 'diff') return changed

		return git_arguments[0] === 'ls-files' ? '' : HEAD
	})
}

function current(): string {
	return eslint_daemon.fingerprint(project_root)
}

function is_stale(): boolean {
	return eslint_daemon.is_stale(eslint_daemon.read_record(project_root), current())
}

// A checkout whose running daemon was recorded under the fingerprint it has now, with `IMPORTED`
// already changed from HEAD.
function current_checkout(changed: string = IMPORTED): void {
	answer_changed(changed)
	for (const input of ['package.json', `${ESLINT_DIRECTORY}/package.json`]) write_file(input)
	write_file(IMPORTED, EXPORTS_BEFORE)
	write_file(`${ESLINT_DIRECTORY}/.eslint_d`, DAEMON)
	write_file(
		`${ESLINT_DIRECTORY}/.eslint_d-toolchain`,
		eslint_daemon.record_text(DAEMON, current()),
	)
}

function remember_edit_of(relative: string): void {
	eslint_daemon.remember_after_edit(project_root, eslint_daemon.read_record(project_root), relative)
}

beforeEach(() => {
	vi.clearAllMocks()
	mkdirSync(project_root, { recursive: true })
	vi.mocked(resolve_package_bin).mockReturnValue(CLI)
})

afterEach(() => {
	rmSync(project_root, { recursive: true, force: true })
})

describe('eslint_daemon — a source edited under a running daemon', () => {
	it('moves the fingerprint when a file changed from HEAD changes again', () => {
		current_checkout()
		const before = current()

		write_file(IMPORTED, EXPORTS_AFTER)

		expect(current()).not.toBe(before)
	})
})

describe('eslint_daemon — a non-ASCII source edited under a running daemon', () => {
	// Without `-z` git quotes a non-ASCII name, and the quoted path reads as a file that is absent.
	it('moves the fingerprint when a non-ASCII file changed from HEAD changes again', () => {
		const non_ascii = 'src/日本語.ts'

		current_checkout(non_ascii)
		write_file(non_ascii, EXPORTS_BEFORE)
		const before = current()

		write_file(non_ascii, EXPORTS_AFTER)

		expect(current()).not.toBe(before)
		expect(mocked_git_read.mock.calls.map(([git_arguments]) => git_arguments)).toContainEqual(
			expect.arrayContaining(['diff', '-z']),
		)
	})
})

describe('eslint_daemon — the edit hook refreshing the fingerprint', () => {
	it('keeps the daemon current when the edit hook linted the edited file', () => {
		current_checkout()
		write_file(IMPORTED, EXPORTS_AFTER)

		remember_edit_of(IMPORTED)

		expect(is_stale()).toBe(false)
	})

	it('keeps the daemon stale when the edit hook linted another file', () => {
		current_checkout(`${IMPORTED}\0${IMPORTER}`)
		write_file(IMPORTED, EXPORTS_AFTER)

		remember_edit_of(IMPORTER)

		expect(is_stale()).toBe(true)
	})

	it('stops the daemon before linting the importer after an edit the hook never saw', async () => {
		type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

		current_checkout()
		write_file(IMPORTED, EXPORTS_AFTER)
		mocked_execa.mockResolvedValue({ exitCode: 0, stdout: '', all: '' } as unknown as ExecaResult)

		await eslint_daemon.run(PNPM_ESLINT, { project_root })

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual([CLI, 'stop'])
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual([CLI, IMPORTER])
		expect(is_stale()).toBe(false)
	})
})
