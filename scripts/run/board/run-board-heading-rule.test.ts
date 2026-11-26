import { stripVTControlCharacters } from 'node:util'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_label_pair } from './run-board-label-pair'
import type { LocalRead } from './run-board-read'
import { run_board_theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8940: in the emoji-free board every section heading reads `V -- NAME`
// (joshuafolkken/kit#8154); letters draw the lead V as `--` too, so a rule heading reads `-- -- NAME`. The headings are picked from the rendered frame, not from a list of icons.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const KIND = run_event_stream.EVENT_KIND
const ROOT = 7521
const LANE = 7530
const LANE_LIMIT = 6
const AT = new Date(START).toISOString()
const RULE_LEAD = '-- -- '
const COMMANDS = ['fullrun', 'halfrun', 'prrun'] as const

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

function carried(command: string): LocalRead {
	return {
		...LOCAL,
		events: [event(KIND.CHILD_LAUNCH, `#${String(LANE)} fullrun`)],
		lanes: [String(LANE)],
		occupied_count: 1,
		lane_limit: LANE_LIMIT,
		free_lanes: LANE_LIMIT - 1,
		root: {
			command,
			issue: ROOT,
			events: [
				event(KIND.CHILD_LAUNCH, `#${String(ROOT)} ${command}`),
				event(KIND.LANE_PHASE, `#${String(ROOT)} implement`),
			],
		},
	}
}

async function base_frame(local: LocalRead): Promise<string> {
	const { ports, frames } = harness(local, [])

	await tick(FRESH_STATE, ports)

	return stripVTControlCharacters(frames.at(-1) ?? '')
}

// The heading lines of the emoji-free frame, found by the lead the base frame gives a heading.
async function headings_of(local: LocalRead): Promise<Array<string>> {
	const frame = await base_frame(local)
	const drawn = run_board_theme.restyle('wopr', frame, 'letters').split('\n')

	return frame
		.split('\n')
		.map((line, index) =>
			run_board_label_pair.heading_lead(line) === undefined ? '' : drawn[index],
		)
		.filter((line): line is string => line !== undefined && line !== '')
}

describe('the emoji-free board headings', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '0')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it.each(COMMANDS)('draws every heading with the %s run as `V -- NAME`', async (command) => {
		const headings = await headings_of(carried(command))

		expect(headings.length).toBeGreaterThan(1)
		expect(headings.filter((line) => !line.startsWith(RULE_LEAD))).toStrictEqual([])
		expect(headings.some((line) => line.startsWith(`${RULE_LEAD}${command}`))).toBe(true)
	})
})
