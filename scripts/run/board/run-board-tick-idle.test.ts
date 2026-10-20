import { stripVTControlCharacters } from 'node:util'
import { lane_await } from '#scripts/lane/lane-await'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3893: a lane whose child had died was drawn running, and one probe alone drew a lane
// stopped mid-handoff after a boundary cut, so the board draws it stopped only once it has stayed idle
// for `lane:await`'s re-confirm window.

const { LOCAL, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { LOCAL_READ_MS } = run_board_gather
const WINDOW = lane_await.RECONFIRM_MS
const CHILD = 3421
const LANE = String(CHILD)
const LAUNCH = { pos: 1, at: '2026-10-08T09:00:00.000Z', kind: 'child-launch', text: '#3421 a' }
const IDLE: LocalRead = { ...LOCAL, events: [LAUNCH], lanes: [LANE], idle_lanes: [LANE] }
const WORKING: LocalRead = { ...IDLE, idle_lanes: [] }

// The child's row in the newest frame.
function row_of(frames: ReadonlyArray<string>): string | undefined {
	const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

	return lines.find((line) => line.includes(` ${LANE} `))
}

describe('run_board_tick.tick on a live board', () => {
	it('draws an idle lane running until it has stayed idle for the window', async () => {
		const { ports, frames, clock } = harness(IDLE, [])
		const first = await tick(FRESH_STATE, ports, 'background')

		expect(row_of(frames)).not.toContain('🛑')

		clock.now_ms += WINDOW + LOCAL_READ_MS
		await tick(first, ports, 'background')

		expect(row_of(frames)).toContain('🛑')
	})
})

describe('run_board_tick.tick for a single frame', () => {
	it('waits out the window and draws a lane idle on both reads stopped', async () => {
		const { ports, frames, clock, read_local, gathering } = harness(IDLE, [])
		const sleep = vi.fn(async (ms: number) => {
			clock.now_ms += ms
		})

		gathering.sleep = sleep
		await tick(FRESH_STATE, ports)

		expect(sleep).toHaveBeenCalledExactlyOnceWith(WINDOW)
		expect(read_local).toHaveBeenCalledTimes(2)
		expect(row_of(frames)).toContain('🛑')
	})

	it('draws a lane its second read finds working running, as a cut handed over', async () => {
		const { ports, frames, clock, read_local, gathering } = harness(IDLE, [])

		read_local.mockResolvedValueOnce(IDLE).mockResolvedValueOnce(WORKING)

		gathering.sleep = async (ms) => {
			clock.now_ms += ms
		}

		await tick(FRESH_STATE, ports)

		expect(row_of(frames)).not.toContain('🛑')
	})

	it('reads once and waits for nothing when no lane is idle', async () => {
		const { ports, read_local, gathering } = harness(WORKING, [])
		const sleep = vi.fn(async () => undefined)

		gathering.sleep = sleep
		await tick(FRESH_STATE, ports)

		expect(sleep).not.toHaveBeenCalled()
		expect(read_local).toHaveBeenCalledOnce()
	})
})
