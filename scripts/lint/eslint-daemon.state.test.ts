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
const mocked_resolve = vi.mocked(resolve_package_bin)
const { eslint_daemon } = await import('./eslint-daemon')

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const CLI = '/kit/node_modules/eslint_d/bin/eslint_d.js'
const PNPM_ESLINT = ['exec', 'eslint', '--quiet', 'src/a.ts']
const ESLINT_DIRECTORY = 'node_modules/eslint'
const DAEMON = 'token 4321 77 hash'
const REPORT = 'report'

const project_root = mkdtempSync(path.join(tmpdir(), 'eslint-daemon-state-'))

function answer(exit_code: number, stdout: string): ExecaResult {
	return { exitCode: exit_code, stdout, all: stdout } as unknown as ExecaResult
}

function write_file(relative: string, content: string): void {
	const file = path.join(project_root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

// A checkout with an installed eslint and no daemon running yet.
function installed(): void {
	write_file('package.json', '{}')
	write_file(`${ESLINT_DIRECTORY}/package.json`, '{}')
}

// A running daemon recorded under `recorded_under`, or under the fingerprint the checkout has now.
function running(recorded_under?: string): void {
	installed()
	write_file(`${ESLINT_DIRECTORY}/.eslint_d`, DAEMON)
	const current = recorded_under ?? eslint_daemon.fingerprint(project_root)

	write_file(`${ESLINT_DIRECTORY}/.eslint_d-toolchain`, eslint_daemon.record_text(DAEMON, current))
}

function spawned(): ReadonlyArray<unknown> {
	return mocked_execa.mock.calls.map((call) => call[1])
}

beforeEach(() => {
	vi.clearAllMocks()
	mkdirSync(project_root, { recursive: true })
	vi.spyOn(process, 'cwd').mockReturnValue(project_root)
	mocked_resolve.mockReturnValue(CLI)
	mocked_execa.mockResolvedValue(answer(0, REPORT))
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(project_root, { recursive: true, force: true })
})

// joshuafolkken/kit#5712: the daemon fact `josh lint:related`'s timing line prints.
describe('eslint_daemon.run_or_cold daemon state', () => {
	it('reports a started daemon when none was running', async () => {
		installed()

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({
			daemon: 'daemon started',
		})
		expect(spawned()).toEqual([[CLI, '--quiet', 'src/a.ts']])
	})

	it('reports a reused daemon recorded under the current fingerprint', async () => {
		running()

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({ daemon: 'daemon reused' })
		expect(spawned()).toEqual([[CLI, '--quiet', 'src/a.ts']])
	})

	it('reports a restarted daemon after stopping a stale one', async () => {
		running('an older fingerprint')

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({
			daemon: 'daemon restarted',
		})
		expect(spawned()).toEqual([
			[CLI, 'stop'],
			[CLI, '--quiet', 'src/a.ts'],
		])
	})

	it('reports the cold fallback when the daemon cannot be reached', async () => {
		installed()
		mocked_resolve.mockReturnValue(undefined)

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({
			exit_code: 0,
			daemon: 'daemon unreachable, cold process',
		})
	})
})
