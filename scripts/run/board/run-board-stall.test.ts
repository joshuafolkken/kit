import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_heap } from './run-board-heap'
import { run_board_live } from './run-board-live'
import { run_board_stall, type StallProbes } from './run-board-stall'
import type { StallStage } from './run-board-state'
import { run_board_timing } from './run-board-timing'

// joshuafolkken/kit#8148: `run:board --timing` records the live board's main-thread stalls past the
// threshold, with the loop's stage and the GC within each, and says them as the board leaves.

const { PROBE_MS, STALL_MS } = run_board_stall
const { STOPPED, harness } = run_board_fixture
const STAGE_MS = 10
const HELD_MS = 1000
const STALL_LENGTH = STAGE_MS + HELD_MS - PROBE_MS
const GC_START = 500
const GC_MS = 30
const GC_SPAN = { start: GC_START, end: GC_START + GC_MS }

interface FakeProbes {
	probes: StallProbes
	clock: { now_ms: number }
	fire: () => void
	gc: (span: { start: number; end: number }) => void
	stops: Array<string>
}

// A stop that notes its name when called.
function stopper(stops: Array<string>, name: string): () => void {
	return () => {
		stops.push(name)
	}
}

// Probes on a clock the test moves, the probe fired and each GC reported by hand.
function fake_probes(): FakeProbes {
	const clock = { now_ms: 0 }
	const handlers: { fire: () => void; gc: FakeProbes['gc'] } = { fire: () => 0, gc: () => 0 }
	const stops: Array<string> = []
	const probes: StallProbes = {
		now: () => clock.now_ms,
		every: (_ms, probe) => {
			handlers.fire = probe

			return stopper(stops, 'probe')
		},
		observe_gc: (seen) => {
			handlers.gc = seen

			return stopper(stops, 'gc')
		},
	}

	return { probes, clock, fire: () => handlers.fire(), gc: (span) => handlers.gc(span), stops }
}

// The first stage left short, then `stage` entered and the thread held through it.
function hold(fake: FakeProbes, enter: (stage: StallStage) => void, stage: StallStage): void {
	fake.clock.now_ms = STAGE_MS
	enter(stage)
	fake.clock.now_ms = STAGE_MS + HELD_MS
}

// A watch that held the thread through its turn stage.
function held_in_turn(): FakeProbes & { watch: ReturnType<typeof run_board_stall.watch> } {
	const fake = fake_probes()
	const watch = run_board_stall.watch(fake.probes)

	hold(fake, watch.enter, 'turn')

	return { ...fake, watch }
}

// A timed live board that took its screen, was held through its turn stage with a GC within, and
// left — its last frame and the stops its watch made.
function left_after_stall(): { frame: string | undefined; stops: Array<string> } {
	const fake = fake_probes()
	const { ports, frames, leaves } = harness(undefined, [])
	// The heaps on a timer of their own, so the probe fired is the stall watch's.
	const heap = { main: run_board_heap.main, every: vi.fn().mockReturnValue(vi.fn()) }
	const board = run_board_timing.timed(ports, true, {
		now: () => 0,
		probes: { ...fake.probes, heap },
	})

	board.on_exit(() => 0)
	hold(fake, (stage) => board.enter_stage?.(stage), 'turn')
	fake.gc(GC_SPAN)
	fake.fire()
	leaves.at(-1)?.()

	return { frame: frames.at(-1), stops: fake.stops }
}

// Fires the probe `late_ms` past its due time.
function fire_late(fake: FakeProbes, late_ms: number): void {
	fake.clock.now_ms += PROBE_MS + late_ms
	fake.fire()
}

// A stage mark that keeps every stage entered.
function marker(stages: Array<StallStage>): (stage: StallStage) => void {
	return (stage) => {
		stages.push(stage)
	}
}

describe('run_board_stall.watch', () => {
	it('records a stall past the threshold with its length and the stage that held it', () => {
		const { fire, watch } = held_in_turn()

		fire()

		expect(watch.stalls()).toStrictEqual([
			expect.objectContaining({ ms: STALL_LENGTH, stage: 'turn', gc_ms: 0 }),
		])
	})

	it('adds a GC within the stall, reported before or after its probe', () => {
		const before = held_in_turn()
		const after = held_in_turn()

		before.gc(GC_SPAN)
		before.fire()
		after.fire()
		after.gc(GC_SPAN)

		expect(before.watch.stalls()[0]?.gc_ms).toBe(GC_MS)
		expect(after.watch.stalls()[0]?.gc_ms).toBe(GC_MS)
	})
})

describe('run_board_stall.watch stage and threshold', () => {
	it('names the stall by the stage that held most of it, not the one current at the probe', () => {
		const fake = fake_probes()
		const watch = run_board_stall.watch(fake.probes)

		hold(fake, watch.enter, 'turn')
		watch.enter('redraw')
		fake.clock.now_ms += PROBE_MS
		fake.fire()

		expect(watch.stalls()).toStrictEqual([expect.objectContaining({ stage: 'turn' })])
	})

	it('records a probe that ran late by exactly the threshold', () => {
		const { probes, clock, fire } = fake_probes()
		const watch = run_board_stall.watch(probes)

		clock.now_ms = PROBE_MS + STALL_MS
		fire()

		expect(watch.stalls()).toStrictEqual([expect.objectContaining({ ms: STALL_MS })])
	})

	it('records no probe that ran late by less than the threshold', () => {
		const { probes, clock, fire } = fake_probes()
		const watch = run_board_stall.watch(probes)

		clock.now_ms = PROBE_MS + STALL_MS - 1
		fire()

		expect(watch.stalls()).toStrictEqual([])
	})
})

// joshuafolkken/kit#8825: each stall says when it began, and every probe's lateness is kept as wake lag.
describe('run_board_stall.watch start and wake lag', () => {
	const SHORT_LAG_MS = 20
	const LONG_LAG_MS = 100

	it('says a stall began when its gap opened, counted from the watch start', () => {
		const fake = fake_probes()
		const watch = run_board_stall.watch(fake.probes)

		fire_late(fake, 0)
		fire_late(fake, STALL_MS)

		expect(watch.stalls()).toStrictEqual([expect.objectContaining({ at_ms: PROBE_MS })])
		expect(watch.rows()[1]?.[1]).toMatch(/ · at 50$/u)
	})

	it('says the wake lag max, median and the wakes later than LATE_MS', () => {
		const fake = fake_probes()
		const watch = run_board_stall.watch(fake.probes)

		fire_late(fake, 0)
		fire_late(fake, LONG_LAG_MS)
		fire_late(fake, SHORT_LAG_MS)

		expect(watch.lags()).toStrictEqual([0, LONG_LAG_MS, SHORT_LAG_MS])
		expect(watch.rows()).toStrictEqual([
			['stalls', `n 0 over ${String(STALL_MS)}`],
			['wake lag', `max 100.0 · median 20.0 · n 1 over ${String(run_board_stall.LATE_MS)} (n 3)`],
		])
	})

	it('says no wake lag before the first probe', () => {
		const { probes } = fake_probes()

		expect(run_board_stall.watch(probes).rows()).toStrictEqual([['stalls', 'n 0 over 200']])
	})
})

describe('run_board_stall.watch stop', () => {
	it('stops its probe and its GC observer', () => {
		const { probes, stops } = fake_probes()

		run_board_stall.watch(probes).stop()

		expect(stops).toStrictEqual(['probe', 'gc'])
	})
})

describe('run_board_timing.timed stalls', () => {
	it('says each stall with its length, stage and GC as the board leaves', () => {
		const { frame, stops } = left_after_stall()

		// The rows are padded to the longest name the report says, the heaps' among them.
		expect(frame).toMatch(new RegExp(`stalls +n 1 over ${String(STALL_MS)}`, 'u'))
		expect(frame).toMatch(
			new RegExp(String.raw`stall 1 +${STALL_LENGTH.toFixed(1)} turn · gc 30\.0 · at 0`, 'u'),
		)
		expect(stops).toStrictEqual(['probe', 'gc'])
	})

	it('watches nothing without the flag, and marks no stage', () => {
		const { probes } = fake_probes()
		const every = vi.spyOn(probes, 'every')
		const observe = vi.spyOn(probes, 'observe_gc')
		const { ports } = harness(undefined, [])
		const board = run_board_timing.timed(ports, false, { now: () => 0, probes })

		board.on_exit(() => 0)

		expect(board.enter_stage).toBeUndefined()
		expect(every).not.toHaveBeenCalled()
		expect(observe).not.toHaveBeenCalled()
	})

	it('watches nothing for a single frame, which never takes a screen', () => {
		const { probes } = fake_probes()
		const every = vi.spyOn(probes, 'every')
		const { ports } = harness(undefined, [])

		run_board_timing.timed(ports, true, { now: () => 0, probes }).enter_stage?.('redraw')

		expect(every).not.toHaveBeenCalled()
	})
})

describe('run_board_live.watch stages', () => {
	it('marks the redraws and the turns between in order', async () => {
		const { ports } = harness(undefined, [])
		const stages: Array<StallStage> = []
		const enter_stage = marker(stages)

		await expect(run_board_live.watch({ ...ports, enter_stage }, undefined)).rejects.toBe(STOPPED)

		expect(stages).toStrictEqual(['redraw', 'turn', 'redraw', 'turn'])
	})
})
