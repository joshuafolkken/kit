import { describe, expect, it } from 'vitest'
import { lane_load } from './lane-load'

// joshuafolkken/kit#9000: a load sample carries the core budget's admitted claims by command, so a load
// past the cores reads as work outside the budget or a claim using more than it reserved.

const ADMITTED_AT = 1
const TEST_RELATED = 'test:related'
const GATE_ESLINT = 'gate eslint'
const UNLABELLED = 'unlabelled'

interface Claim {
	reservation: { weight: number; admitted_at: number }
}

function read_one_claim(): Array<Claim> {
	return [{ reservation: { weight: 2, admitted_at: ADMITTED_AT } }]
}

function read_none(): Array<Claim> {
	return []
}

function read_unreadable(): never {
	throw new Error('unreadable')
}

describe('lane_load.group_reserved', () => {
	it('sums the admitted claims of one command', () => {
		const claims = [
			{ command: TEST_RELATED, weight: 2, admitted_at: ADMITTED_AT },
			{ command: TEST_RELATED, weight: 3, admitted_at: ADMITTED_AT },
			{ command: GATE_ESLINT, weight: 1, admitted_at: ADMITTED_AT },
		]

		expect(lane_load.group_reserved(claims)).toStrictEqual([
			{ command: TEST_RELATED, cores: 5 },
			{ command: GATE_ESLINT, cores: 1 },
		])
	})

	it('counts a narrowed claim at its grant rather than its weight', () => {
		const claims = [{ command: TEST_RELATED, weight: 6, granted: 2, admitted_at: ADMITTED_AT }]

		expect(lane_load.group_reserved(claims)).toStrictEqual([{ command: TEST_RELATED, cores: 2 }])
	})

	it('leaves out a claim still waiting and a weightless launch', () => {
		const claims = [
			{ command: 'gate tsc', weight: 2 },
			{ command: 'lane:launch', weight: 0, admitted_at: ADMITTED_AT },
		]

		expect(lane_load.group_reserved(claims)).toStrictEqual([])
	})

	it('labels a claim that named no command', () => {
		const claims = [{ weight: 1, admitted_at: ADMITTED_AT }]

		expect(lane_load.group_reserved(claims)).toStrictEqual([{ command: UNLABELLED, cores: 1 }])
	})
})

describe('lane_load.read_reserved', () => {
	it('reads the live markers grouped by command', () => {
		expect(lane_load.read_reserved(read_one_claim)).toStrictEqual([
			{ command: UNLABELLED, cores: 2 },
		])
	})

	it('records an empty reservation when no claim is live', () => {
		expect(lane_load.read_reserved(read_none)).toStrictEqual([])
	})

	it('records no reservation when the markers could not be read', () => {
		expect(lane_load.read_reserved(read_unreadable)).toBeUndefined()
	})
})
