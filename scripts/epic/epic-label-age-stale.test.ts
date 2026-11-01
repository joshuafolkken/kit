import { describe, expect, it } from 'vitest'
import { epic_label_age } from './epic-label-age'

const NOW = new Date('2026-11-01T12:00:00Z')
const PAST_WINDOW = '2026-11-01T10:29:00Z'

describe('epic_label_age.is_stale', () => {
	it('is false for a timeline that could not be read', () => {
		expect(epic_label_age.is_stale({ kind: 'unread' }, NOW)).toBe(false)
	})

	it('is true for a label older than the timeline keeps', () => {
		expect(epic_label_age.is_stale({ kind: 'absent' }, NOW)).toBe(true)
	})

	it('is false at exactly the window', () => {
		expect(epic_label_age.is_stale({ kind: 'at', at: '2026-11-01T10:30:00Z' }, NOW)).toBe(false)
	})

	it('is true one minute past the window', () => {
		expect(epic_label_age.is_stale({ kind: 'at', at: PAST_WINDOW }, NOW)).toBe(true)
	})

	it('agrees with the stale mark age_text prints', () => {
		expect(epic_label_age.age_text({ kind: 'at', at: PAST_WINDOW }, NOW)).toBe(
			'in-progress for 91 min — stale',
		)
	})
})
