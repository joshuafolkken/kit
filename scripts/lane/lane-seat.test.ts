import { describe, expect, it } from 'vitest'
import { lane_seat } from './lane-seat'

const PROBLEM = 'process ownership unreadable'

describe('lane seat allocation', () => {
	it('rejects unreadable ownership even when a reservation exists', () => {
		expect(() => {
			lane_seat.guard_readable('/missing', [
				{
					issue: '5444',
					branch: '5444-lane',
					directory: '/missing/5444',
					seat: 1,
					seat_problem: PROBLEM,
					output: undefined,
					development_port: undefined,
					preview_port: undefined,
					is_stranded: false,
				},
			])
		}).toThrow(PROBLEM)
	})
})
