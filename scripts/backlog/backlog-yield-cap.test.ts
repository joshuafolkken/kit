import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_park_release } from '#scripts/run/park/run-park-release'
import { run_stalled_park } from '#scripts/run/park/run-stalled-park'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_yield_cap } from './backlog-yield-cap'

const { PORTS, TRIP_CAUSE, WINDOW_MS, YIELD_CAP, body_of, capped, is_tripped, times_of } =
	backlog_yield_cap
const ISSUE = '6799'
const NOW = new Date('2026-11-08T16:30:00.000Z')

function ago(milliseconds: number): string {
	return new Date(NOW.getTime() - milliseconds).toISOString()
}

function note(text: string, at: string): RunEvent {
	return { pos: 0, kind: run_event_stream.EVENT_KIND.NOTE, text, at }
}

describe('backlog_yield_cap.is_tripped', () => {
	it('trips on YIELD_CAP yields within the window', () => {
		const times = Array.from({ length: YIELD_CAP }, (_, index) => ago(index * MS_PER_MINUTE))

		expect(is_tripped(times, NOW)).toBe(true)
	})

	it('does not trip one yield short of the cap', () => {
		const times = Array.from({ length: YIELD_CAP - 1 }, () => ago(0))

		expect(is_tripped(times, NOW)).toBe(false)
	})

	it('counts a yield on the window edge and drops one past it', () => {
		const inside = Array.from({ length: YIELD_CAP - 1 }, () => ago(0))

		expect(is_tripped([...inside, ago(WINDOW_MS)], NOW)).toBe(true)
		expect(is_tripped([...inside, ago(WINDOW_MS + 1)], NOW)).toBe(false)
	})
})

describe('backlog_yield_cap.times_of', () => {
	it("keeps only the issue's own yield notes", () => {
		const at = ago(0)
		const events = [
			note(`#${ISSUE} yielded its lane: held by #6798 · at: entry`, at),
			note('#6800 yielded its lane: held by #6798 · at: entry', at),
			note(`#${ISSUE} parked by backlog:drive`, at),
		]

		expect(times_of(events, ISSUE)).toStrictEqual([at])
	})
})

describe('backlog_yield_cap.capped', () => {
	it('leaves a child collected as merged alone, whatever its recent yields', async () => {
		const parks: Array<string> = []
		const ports = {
			yields: async () => Array.from({ length: YIELD_CAP }, () => ago(0)),
			park: async (issue: string) => {
				parks.push(issue)
			},
			now: () => NOW,
		}
		const before = backlog_drive.initial_state([], NOW.toISOString())
		const after = await capped(ISSUE, 'merged', before, ports)

		expect(parks).toStrictEqual([])
		expect(after).toBe(before)
	})
})

describe('backlog_yield_cap.PORTS', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("reads the issue's yield times off the run's event stream", async () => {
		const at = ago(0)

		vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([
			note(`#${ISSUE} yielded its lane: held by #6798 · at: entry`, at),
		])

		await expect(PORTS.yields(ISSUE)).resolves.toStrictEqual([at])
	})

	// joshuafolkken/kit#7076: a mechanical stop the drive's auto-retry re-offers, not a person's park.
	it('parks run:stalled with the trip cause, then releases the lane', async () => {
		const apply = vi.spyOn(run_stalled_park, 'apply').mockResolvedValue(true)
		const release = vi.spyOn(run_park_release, 'release').mockResolvedValue(0)

		await PORTS.park(ISSUE, 'body')

		expect(apply).toHaveBeenCalledWith(ISSUE, 'body', TRIP_CAUSE)
		expect(release).toHaveBeenCalledWith(ISSUE)
	})

	it('releases nothing when the run:stalled label did not land', async () => {
		vi.spyOn(run_stalled_park, 'apply').mockResolvedValue(false)
		const release = vi.spyOn(run_park_release, 'release').mockResolvedValue(0)

		await PORTS.park(ISSUE, 'body')

		expect(release).not.toHaveBeenCalled()
	})
})

describe('backlog_yield_cap.body_of', () => {
	it('names the label, the trip and the automatic re-offer, asking no person', () => {
		const body = body_of(ISSUE)

		expect(body).toContain(`Parked with \`${RUN_STALLED_LABEL}\``)
		expect(body).toContain('re-offers it itself')
		expect(body).not.toContain('必要な権限')
	})
})
