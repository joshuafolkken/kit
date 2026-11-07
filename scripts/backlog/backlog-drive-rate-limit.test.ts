import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, expect, test, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_rate_limit } from './backlog-drive-rate-limit'

const { REMAINING_FLOOR, held } = backlog_drive_rate_limit
const ACTIVE = new Date().toISOString()
const RETRIES = 2
const LIMIT = 5000
const RESET_SECONDS = 1_793_000_000
const RESET_MS = 1_793_000_000_000
const STATE = { ...backlog_drive.initial_state([], ACTIVE), retries: RETRIES }

function core_of(remaining: number): string {
	return JSON.stringify({ used: LIMIT - remaining, limit: LIMIT, remaining, reset: RESET_SECONDS })
}

afterEach(() => {
	vi.restoreAllMocks()
})

test('holds the offer until the reset while the core allowance is below the floor', async () => {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(core_of(REMAINING_FLOOR - 1))

	await expect(held(STATE)).resolves.toStrictEqual({
		verdict: 'wait',
		issues: [],
		retries: RETRIES,
		not_before_ms: RESET_MS,
	})
})

test('holds an exhausted allowance until the reset', async () => {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(core_of(0))

	const read = await held(STATE)

	expect(read?.not_before_ms).toBe(RESET_MS)
})

test.each([REMAINING_FLOOR, LIMIT])('offers as usual with %i remaining', async (remaining) => {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(core_of(remaining))

	await expect(held(STATE)).resolves.toBeUndefined()
})

test('offers as usual when the rate limit cannot be read', async () => {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('gh: (HTTP 502)'))

	await expect(held(STATE)).resolves.toBeUndefined()
})

test('offers as usual when the rate limit answer is misshapen', async () => {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue('gh: not found')

	await expect(held(STATE)).resolves.toBeUndefined()
})

test('reads the core allowance through the reader it is handed', async () => {
	const read_core = vi.fn(async () => await undefined)

	await held(STATE, read_core)

	expect(read_core).toHaveBeenCalledOnce()
})
