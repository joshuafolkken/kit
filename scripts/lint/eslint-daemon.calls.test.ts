import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eslint_daemon_calls } from './eslint-daemon-calls'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/build/local-bin', () => ({ resolve_package_bin: vi.fn() }))
vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: vi.fn() } }))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const { resolve_package_bin } = await import('#scripts/build/local-bin')
const { eslint_daemon } = await import('./eslint-daemon')

const PNPM_ESLINT = ['exec', 'eslint', '--quiet', 'src/a.ts']
const ESLINT_DIRECTORY = 'node_modules/eslint'
const DAEMON = 'token 4321 77 hash'
const { CALLS_RECORD } = eslint_daemon_calls
const CALL = { caller: eslint_daemon_calls.DAEMON_CALLER.PRE_COMMIT, files: 1 }

const make_directory = temporary_directory('suite')
const project_root = make_directory('eslint-daemon-calls-')

// A checkout whose running daemon was recorded under the fingerprint it has now.
function current_checkout(): void {
	for (const input of ['package.json', `${ESLINT_DIRECTORY}/package.json`]) {
		write_file(project_root, input, '{}')
	}

	write_file(project_root, `${ESLINT_DIRECTORY}/.eslint_d`, DAEMON)
	write_file(
		project_root,
		`${ESLINT_DIRECTORY}/.eslint_d-toolchain`,
		eslint_daemon.record_text(DAEMON, eslint_daemon.fingerprint(project_root)),
	)
}

beforeEach(() => {
	mkdirSync(project_root, { recursive: true })
	vi.mocked(resolve_package_bin).mockReturnValue('/kit/node_modules/eslint_d/bin/eslint_d.js')
})

afterEach(() => {
	rmSync(project_root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// joshuafolkken/kit#7245: a call the daemon answered is recorded beside that daemon.
describe('eslint_daemon — the call record', () => {
	it('records the call beside the daemon that answered it', async () => {
		vi.spyOn(process, 'cwd').mockReturnValue(project_root)
		current_checkout()
		mocked_execa.mockResolvedValueOnce({
			exitCode: 0,
			stdout: 'report',
			all: 'report',
		} as unknown as Awaited<ReturnType<typeof execa_module.execa>>)

		await eslint_daemon.run_or_cold(PNPM_ESLINT, CALL)

		expect(readFileSync(path.join(project_root, ESLINT_DIRECTORY, CALLS_RECORD), 'utf8')).toMatch(
			/caller=pre-commit files=1 total=\d+ pid=77\n$/u,
		)
	})

	it('records nothing beside a daemon a borrowed install belongs to', () => {
		const lender = make_directory('eslint-daemon-calls-lender-')

		// An eslint the borrowing checkout resolves, so only the borrowed-install guard holds the record back.
		write_file(lender, 'eslint/package.json', '{}')
		write_file(lender, 'eslint/.eslint_d', DAEMON)
		symlinkSync(lender, path.join(project_root, 'node_modules'), 'dir')

		eslint_daemon.record_call(project_root, CALL)

		expect(existsSync(path.join(lender, 'eslint', CALLS_RECORD))).toBe(false)
	})
})
