import { describe, expect, it, vi } from 'vitest'
import { epic_read } from './epic-read'
import { epic_reconcile } from './epic-reconcile'

// joshuafolkken/kit#4533: `run:pause` names a refusal as one `epic --reconcile` would make, so an
// epic it could not read is a failed read, never a refusal.
describe('epic_reconcile.refusal_after — an unreadable epic', () => {
	it('throws the read error rather than returning it as a refusal', async () => {
		const unread = 'Could not read issue #7.'

		vi.spyOn(epic_read, 'read_epic').mockResolvedValueOnce({ error: unread })

		await expect(epic_reconcile.refusal_after(7, { blocker: 1, blocked: 2 })).rejects.toThrow(
			unread,
		)
	})
})
