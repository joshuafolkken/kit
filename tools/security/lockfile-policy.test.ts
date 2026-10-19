import { git_spawn } from '#scripts/git/git-spawn'
import { metrics_base } from '#tools/metrics/metrics-base'
import { lockfile_policy } from '#tools/security/lockfile-policy'
import { execaSync } from 'execa'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const BASE = 'abc123'
const FAILED_EXIT = 1
const LOCKFILE = 'pnpm-lock.yaml'
const WORKSPACE = 'pnpm-workspace.yaml'

function exit_with(exit_code: number): void {
	const value: unknown = { exitCode: exit_code }

	vi.mocked(execaSync).mockReturnValue(value as ReturnType<typeof execaSync>)
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.mocked(execaSync).mockReset()
})

describe('lockfile_policy.has_policy_change', () => {
	it('verifies when no merge-base could be read', async () => {
		const read = vi.spyOn(git_spawn, 'read')

		await expect(lockfile_policy.has_policy_change(undefined)).resolves.toBe(true)
		expect(read).not.toHaveBeenCalled()
	})

	it('diffs only the lockfile and the workspace policy against the base', async () => {
		const read = vi.spyOn(git_spawn, 'read').mockResolvedValue('')

		await expect(lockfile_policy.has_policy_change(BASE)).resolves.toBe(false)
		expect(read).toHaveBeenCalledWith(['diff', '--name-only', BASE, '--', LOCKFILE, WORKSPACE])
	})

	it('answers changed when either file differs from the base', async () => {
		vi.spyOn(git_spawn, 'read').mockResolvedValue(WORKSPACE)

		await expect(lockfile_policy.has_policy_change(BASE)).resolves.toBe(true)
	})
})

describe('lockfile_policy.main', () => {
	it('spawns nothing when neither file moved from the merge-base', async () => {
		vi.spyOn(metrics_base, 'resolve_commit').mockResolvedValue(BASE)
		vi.spyOn(git_spawn, 'read').mockResolvedValue('')

		await expect(lockfile_policy.main()).resolves.toBe(0)
		expect(execaSync).not.toHaveBeenCalled()
	})

	it("re-verifies the trusted lockfile with pnpm's own policy check when it moved", async () => {
		vi.spyOn(metrics_base, 'resolve_commit').mockResolvedValue(BASE)
		vi.spyOn(git_spawn, 'read').mockResolvedValue(LOCKFILE)
		exit_with(0)

		await expect(lockfile_policy.main()).resolves.toBe(0)
		expect(execaSync).toHaveBeenCalledWith(
			'pnpm',
			['install', '--frozen-lockfile', '--lockfile-only', '--config.trust-lockfile=false'],
			expect.anything(),
		)
	})

	it('fails when pnpm finds an entry younger than minimumReleaseAge', async () => {
		vi.spyOn(metrics_base, 'resolve_commit').mockResolvedValue(undefined)
		exit_with(FAILED_EXIT)

		await expect(lockfile_policy.main()).resolves.toBe(FAILED_EXIT)
	})
})
