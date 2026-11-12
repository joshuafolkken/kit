import { mkdirSync, rmSync } from 'node:fs'
import { untyped_environment } from '#eslint/untyped-environment.js'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/build/local-bin', async () => await import('#tools/test/local-bin-mock'))
vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: vi.fn() } }))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const { resolve_package_bin } = await import('#scripts/build/local-bin')
const mocked_resolve = vi.mocked(resolve_package_bin)
const { eslint_daemon } = await import('./eslint-daemon')
const { ESLINT_HEAP_MIB } = await import('./eslint-heap')

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const CLI = '/kit/node_modules/eslint_d/bin/eslint_d.js'
const PNPM_ESLINT = ['exec', 'eslint', '--quiet', 'src/a.ts']
const ESLINT_DIRECTORY = 'node_modules/eslint'
const DAEMON = 'token 4321 77 hash'
const REPORT = 'report'
const ESLINT_HEAP = `--max-old-space-size=${String(ESLINT_HEAP_MIB)}`
const COLD_OPTIONS = `${ESLINT_HEAP} --import=${new URL('eslint-memory.js', import.meta.url).href}`

const make_directory = temporary_directory('suite')
const project_root = make_directory('eslint-daemon-state-')

function answer(exit_code: number, stdout: string): ExecaResult {
	return { exitCode: exit_code, stdout, all: stdout } as unknown as ExecaResult
}

// A checkout with an installed eslint and no daemon running yet.
function installed(): void {
	write_file(project_root, 'package.json', '{}')
	write_file(project_root, `${ESLINT_DIRECTORY}/package.json`, '{}')
}

// A running daemon recorded under `recorded_under`, or under the fingerprint the checkout has now.
function running(recorded_under?: string): void {
	installed()
	write_file(project_root, `${ESLINT_DIRECTORY}/.eslint_d`, DAEMON)
	const current = recorded_under ?? eslint_daemon.fingerprint(project_root)

	write_file(
		project_root,
		`${ESLINT_DIRECTORY}/.eslint_d-toolchain`,
		eslint_daemon.record_text(DAEMON, current),
	)
}

function spawned(): ReadonlyArray<unknown> {
	return mocked_execa.mock.calls.map((call) => call[1])
}

function spawned_environment(): unknown {
	const options: unknown = mocked_execa.mock.lastCall?.at(-1)

	return typeof options === 'object' && options !== null && 'env' in options
		? options.env
		: undefined
}

beforeEach(() => {
	vi.stubEnv('NODE_OPTIONS', '')
	mkdirSync(project_root, { recursive: true })
	vi.spyOn(process, 'cwd').mockReturnValue(project_root)
	mocked_resolve.mockReturnValue(CLI)
	mocked_execa.mockResolvedValue(answer(0, REPORT))
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
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

// joshuafolkken/kit#6331: the daemon, and the cold process it falls back to, lint under ESLint's heap.
describe('eslint_daemon.run_or_cold heap', () => {
	it('hands the daemon forwarder the eslint heap', async () => {
		installed()

		await eslint_daemon.run_or_cold(PNPM_ESLINT)

		expect(spawned_environment()).toMatchObject({
			NODE_OPTIONS: ESLINT_HEAP,
			ESLINT_D_MISS: 'fail',
		})
	})

	// joshuafolkken/kit#7247: the edit hook launches with the same switches, so either path that
	// starts the daemon gives it the same heap.
	it('starts the daemon forwarder with the shared launch environment', async () => {
		installed()

		await eslint_daemon.run_or_cold(PNPM_ESLINT)

		expect(spawned_environment()).toMatchObject(eslint_daemon.launch_environment())
	})

	it('hands the cold fallback the eslint heap', async () => {
		installed()
		mocked_resolve.mockReturnValue(undefined)

		await eslint_daemon.run_or_cold(PNPM_ESLINT)

		expect(spawned_environment()).toMatchObject({
			NODE_OPTIONS: COLD_OPTIONS,
		})
	})
})

// joshuafolkken/kit#6768: the daemon holds no type program; the cold run — the gate's own lint
// route — stays typed.
describe('eslint_daemon.run_or_cold type program', () => {
	it('starts the daemon forwarder with the untyped switch', async () => {
		installed()

		await eslint_daemon.run_or_cold(PNPM_ESLINT)

		expect(spawned_environment()).toMatchObject(untyped_environment.environment())
	})

	it('leaves the untyped switch out of the cold fallback', async () => {
		installed()
		mocked_resolve.mockReturnValue(undefined)

		await eslint_daemon.run_or_cold(PNPM_ESLINT)

		expect(spawned_environment()).not.toHaveProperty(untyped_environment.ENVIRONMENT_VARIABLE)
	})
})
