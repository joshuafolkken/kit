import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4200: the queued reason counted an earlier run's lanes that hold a place, while
// the lanes section left them out — `next free lane (4/4)` beside one lane row.

const { LOCAL, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { STATE_ICONS, WORDS } = run_board_labels
const REPO = 'joshuafolkken/kit'
const RUNNING = 4195
const QUEUED = 4197
const EARLIER = ['4173', '4187', '4188']
const LANE_LIMIT = 4

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

const PLAN: BoardPlan = {
	waves: { waves: [[child(RUNNING), child(QUEUED)]], unreached: [] },
	tracked: new Map(),
	context: { repo: REPO, titles: new Map(), open_numbers: undefined },
	labels: new Map(),
	declared: new Map(),
}

// This run's one lane and the earlier run's three, every one holding a place under the limit.
const FULL: LocalRead = {
	...LOCAL,
	lanes: [String(RUNNING), ...EARLIER],
	earlier_lanes: EARLIER,
	earlier_occupied: EARLIER,
	free_lanes: 0,
	lane_limit: LANE_LIMIT,
	occupied_count: LANE_LIMIT,
}

// The board's last frame, its plan read as `plans` answers — none read before the plan lands.
async function frame_of(local: LocalRead, plans = [PLAN]): Promise<Array<string>> {
	const { ports, frames } = harness(local, plans)

	await tick(FRESH_STATE, ports)

	return stripVTControlCharacters(frames.at(-1) ?? '').split('\n')
}

// The header, up to its first blank line — the run's counts and its estimate.
function header(lines: ReadonlyArray<string>): Array<string> {
	return lines.slice(0, lines.indexOf(''))
}

// The lanes section: the block after the header — with no usage read, it draws no rule of its own.
function lane_rows(lines: ReadonlyArray<string>): Array<string> {
	const start = lines.indexOf('') + 1

	return lines.slice(start, lines.indexOf('', start))
}

describe('run_board_tick.tick — an earlier run’s lanes holding a place', () => {
	it('draws as many lane rows as the queued reason counts lanes holding a place', async () => {
		const lines = await frame_of(FULL)
		const lanes = `${String(LANE_LIMIT)}/${String(LANE_LIMIT)}`
		// joshuafolkken/kit#4288: the count fills the condition column; a row with no title ends at its
		// number.
		const queued = new RegExp(`^ {2}🧵 ${lanes} +${String(QUEUED)}$`, 'u')

		expect(lines).toContainEqual(expect.stringMatching(queued))
		expect(lane_rows(lines)).toHaveLength(LANE_LIMIT)
	})

	it('marks each earlier run’s row apart, after this run’s own, and names the mark', async () => {
		const lines = await frame_of(FULL)
		const rows = lane_rows(lines)

		expect(rows[0]).toContain(String(RUNNING))
		expect(rows.slice(1).map((row) => row.trim().split(/\s+/u).slice(0, 2))).toStrictEqual(
			EARLIER.map((issue) => [STATE_ICONS.earlier, issue]),
		)
		expect(lines.some((line) => line.includes(`${STATE_ICONS.earlier} ${WORDS.earlier}`))).toBe(
			true,
		)
	})

	it('counts no earlier run’s row among this run’s children', async () => {
		const drawn = await frame_of(FULL)
		const without = await frame_of({ ...FULL, earlier_occupied: [] })

		expect(header(drawn)).toStrictEqual(header(without))
	})

	it('draws the earlier run’s lanes before the plan is read', async () => {
		const lines = await frame_of(FULL, [])
		const row = new RegExp(String.raw`^\s*${STATE_ICONS.earlier} \d`, 'u')

		expect(lines.filter((line) => row.test(line))).toHaveLength(EARLIER.length)
	})
})

describe('run_board_tick.tick — an earlier run’s lanes that are not drawn', () => {
	it('draws a lane this run has touched as this run’s alone', async () => {
		const touched = { ...FULL, earlier_occupied: [String(RUNNING), ...EARLIER] }

		expect(lane_rows(await frame_of(touched))).toStrictEqual(lane_rows(await frame_of(FULL)))
	})

	it('draws no row for an earlier run’s lane that holds no place', async () => {
		const lines = await frame_of({ ...FULL, earlier_occupied: [] })

		expect(lane_rows(lines)).toHaveLength(1)
	})
})
