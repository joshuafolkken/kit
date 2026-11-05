import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_command } from './epic'
import { epic_untrack } from './epic-untrack'

vi.mock('./epic-untrack', () => ({ epic_untrack: { untrack: vi.fn() } }))

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(epic_untrack.untrack).mockResolvedValue(0)
})

describe('epic untrack dispatch (ac-d354226c)', () => {
	it('passes the strict parsed child set to the writer and returns its failure', async () => {
		vi.mocked(epic_untrack.untrack).mockResolvedValue(1)
		await expect(epic_command.run(['--untrack', '900', '101', '101'])).resolves.toBe(1)
		expect(epic_untrack.untrack).toHaveBeenCalledExactlyOnceWith(900, [101])
	})

	it('refuses malformed child inputs without calling the writer and prints usage', async () => {
		await expect(epic_command.run(['--untrack', '900', '101', 'invalid'])).resolves.toBe(1)
		expect(epic_untrack.untrack).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--untrack <E>'))
	})
})
