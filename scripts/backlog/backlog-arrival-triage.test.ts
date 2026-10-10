import { describe, expect, it, vi } from 'vitest'
import { backlog_arrival, type ArrivalPorts } from './backlog-arrival'

// joshuafolkken/kit#2779: a `triage` answer names no number, yet the parent has work — judging the
// untriaged issues — so the arrival probe reads it as an arrival, never as an empty pool.

const START_MS = 1_000_000
const MINUTE_MS = backlog_arrival.PROBE_INTERVAL_MS
const FREE = 3
const TRIAGE = 'triage'

interface Pool {
	issues: Array<string>
}

function ports_of(pool: Pool): ArrivalPorts {
	return {
		free_lane_count: vi.fn(async () => FREE),
		ready_issues: vi.fn(async () => [...pool.issues]),
		is_added_since: vi.fn(async () => false),
	}
}

async function parent(): Promise<boolean> {
	return true
}

describe('backlog_arrival.answered_issues — triage', () => {
	it('reads a triage answer as the one triage token', () => {
		expect(backlog_arrival.answered_issues({ code: 0, out: TRIAGE })).toEqual([TRIAGE])
	})
})

describe('backlog_arrival.start — triage', () => {
	it('wakes the parent when the pool turns to triage during the wait', async () => {
		const pool: Pool = { issues: ['2445'] }
		const probe = await backlog_arrival.start(START_MS, ports_of(pool), parent)

		pool.issues = [TRIAGE]

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(true)
	})

	it('reads nothing into a baseline taken during triage, so judging it wakes nobody for the whole pool', async () => {
		const pool: Pool = { issues: [TRIAGE] }
		const probe = await backlog_arrival.start(START_MS, ports_of(pool), parent)

		pool.issues = ['2445', '2446']

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
		await expect(probe.has_arrived(START_MS + MINUTE_MS + MINUTE_MS)).resolves.toBe(false)
	})
})
