import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5645. `--wait` opens on the section that governs the watcher; the verbs that start
// no watcher, and a lane child refused one, print none. The print itself is `run-step-section.test.ts`'s.
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { PROGRESS: 'run:progress', print_once: vi.fn() },
}))
vi.mock('#scripts/gh/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner_within: vi.fn() },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: vi.fn() },
}))
vi.mock('./run-progress-read', () => ({
	run_progress_read: {
		live_target: vi.fn(),
		log_target: vi.fn(),
		mark: vi.fn(),
		stamp_target: vi.fn(),
	},
}))

const { run_step_section } = await import('#scripts/run/run-step-section')
const { gh_spawn } = await import('#scripts/gh/gh-spawn')
const { lane_child_marker } = await import('#scripts/lane/lane-child-marker')
const { run_progress_read } = await import('./run-progress-read')
const { run_progress_cli } = await import('./run-progress-cli')

const print_once = vi.mocked(run_step_section.print_once)
const FAILURE = 1

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(gh_spawn.get_repo_name_with_owner_within).mockReturnValue('joshuafolkken/kit')
	vi.mocked(lane_child_marker.is_child_of).mockReturnValue(false)
	vi.stubEnv('JOSH_PROGRESS', '')
	print_once.mockReturnValue(FAILURE)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('run:progress — the governing section at a --wait start', () => {
	it('prints the run:progress row, and starts no watcher when it does not resolve', async () => {
		await expect(run_progress_cli.run(['--wait'])).resolves.toBe(FAILURE)

		expect(print_once).toHaveBeenCalledExactlyOnceWith(run_step_section.PROGRESS)
		expect(run_progress_read.live_target).not.toHaveBeenCalled()
	})

	it.each([['--mark'], ['--path']])('prints nothing for %s', async (flag) => {
		await run_progress_cli.run([flag])

		expect(print_once).not.toHaveBeenCalled()
	})

	it('prints nothing in a lane child, which is refused a watcher', async () => {
		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(true)

		await run_progress_cli.run(['--wait'])

		expect(print_once).not.toHaveBeenCalled()
	})
})
