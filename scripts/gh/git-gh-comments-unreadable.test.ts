import { describe, expect, it, vi } from 'vitest'
import {
	is_retry_pending,
	note_unreadable_comments,
	note_unreadable_stop,
	RETRY_PENDING_KEY,
	RETRY_PENDING_VALUE,
	UNREADABLE_COMMENTS_STOP,
} from './git-gh-comments-unreadable'

// joshuafolkken/kit#5012: gh's reason is warned rather than swallowed, and the gate's stop goes to the
// standard output, the only stream `josh ship` reads a followup's infrastructure on.
describe('git-gh-comments-unreadable', () => {
	it('warns with the branch and gh reason', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn())

		note_unreadable_comments('4983-lane', 'HTTP 404')

		expect(warn).toHaveBeenCalledWith(
			'⚠ pull request comments could not be read for 4983-lane: HTTP 404',
		)
	})

	it('prints the stop on the standard output', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(vi.fn())

		note_unreadable_stop()

		expect(info).toHaveBeenCalledWith(`⚠️ ${UNREADABLE_COMMENTS_STOP}`)
	})

	it('reads a retry as pending only while the ship sets it', () => {
		vi.stubEnv(RETRY_PENDING_KEY, RETRY_PENDING_VALUE)
		expect(is_retry_pending()).toBe(true)
		vi.stubEnv(RETRY_PENDING_KEY, undefined)
		expect(is_retry_pending()).toBe(false)
		vi.unstubAllEnvs()
	})
})
