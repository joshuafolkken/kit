import { describe, expect, it } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_seat_ownership, type SeatSnapshot } from './lane-seat-ownership'

const ROOT = '/work/.kit-lanes'
const PORT = 5174
const SEATS = 9

function lane(seat = 1): LaneInfo {
	return {
		issue: String(seat),
		branch: `${String(seat)}-lane`,
		directory: `${ROOT}/${String(seat)}`,
		seat,
		development_port: PORT + seat - 1,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

function snapshot(): SeatSnapshot {
	return { running: new Set(), ports: new Set() }
}

describe('lane seat ownership', () => {
	it('reclaims nine legacy stopped trees while retaining their recorded seats', () => {
		const lanes = Array.from({ length: SEATS }, (_unused, index) => lane(index + 1))
		const reading = { ...snapshot(), running: new Set(['1']) }
		const measured = lane_seat_ownership.measure(lanes, reading)

		expect(measured.filter((entry) => entry.seat_held).map((entry) => entry.seat)).toEqual([1])
		expect(measured.map((entry) => entry.seat)).toEqual(lanes.map((entry) => entry.seat))
	})

	it('protects a bound port even when its owner has moved elsewhere or is suspended', () => {
		const [measured] = lane_seat_ownership.measure([lane()], {
			...snapshot(),
			ports: new Set([PORT]),
		})

		expect(measured?.seat_held).toBe(true)
	})

	it('protects a running child before it binds a port', () => {
		const [measured] = lane_seat_ownership.measure([lane()], {
			...snapshot(),
			running: new Set(['1']),
		})

		expect(measured?.seat_held).toBe(true)
	})

	it('reports unreadable ownership instead of freeing the seat', () => {
		const [measured] = lane_seat_ownership.measure([lane()], undefined)

		expect(measured?.seat_held).toBe(true)
		expect(measured?.seat_problem).toContain('process')
	})
})
