import { stripVTControlCharacters } from 'node:util'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { Found } from './run-board-found'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#5132: the board reads `JOSH_LANE_INVESTIGATION` as `run:merge` does, and a merged
// row hides its skip only while the switch stays off (joshuafolkken/kit#5194: whatever its note).

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const CHILD = 5106
const AT = new Date(START).toISOString()
const EVENTS: ReadonlyArray<RunEvent> = [
	{ pos: 1, at: AT, kind: 'child-launch', text: `#${String(CHILD)} a` },
	{ pos: 2, at: AT, kind: 'merge', text: `#${String(CHILD)} merged` },
]
const DISABLED: Found = {
	filed: ['5109'],
	overrun_filed: [],
	minutes: undefined,
	overrun: { kind: 'skipped', issue: CHILD, reason: run_event_overrun.DISABLED_REASON },
	longest: undefined,
	is_investigating: false,
}
const MERGED: LocalRead = { ...LOCAL, events: EVENTS, found: new Map([[CHILD, DISABLED]]) }

async function row_with(value: string | undefined): Promise<string> {
	vi.stubEnv('JOSH_LANE_INVESTIGATION', value)

	const { ports, frames } = harness(MERGED, [])

	await tick(FRESH_STATE, ports, 'background')

	const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

	return lines.find((line) => line.includes(String(CHILD))) ?? ''
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tick.tick — the investigation switch', () => {
	it('hides a switched-off skip with the switch unset', async () => {
		const row = await row_with(undefined)

		expect(row).toMatch(/5109$/u)
		expect(row).not.toContain('⏭')
	})

	it('draws the skip with the switch on', async () => {
		expect(await row_with('on')).toContain(`⏭ ${run_event_overrun.DISABLED_REASON}`)
	})
})
