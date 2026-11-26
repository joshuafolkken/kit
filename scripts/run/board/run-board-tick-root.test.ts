import { stripVTControlCharacters } from 'node:util'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#7524: a single run in the root checkout beside a running `backlogrun` keeps the
// `backlogrun` frame and adds its `🏠` row above the lanes, counted as no lane.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { LANES_ICON, PHASE_ICONS, STATE_ICONS, WORDS } = run_board_labels
const KIND = run_event_stream.EVENT_KIND
const ROOT = 7521
const LANE = 7530
const LANE_LIMIT = 6
const RUN_MS = 1_500_000
const AT = new Date(START).toISOString()

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

// One lane of the `backlogrun` running, under a limit of six.
const CARRIED: LocalRead = {
	...LOCAL,
	events: [event(KIND.CHILD_LAUNCH, `#${String(LANE)} fullrun`)],
	lanes: [String(LANE)],
	occupied_count: 1,
	lane_limit: LANE_LIMIT,
	free_lanes: LANE_LIMIT - 1,
}

// A single run of `command` on `issue`, launched and in its implement phase.
function implementing(command: string, issue: number): NonNullable<LocalRead['singles']>[number] {
	return {
		command,
		issue,
		events: [
			event(KIND.CHILD_LAUNCH, `#${String(issue)} ${command}`),
			event(KIND.LANE_PHASE, `#${String(issue)} implement`),
		],
	}
}

const ROOTED: LocalRead = { ...CARRIED, singles: [implementing('fullrun', ROOT)] }
const OTHER = 7522
// joshuafolkken/kit#8993: a root checkout's single run and a lane worktree's, both read.
const TWO_SINGLES: LocalRead = {
	...CARRIED,
	singles: [implementing('fullrun', ROOT), implementing('halfrun', OTHER)],
}

async function frame_of(local: LocalRead): Promise<Array<string>> {
	const { ports, frames } = harness(local, [])

	await tick(FRESH_STATE, ports)

	return stripVTControlCharacters(frames.at(-1) ?? '').split('\n')
}

// The header, up to its first blank line — the run's counts, 🔄 among them.
function header(lines: ReadonlyArray<string>): Array<string> {
	return lines.slice(0, lines.indexOf(''))
}

function index_of(lines: ReadonlyArray<string>, text: string): number {
	return lines.findIndex((line) => line.includes(text))
}

describe('run_board_tick.tick — a root single run beside a backlogrun', () => {
	it('draws the 🏠 runs rule and the run’s row with its command and phase above the lanes rule', async () => {
		const lines = await frame_of(ROOTED)
		const home = index_of(lines, '🏠 runs')
		const lanes = index_of(lines, `${LANES_ICON} lanes`)

		expect(home).toBeGreaterThan(-1)
		expect(lanes).toBeGreaterThan(home)
		expect(lines[home + 1]).toContain(String(ROOT))
		expect(lines[home + 1]).toContain('fullrun')
		expect(lines[home + 1]).toContain(PHASE_ICONS.implement)
	})

	// The legend, the frame's last two lines, also names the root run's phase.
	it('keeps the board’s own header and lane rows', async () => {
		const lines = await frame_of(ROOTED)
		const plain = await frame_of(CARRIED)

		expect(lines[0]).toBe(plain[0])
		expect(lines[0]).toContain('josh-board')
		expect(lines.slice(index_of(lines, `${LANES_ICON} lanes`), -2)).toStrictEqual(
			plain.slice(index_of(plain, `${LANES_ICON} lanes`), -2),
		)
	})

	it('counts the root run in neither the lanes nor the header’s running children', async () => {
		const lines = await frame_of(ROOTED)
		const plain = await frame_of(CARRIED)
		const lanes = `${LANES_ICON} lanes 1/${String(LANE_LIMIT)}`

		expect(lines.some((line) => line.includes(lanes))).toBe(true)
		expect(header(lines)).toStrictEqual(header(plain))
		expect(header(lines).join('\n')).toContain(STATE_ICONS.running)
	})
})

describe('run_board_tick.tick — the root single run’s legend and absence', () => {
	it('names the root run’s phase in the legend', async () => {
		const lines = await frame_of(ROOTED)

		expect(lines.at(-2)).toContain(`${PHASE_ICONS.implement} ${WORDS.implement}`)
	})

	it('draws no 🏠 rule without a root run', async () => {
		const lines = await frame_of(CARRIED)

		expect(lines.some((line) => line.includes('🏠'))).toBe(false)
	})
})

describe('run_board_tick.tick — several single runs beside a backlogrun', () => {
	it('draws one 🏠 runs rule with a row per run, each naming its command', async () => {
		const lines = await frame_of(TWO_SINGLES)
		const home = index_of(lines, '🏠 runs')
		const rows = lines.slice(home + 1, index_of(lines, `${LANES_ICON} lanes`))

		expect(lines.filter((line) => line.includes('🏠'))).toHaveLength(1)
		expect(rows.find((row) => row.includes(String(ROOT)))).toContain('fullrun')
		expect(rows.find((row) => row.includes(String(OTHER)))).toContain('halfrun')
	})

	it('counts the single runs in neither the lanes nor the header’s running children', async () => {
		const lines = await frame_of(TWO_SINGLES)
		const plain = await frame_of(CARRIED)

		expect(lines.some((line) => line.includes(`${LANES_ICON} lanes 1/${String(LANE_LIMIT)}`))).toBe(
			true,
		)
		expect(header(lines)).toStrictEqual(header(plain))
	})
})

// joshuafolkken/kit#7710: a `halfrun` or `prrun` a stop ended keeps its 🏠 row, led by ✅, with no phase
// and its time fixed at the stop, counted as no lane.
function stopped_root(command: string): LocalRead {
	const stopped = { command, issue: ROOT, started_ms: START, ended_ms: START + RUN_MS }
	const launch = event(KIND.CHILD_LAUNCH, `#${String(ROOT)} ${command}`)

	return { ...CARRIED, singles: [{ command, issue: ROOT, events: [launch], stopped }] }
}

describe('run_board_tick.tick — a root single run a stop ended', () => {
	it.each(['halfrun', 'prrun'])(
		'keeps the 🏠 runs row of %s, led by ✅ with its fixed time',
		async (name) => {
			const lines = await frame_of(stopped_root(name))
			const row = lines[index_of(lines, '🏠 runs') + 1] ?? ''

			expect(row.trimStart().startsWith(`${STATE_ICONS.merged} `)).toBe(true)
			expect(row).toContain(name)
			expect(row).toContain(String(ROOT))
			expect(row).toContain('25′00″')
			expect(row).not.toContain(STATE_ICONS.stopped)
		},
	)

	it('counts the stopped run in neither the lanes nor the header’s running children', async () => {
		const lines = await frame_of(stopped_root('halfrun'))
		const plain = await frame_of(CARRIED)

		expect(lines.some((line) => line.includes(`${LANES_ICON} lanes 1/${String(LANE_LIMIT)}`))).toBe(
			true,
		)
		expect(header(lines)).toStrictEqual(header(plain))
	})
})

describe('run_board_tick.tick — a single run’s own board a stop ended', () => {
	const STOPPED_SINGLE: LocalRead = {
		...LOCAL,
		ended_ms: START + RUN_MS,
		run_name: 'halfrun',
		events: [event(KIND.CHILD_LAUNCH, `#${String(ROOT)} halfrun`)],
		stopped_single: {
			command: 'halfrun',
			issue: ROOT,
			started_ms: START,
			ended_ms: START + RUN_MS,
		},
	}

	it('draws its row under 🏠 runs, led by ✅ with its fixed time', async () => {
		const lines = await frame_of(STOPPED_SINGLE)
		const home = index_of(lines, '🏠 runs')
		const row = lines[home + 1] ?? ''

		expect(home).toBeGreaterThan(-1)
		expect(row.trimStart().startsWith(`${STATE_ICONS.merged} `)).toBe(true)
		expect(row).toContain(String(ROOT))
		expect(row).toContain('25′00″')
		expect(lines.some((line) => line.includes(STATE_ICONS.stopped))).toBe(false)
	})
})

// joshuafolkken/kit#7525: a root single run a merge ended leaves 🏠 and joins ✅ done as a lane does.
const ENDED: LocalRead = {
	...CARRIED,
	ended_roots: [{ command: 'fullrun', issue: ROOT, started_ms: START, ended_ms: START + RUN_MS }],
}

describe('run_board_tick.tick — a root single run that merged', () => {
	it('lists the run under ✅ done with its merged mark and time, and no 🏠 rule', async () => {
		const lines = await frame_of(ENDED)
		const done = index_of(lines, `${STATE_ICONS.merged} done`)
		const row = lines[done + 1] ?? ''

		expect(done).toBeGreaterThan(-1)
		expect(row).toContain(`${STATE_ICONS.merged} `)
		expect(row).toContain(String(ROOT))
		expect(row).toContain('25′00″')
		expect(lines.some((line) => line.includes('🏠'))).toBe(false)
	})
})
