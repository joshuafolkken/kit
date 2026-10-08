import { stripVTControlCharacters } from 'node:util'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3430: what one redraw reads, and what it draws when a plan read fails or no run has
// started. joshuafolkken/kit#3444: three speeds — a redraw every call, the local reads every few seconds,
// the plan no more often than the retry interval.

const { LOCAL, START, WORDS, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, LOCAL_READ_MS, MACHINE_SAMPLE_MS, PLAN_RETRY_MS, REDRAW_MS, tick } =
	run_board_tick
const SLOW_READ_MS = 2 * MACHINE_SAMPLE_MS
const SWAPPED_MB = 3
const { spinner_of } = run_board_labels

function swapped(swapped_mb: number): MachineSample {
	return {
		cpu: { busy: 0, total: 0 },
		memory: { available_mb: 0, swapped_mb, pressure_level: undefined },
		total_mb: 1,
	}
}

describe('run_board_tick.tick speeds', () => {
	it('redraws on every call while reading the stream only once per local interval', async () => {
		const { ports, frames, read_local, clock } = harness(LOCAL, [plan_titled('a')])
		let state = await tick(FRESH_STATE, ports, WORDS)

		for (let index = 1; index < LOCAL_READ_MS / REDRAW_MS; index += 1) {
			clock.now_ms += REDRAW_MS
			// eslint-disable-next-line no-await-in-loop -- each redraw folds the state the last one left
			state = await tick(state, ports, WORDS)
		}

		expect(frames).toHaveLength(LOCAL_READ_MS / REDRAW_MS)
		expect(read_local).toHaveBeenCalledOnce()
		clock.now_ms += REDRAW_MS
		await tick(state, ports, WORDS)
		expect(read_local).toHaveBeenCalledTimes(2)
	})

	it('moves the elapsed time between local reads', async () => {
		const { ports, frames, clock } = harness(LOCAL, [plan_titled('a')])
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += MACHINE_SAMPLE_MS
		await tick(first, ports, WORDS)

		expect(frames[0]).toContain('⏱ 00:00')
		expect(frames[1]).toContain('⏱ 00:01')
	})

	it('reads the plan at most once per retry interval while redrawing every tick', async () => {
		const { ports, read_plan, clock } = harness(LOCAL, [plan_titled('a'), plan_titled('b')])
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += PLAN_RETRY_MS - 1
		const second = await tick(first, ports, WORDS)

		expect(read_plan).toHaveBeenCalledOnce()
		clock.now_ms += 1
		await tick(second, ports, WORDS)
		expect(read_plan).toHaveBeenCalledTimes(2)
	})
})

// joshuafolkken/kit#3450: a gauge that needs two samples is drawn from the second on.
// joshuafolkken/kit#3452: the machine is sampled once a second while the board redraws four times.
describe('run_board_tick.tick machine', () => {
	it('samples the machine once a second while redrawing every 250 ms', async () => {
		const { ports, frames, read_machine, clock } = harness(LOCAL, [plan_titled('a')])
		let state = await tick(FRESH_STATE, ports, WORDS)

		for (let index = 1; index <= MACHINE_SAMPLE_MS / REDRAW_MS; index += 1) {
			clock.now_ms += REDRAW_MS
			// eslint-disable-next-line no-await-in-loop -- each redraw folds the state the last one left
			state = await tick(state, ports, WORDS)
		}

		expect([REDRAW_MS, MACHINE_SAMPLE_MS, LOCAL_READ_MS]).toStrictEqual([250, 1000, 5000])
		expect(frames).toHaveLength(5)
		expect(read_machine).toHaveBeenCalledTimes(2)
	})

	it('draws the swap rate only once a previous sample exists', async () => {
		const { ports, frames, clock } = harness(LOCAL, [plan_titled('a')])
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += MACHINE_SAMPLE_MS
		await tick(first, ports, WORDS)

		const [first_machine, second_machine] = frames.map((frame) => frame.split('\n', 2)[1] ?? '')

		expect(first_machine).toMatch(/^🧠 /u)
		expect(first_machine).not.toContain('💾')
		expect(second_machine).toContain('💾')
	})

	it('times a sample when it is taken, so a slow plan read does not skew the swap rate', async () => {
		const { ports, frames, read_plan, read_machine, clock } = harness(LOCAL, [])

		read_plan.mockImplementationOnce(async () => {
			clock.now_ms += SLOW_READ_MS

			return plan_titled('a')
		})
		read_machine.mockResolvedValueOnce(swapped(0)).mockResolvedValueOnce(swapped(SWAPPED_MB))
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += MACHINE_SAMPLE_MS
		await tick(first, ports, WORDS)

		expect(frames.at(-1)).toContain(`${SWAPPED_MB.toFixed(1)}M/s`)
	})
})

describe('run_board_tick.tick reads', () => {
	it('keeps the previous plan and warns when a read failed', async () => {
		const { ports, frames, clock } = harness(LOCAL, [plan_titled('kept'), undefined])
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += PLAN_RETRY_MS
		const second = await tick(first, ports, WORDS)

		expect(second.plan?.context.titles.get(1)).toBe('kept')
		expect(second.fetched_ms).toBe(START)
		expect(frames.at(-1)).toContain(`⚠ ${WORDS.plan}`)
	})

	it('draws no run and reads nothing from GitHub when no run has started', async () => {
		const { ports, frames, read_plan } = harness(undefined, [plan_titled('a')])
		const state = await tick(FRESH_STATE, ports, WORDS)

		expect(state.local).toBeUndefined()
		expect(read_plan).not.toHaveBeenCalled()
		expect(frames.at(-1)).toContain(`■ backlogrun  ${WORDS.no_run}`)
	})
})

// joshuafolkken/kit#3439: an ended run stays on screen with its plan held, and the next run starts clean.
const END = START + 60 * 60 * 1000

describe('run_board_tick.tick — an ended run', () => {
	it('draws the ended run as ended and holds its plan once it has read', async () => {
		const { ports, frames, read_plan, clock } = harness({ ...LOCAL, ended_ms: END }, [
			plan_titled('a'),
		])
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += PLAN_RETRY_MS
		await tick(first, ports, WORDS)

		expect(read_plan).toHaveBeenCalledOnce()
		expect(frames.at(-1)).toContain('🔚')
	})

	it('drops the ended run’s plan and baseline the moment the next run begins', async () => {
		const ended = harness({ ...LOCAL, ended_ms: END }, [plan_titled('old')])
		const held = await tick(FRESH_STATE, ended.ports, WORDS)
		const next = harness({ ...LOCAL, started_ms: END + 1 }, [undefined])

		next.clock.now_ms += LOCAL_READ_MS
		const state = await tick(held, next.ports, WORDS)

		expect(next.read_plan).toHaveBeenCalledOnce()
		expect(state.plan).toBeUndefined()
		expect(state.baseline_total).toBeUndefined()
		expect(state.run_started_ms).toBe(END + 1)
	})
})

// joshuafolkken/kit#3442: the plan is the run's own scope, a lane outside it is not the run's child, and
// a child the plan's listing no longer holds is not left running.
const SINGLE = 3441
const STALE_LANE = '3347'
const ONLY_SINGLE: NamedPlan = { issues: [SINGLE], only: true }
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#3441 x' }
const LAUNCHED = { ...LOCAL, scope: ONLY_SINGLE, events: [LAUNCH] }

function single_plan(open: ReadonlyArray<number>): BoardPlan {
	const child: EpicChild = { number: SINGLE, repo: 'r', state: 'OPEN', labels: [], blocked_by: [] }

	return {
		waves: { waves: [[child]], unreached: [] },
		tracked: new Map(),
		context: { repo: 'r', titles: new Map(), open_numbers: new Set(open) },
		labels: new Map(),
	}
}

describe('run_board_tick.tick — the run’s own scope', () => {
	it('reads the carry’s scope and counts only its one issue, not a stale lane', async () => {
		const local = { ...LOCAL, scope: ONLY_SINGLE, lanes: [STALE_LANE, String(SINGLE)] }
		const { ports, frames, read_plan } = harness(local, [single_plan([SINGLE])])

		await tick(FRESH_STATE, ports, WORDS)

		expect(read_plan).toHaveBeenCalledWith(ONLY_SINGLE)
		expect(frames.at(-1)).toContain(' 0/1 ')
		expect(frames.at(-1)).not.toContain(STALE_LANE)
	})

	it('settles a launched child the open listing no longer holds', async () => {
		const { ports, frames } = harness(LAUNCHED, [single_plan([])])

		await tick(FRESH_STATE, ports, WORDS)

		expect(frames.at(-1)).toContain(' 1/1 ')
	})
})

// joshuafolkken/kit#3452: the spinner turns by the clock on a terminal, and stands still elsewhere.
describe('run_board_tick.tick spinner', () => {
	it('advances the spinner frame on each redraw of a running run', async () => {
		const { ports, frames, clock } = harness(LAUNCHED, [single_plan([SINGLE])])
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += REDRAW_MS
		await tick(first, ports, WORDS)

		const titles = frames.map((frame) => stripVTControlCharacters(frame).split('\n', 1)[0])

		expect(titles[0]).toMatch(new RegExp(`^${spinner_of(START)} backlogrun`, 'u'))
		expect(titles[1]).toMatch(new RegExp(`^${spinner_of(START + REDRAW_MS)} backlogrun`, 'u'))
		expect(titles[0]).not.toBe(titles[1])
	})

	it('draws ▶ and 🔄 where the output is not a terminal', async () => {
		const { ports, frames } = harness(LAUNCHED, [single_plan([SINGLE])])

		await tick(FRESH_STATE, { ...ports, is_tty: false }, WORDS)

		const frame = stripVTControlCharacters(frames.at(-1) ?? '')

		expect(frame).toMatch(/^▶ backlogrun/u)
		expect(frame).toContain(`🔄 ${String(SINGLE)}`)
	})
})
