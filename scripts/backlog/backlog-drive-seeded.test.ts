import { lane_await } from '#scripts/lane/lane-await'
import { describe, expect, it } from 'vitest'
import { backlog_drive, type LoopPorts } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#8855: a new run seeded with children an outage killed reads them finished only
// after the re-confirm window, so the first offer waits for them: fresh issues launched first took the
// seats the outage children were to resume in.

const { ACTIVE, CONFIG, harness, offer } = backlog_drive_fixture
const START_MS = Date.parse(ACTIVE)
const SEEDED = ['8751', '8752', '8753', '8754', '8755', '8756']
const FRESH = ['8801', '8802', '8803', '8804']
const SEATS = 6
// Past the settling window, so the loop ends by it rather than by an offer.
const WINDOW_MS = 3 * lane_await.RECONFIRM_MS

// A dead child reads finished only once the re-confirm window has passed, and gone once merged.
function reconfirmed(ports: LoopPorts, merged: ReadonlySet<string>): LoopPorts['is_finished'] {
	return (issue) =>
		SEEDED.includes(issue) &&
		!merged.has(issue) &&
		ports.now().getTime() >= START_MS + lane_await.RECONFIRM_MS
}

function seeded_ports(base: LoopPorts, offered_at: Array<number>): LoopPorts {
	const merged = new Set<string>()

	return {
		...base,
		is_finished: reconfirmed(base, merged),
		merge: async (issue) => {
			merged.add(issue)

			return await base.merge(issue)
		},
		offer: async (asked) => {
			offered_at.push(base.now().getTime() - START_MS)

			return await base.offer(asked)
		},
	}
}

describe('backlog_drive.run_loop — a run seeded with outage children', () => {
	it('collects the dead seeded children before its first offer', async () => {
		const { ports, calls } = harness({
			offers: [offer('run', FRESH)],
			free_lanes: [SEATS],
		})
		const offered_at: Array<number> = []
		const state = backlog_drive.initial_state(SEEDED, ACTIVE)

		await backlog_drive.run_loop(
			state,
			{ ...CONFIG, window_ms: WINDOW_MS },
			seeded_ports(ports, offered_at),
		)

		expect(calls.slice(0, SEEDED.length + 1)).toStrictEqual([
			...SEEDED.map((issue) => `merge ${issue}`),
			'offer',
		])
		expect(offered_at[0]).toBeGreaterThanOrEqual(lane_await.RECONFIRM_MS)
		expect(calls).toEqual(expect.arrayContaining(FRESH.map((issue) => `launch ${issue}`)))
	})

	it('offers nothing while the settling window is open and nothing has been collected', async () => {
		const { ports, calls } = harness({ offers: [offer('run', FRESH)], free_lanes: [SEATS] })
		const state = backlog_drive.initial_state(SEEDED, ACTIVE)
		const end = await backlog_drive.run_loop(
			state,
			{ ...CONFIG, window_ms: lane_await.RECONFIRM_MS - CONFIG.poll_ms },
			seeded_ports(ports, []),
		)

		expect(end.reason).toBe('window')
		expect(calls).toStrictEqual([])
	})
})
