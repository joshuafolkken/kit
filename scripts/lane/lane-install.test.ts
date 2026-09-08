import { buffered_process, type BufferedProcessResult } from '#scripts/buffered-process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_ARGUMENTS, INSTALL_TIMEOUT_MS, lane_install } from './lane-install'

// joshuafolkken/kit#1554: opening a lane has to leave dependencies in it, so what is asserted here is
// what this module asks for and how it reads the answer — never pnpm itself, nor the spawning that
// `buffered-process.test.ts` already pins, which is why that shared helper is mocked rather than the
// child being run.

vi.mock('#scripts/buffered-process', () => ({
	buffered_process: {
		is_process_failed: (result: Pick<BufferedProcessResult, 'exit_code'>): boolean =>
			result.exit_code !== 0,
		run_buffered_process: vi.fn(),
	},
}))

const mocked_run = vi.mocked(buffered_process.run_buffered_process)

const LANE_DIRECTORY = '/lanes/1554'
const SUCCESS_EXIT_CODE = 0
const FAILING_EXIT_CODE = 1
// execa reports `undefined` when a child is terminated by a signal, which is what the timeout does.
const SIGNAL_EXIT_CODE = undefined
const ELAPSED_MS = 3400
const DONE_LINE = 'Done in 3.4s'
// What `prepare` prints in a linked work tree, whose hooks belong to the primary repository
// (joshuafolkken/kit#1503, #1507). It rides on a successful install and is not a failure.
const LEFTHOOK_WARNING = `lefthook install failed: git hooks are NOT installed.\n${DONE_LINE}`
const FROZEN_LOCKFILE_ERROR = 'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"'

function process_answers(exit_code: number | undefined, output: string): void {
	mocked_run.mockResolvedValue({ output, exit_code, elapsed_ms: ELAPSED_MS })
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('install_dependencies — what it asks for', () => {
	// The lane, not the process's own directory: `lane:open` is typed in the primary checkout, so an
	// install that inherited the working directory would reinstall the repository it was run from and
	// leave the lane exactly as empty as before.
	it('installs the committed lock in the lane directory, under its own time bound', async () => {
		process_answers(SUCCESS_EXIT_CODE, '')

		await lane_install.install_dependencies(LANE_DIRECTORY)

		expect(mocked_run).toHaveBeenCalledWith(INSTALL_ARGUMENTS, {
			cwd: LANE_DIRECTORY,
			timeout_ms: INSTALL_TIMEOUT_MS,
		})
	})

	// A lane that builds a lock of its own would be running its verification gate against dependencies
	// nothing committed, so the flag is pinned rather than left to whatever pnpm defaults to.
	it('refuses to let the install rewrite the lock it was cut from', () => {
		expect(INSTALL_ARGUMENTS).toStrictEqual(['install', '--frozen-lockfile'])
	})
})

describe('install_dependencies — how it reads the answer', () => {
	it('reports an install that exited zero as installed, keeping what it printed', async () => {
		process_answers(SUCCESS_EXIT_CODE, DONE_LINE)

		const result = await lane_install.install_dependencies(LANE_DIRECTORY)

		expect(result).toStrictEqual({ is_installed: true, output: DONE_LINE })
	})

	// The whole point of deciding on the exit code alone. A lane whose hooks are the primary
	// repository's is the normal case, and refusing to open it over that warning would replace the
	// failure this module removes with a different one.
	it('does not read the lefthook warning of a zero exit as a failure', async () => {
		process_answers(SUCCESS_EXIT_CODE, LEFTHOOK_WARNING)

		const result = await lane_install.install_dependencies(LANE_DIRECTORY)

		expect(result.is_installed).toBe(true)
	})

	// Reported rather than thrown, because the caller has to say which lane it was and what to type
	// next — and it can only do that with the child's own output in hand.
	it('reports a non-zero exit as not installed and keeps the output', async () => {
		process_answers(FAILING_EXIT_CODE, FROZEN_LOCKFILE_ERROR)

		const result = await lane_install.install_dependencies(LANE_DIRECTORY)

		expect(result).toStrictEqual({ is_installed: false, output: FROZEN_LOCKFILE_ERROR })
	})

	// A child the timeout killed reports no exit code at all. Read as anything but a failure, a
	// registry that never answers would hand back a lane with a half-written store in it.
	it('treats a signal-terminated install as not installed', async () => {
		process_answers(SIGNAL_EXIT_CODE, '')

		const result = await lane_install.install_dependencies(LANE_DIRECTORY)

		expect(result.is_installed).toBe(false)
	})
})
