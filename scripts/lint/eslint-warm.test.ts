import { spawn, type ChildProcess } from 'node:child_process'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { LINT_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eslint_daemon } from './eslint-daemon'
import { eslint_warm } from './eslint-warm'

// joshuafolkken/kit#4720: a fresh lane's eslint daemon is warmed in the background, through the
// recorded route, so the first edit hook lints warm and nothing waits for it.

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: vi.fn() } }))
vi.mock('./eslint-daemon', () => ({ eslint_daemon: { run: vi.fn() } }))

const PROJECT_ROOT = '/lanes/4720'
// joshuafolkken/kit#5047: bounded, so a daemon that never answers ends the detached warm-up.
const BOUNDED = { project_root: PROJECT_ROOT, timeout_ms: LINT_TIMEOUT_MS }

interface FakeChild {
	on: ReturnType<typeof vi.fn>
	unref: ReturnType<typeof vi.fn>
}

function fake_child(): FakeChild {
	const child: FakeChild = { on: vi.fn(), unref: vi.fn() }

	vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess)

	return child
}

beforeEach(() => {
	vi.mocked(spawn).mockReset()
	vi.mocked(eslint_daemon.run).mockReset()
})

describe('starting the warm-up', () => {
	beforeEach(() => {
		vi.stubEnv('VITEST', undefined)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('spawns the warm-up detached in the project, and lets go of the child', () => {
		const child = fake_child()

		eslint_warm.start(PROJECT_ROOT)

		const [, spawn_arguments, options] = vi.mocked(spawn).mock.calls[0] ?? []

		expect(spawn_arguments?.at(-1)).toMatch(/eslint-warm-cli\.ts$/u)
		expect(options).toMatchObject({ cwd: PROJECT_ROOT, detached: true, stdio: 'ignore' })
		expect(child.on).toHaveBeenCalledWith('error', expect.any(Function))
		expect(child.unref).toHaveBeenCalledOnce()
	})

	it('never throws into the caller when the spawn throws', () => {
		vi.mocked(spawn).mockImplementation(() => {
			throw new Error('EAGAIN')
		})

		expect(() => {
			eslint_warm.start(PROJECT_ROOT)
		}).not.toThrow()
	})

	// joshuafolkken/kit#5047: suites driving a real `lane open` left a detached warm-up behind.
	it('spawns nothing under a test run', () => {
		vi.stubEnv('VITEST', 'true')

		eslint_warm.start(PROJECT_ROOT)

		expect(spawn).not.toHaveBeenCalled()
	})
})

describe('warming', () => {
	it('lints the first typed source through the recorded daemon route', async () => {
		vi.mocked(git_spawn_sync.read).mockReturnValue('scripts/a.ts\nscripts/b.ts')

		await eslint_warm.warm(PROJECT_ROOT)

		expect(eslint_daemon.run).toHaveBeenCalledExactlyOnceWith(
			['exec', 'eslint', 'scripts/a.ts'],
			BOUNDED,
		)
	})

	it('lints the flat config when the project tracks no typed source', async () => {
		vi.mocked(git_spawn_sync.read).mockReturnValue(undefined)

		await eslint_warm.warm(PROJECT_ROOT)

		expect(eslint_daemon.run).toHaveBeenCalledExactlyOnceWith(
			['exec', 'eslint', 'eslint.config.js'],
			BOUNDED,
		)
	})
})
