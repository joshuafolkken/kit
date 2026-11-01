import type { HoldRead, RunHold } from '#scripts/run/hold/run-hold'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_release } from './run-park-release'

const { directory_mock, read_mock, release_mock } = vi.hoisted(() => ({
	directory_mock: vi.fn<() => Promise<string | undefined>>(),
	read_mock: vi.fn<(target: string) => HoldRead>(),
	release_mock: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
}))

vi.mock(import('#scripts/run/hold/run-hold'), async (import_original) => {
	const { run_hold } = await import_original()

	return {
		run_hold: { ...run_hold, worktree_directory: directory_mock, read_hold: read_mock },
	}
})
vi.mock('#scripts/run/hold/run-hold-cli', () => ({ run_hold_cli: { run: release_mock } }))

const ISSUE = '5737'
const OTHER_ISSUE = '5643'
const GIT_DIRECTORY = '/repo/.git/worktrees/5737'

function held_by(issue: string): HoldRead {
	const hold: RunHold = { issue, taken_at: '2026-11-01T00:00:00.000Z', pid: 1 }

	return { kind: 'held', hold }
}

beforeEach(() => {
	directory_mock.mockReset().mockResolvedValue(GIT_DIRECTORY)
	read_mock.mockReset().mockReturnValue(held_by(ISSUE))
	release_mock.mockReset().mockResolvedValue(0)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

// joshuafolkken/kit#5737: a landed park runs `run:release <N>`'s own implementation.
describe('run_park_release.release', () => {
	it.each([[held_by(ISSUE)], [{ kind: 'free' } as const], [{ kind: 'unreadable' } as const]])(
		'runs run:release for the parked issue when the hold read is %j',
		async (read) => {
			read_mock.mockReturnValue(read)

			await expect(run_park_release.release(ISSUE)).resolves.toBe(0)
			expect(release_mock).toHaveBeenCalledWith(['--release', ISSUE])
		},
	)

	it('keeps the park and prints the release to re-run when it fails', async () => {
		release_mock.mockResolvedValue(1)

		await expect(run_park_release.release(ISSUE)).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`re-run: pnpm josh run:release ${ISSUE}`),
		)
	})

	it('runs run:release when the git directory cannot be read', async () => {
		directory_mock.mockRejectedValue(new Error('git rev-parse failed'))
		release_mock.mockResolvedValue(1)

		await expect(run_park_release.release(ISSUE)).resolves.toBe(1)
		expect(release_mock).toHaveBeenCalledWith(['--release', ISSUE])
	})

	// A split lane parks a leftover child of its own issue: that tree's hold is its own run's.
	it('releases nothing when the hold names another run', async () => {
		read_mock.mockReturnValue(held_by(OTHER_ISSUE))

		await expect(run_park_release.release(ISSUE)).resolves.toBe(0)
		expect(release_mock).not.toHaveBeenCalled()
	})
})
