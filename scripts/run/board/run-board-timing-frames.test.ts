import { launch_timing } from '#scripts/lane/launch-timing'
import { beforeEach, describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_timing } from './run-board-timing'
import { run_board_timing_frames } from './run-board-timing-frames'

// joshuafolkken/kit#8917: `run:board --timing` says each live frame's compose time and written bytes,
// their max and average over the frames drawn while the board was up.

const { harness } = run_board_fixture
const { BYTES_ROW, COMPOSE_ROW, framed, fresh, rows, stop, watch } = run_board_timing_frames
// More frames than `Math.max` takes as spread arguments: a board timed for hours draws this many.
const MANY_FRAMES = 300_000

beforeEach(() => {
	launch_timing.clear()
	stop()
})

describe('run_board_timing_frames.rows', () => {
	it('says the compose time to a tenth of a ms and the bytes, each its max and average', () => {
		const stats = watch()

		framed(1.25, 3000)
		framed(2, 0)
		framed(0.5, 1001)

		expect(rows(stats)).toStrictEqual([
			[COMPOSE_ROW, 'max 2.0 · average 1.3 (n 3)'],
			[BYTES_ROW, 'max 3000 B · average 1334 B (n 3)'],
		])
	})

	it('says nothing where no frame was drawn', () => {
		expect(rows(fresh())).toStrictEqual([])
	})

	it('says the max and average of a long run, keeping no frame', () => {
		const stats = watch()

		for (let frame = 0; frame < MANY_FRAMES; frame += 1) framed(frame === 0 ? 9 : 1, 1)

		expect(rows(stats)[0]?.[1]).toBe(`max 9.0 · average 1.0 (n ${String(MANY_FRAMES)})`)
		expect(stats.compose_ms).toStrictEqual({ sum: MANY_FRAMES + 8, most: 9 })
	})
})

describe('run_board_timing_frames.framed', () => {
	it('collects only while watched', () => {
		framed(1, 1)
		const stats = watch()

		framed(2, 20)
		stop()
		framed(3, 30)

		expect(stats).toStrictEqual({
			count: 1,
			compose_ms: { sum: 2, most: 2 },
			bytes: { sum: 20, most: 20 },
		})
	})
})

describe('run_board_timing.timed frame rows', () => {
	it('prints the frames drawn while the live board was up as it leaves', () => {
		const { ports, frames, leaves } = harness(undefined, [])
		const board = run_board_timing.timed(ports, true, { now: () => 0 })

		board.on_exit(() => 0)
		framed(4, 2048)
		framed(1, 0)
		leaves.at(-1)?.()
		framed(9, 9999)

		expect(frames.at(-1)).toMatch(/frame compose {2,}max 4\.0 · average 2\.5 \(n 2\)/u)
		expect(frames.at(-1)).toMatch(/frame bytes {2,}max 2048 B · average 1024 B \(n 2\)/u)
	})

	it('prints no frame rows where the live board drew no frame', () => {
		const { ports, frames, leaves } = harness(undefined, [])
		const board = run_board_timing.timed(ports, true, { now: () => 0 })

		board.on_exit(() => 0)
		leaves.at(-1)?.()

		expect(frames.at(-1)).not.toContain(COMPOSE_ROW)
	})
})
