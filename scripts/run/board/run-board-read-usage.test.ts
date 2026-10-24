import type { CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

// joshuafolkken/kit#4796: the usage limit in force is the newest stop of the carried invocation — the
// events `backlog:drive` holds its launches on — until its reset passes.

const { AFTER, CARRY, ENDED_AT, arrange } = run_board_read_fixture
const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }
const NONE: CarryRead = { kind: 'none' }
const ENDED = {
	invocation: 'backlogrun #3431 --only',
	started_at: '2026-10-08T09:00:00.000Z',
	ended_at: ENDED_AT,
}
const RESET_MS = Date.parse(AFTER.at) + 60_000
const STOP = {
	...AFTER,
	kind: run_event_stream.EVENT_KIND.USAGE_LIMIT,
	text: `#3432 usage limit — resumes at ${new Date(RESET_MS).toISOString()}`,
}

function arrange_stop(carry: CarryRead, now_ms: number, stop = STOP): void {
	arrange(carry, carry.kind === 'carried' ? undefined : ENDED)
	vi.spyOn(run_event_stream, 'read_events').mockReturnValue([stop])
	vi.spyOn(Date, 'now').mockReturnValue(now_ms)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local — the usage limit in force', () => {
	it('reads the running run’s reset while it is ahead', async () => {
		arrange_stop(CARRIED, RESET_MS - 1)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ usage_reset_ms: RESET_MS })
	})

	it('reads none once the reset has passed', async () => {
		arrange_stop(CARRIED, RESET_MS)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ usage_reset_ms: undefined })
	})

	it('reads none from a stop before the running run began, which the driver does not hold on', async () => {
		const earlier = { ...STOP, at: new Date(Date.parse(CARRY.started_at) - 1).toISOString() }

		arrange_stop(CARRIED, RESET_MS - 1, earlier)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ usage_reset_ms: undefined })
	})

	it('reads none where no run is carried', async () => {
		arrange_stop(NONE, RESET_MS - 1)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ usage_reset_ms: undefined })
	})
})
