import { describe, expect, it } from 'vitest'
import { run_board_motion_check_fixture, type MotionFrame } from './run-board-motion-check-fixture'

const { CELL_UNITS, GROWTH_RUN, motion_failures } = run_board_motion_check_fixture
const SYNC_START = '\u{1B}[?2026h'
const SYNC_END = '\u{1B}[?2026l'
const FRAME_MS = 80
const LATE_MS = 40
const LABEL = 'wopr 80x24 idle'
const DUE_MS = [0, FRAME_MS, FRAME_MS * 2]

function synced(body: string): string {
	return `${SYNC_START}${body}${SYNC_END}`
}

// A frame at `at_ms` writing `body` in one synchronized block, changing `changed` cells.
function frame_of(at_ms: number, body = 'x', changed = 1): MotionFrame {
	return { at_ms, writes: [synced(body)], changed }
}

function frames_at(at_ms: ReadonlyArray<number>): Array<MotionFrame> {
	return at_ms.map((at) => frame_of(at))
}

describe('run_board_motion_check.motion_failures — one write a frame', () => {
	it('passes frames each written once in one synchronized block', () => {
		expect(
			motion_failures({ label: LABEL, frames: frames_at(DUE_MS), due_ms: DUE_MS }),
		).toStrictEqual([])
	})

	it('fails a frame written twice, naming its label, frame and rule', () => {
		const frames = frames_at(DUE_MS)

		frames[1] = { at_ms: FRAME_MS, writes: [synced('x'), synced('y')], changed: 2 }

		expect(motion_failures({ label: LABEL, frames, due_ms: DUE_MS })).toStrictEqual([
			`${LABEL} frame 1: one-write — 2 writes`,
		])
	})

	it('fails a frame written outside its synchronized block', () => {
		const frames = frames_at(DUE_MS)

		frames[2] = { at_ms: FRAME_MS * 2, writes: [`${synced('x')}y`], changed: 1 }

		expect(motion_failures({ label: LABEL, frames, due_ms: DUE_MS })).toStrictEqual([
			`${LABEL} frame 2: one-write — written outside one synchronized block`,
		])
	})
})

describe('run_board_motion_check.motion_failures — the cell budget', () => {
	it('passes a frame writing its changed cells at the most a cell may cost', () => {
		const frames = [frame_of(0, 'x'.repeat(CELL_UNITS * 2), 2)]

		expect(motion_failures({ label: LABEL, frames, due_ms: [0] })).toStrictEqual([])
	})

	it('fails a frame rewriting every cell for a few changed ones', () => {
		const frames = [frame_of(0, 'x'.repeat(CELL_UNITS * 10), 2)]

		expect(motion_failures({ label: LABEL, frames, due_ms: [0] })).toStrictEqual([
			`${LABEL} frame 0: cell-budget — 656 units for 2 changed cells, over 144`,
		])
	})
})

// `count` frames, each writing one unit more than the last for the same one changed cell.
function growing(count: number): Array<MotionFrame> {
	return Array.from({ length: count }, (_, index) => frame_of(index, 'x'.repeat(index + 1), 1))
}

function due_of(frames: ReadonlyArray<MotionFrame>): Array<number> {
	return frames.map(({ at_ms }) => at_ms)
}

describe('run_board_motion_check.motion_failures — growth', () => {
	it('passes frames growing for one frame fewer than the run', () => {
		const frames = growing(GROWTH_RUN)

		expect(motion_failures({ label: LABEL, frames, due_ms: due_of(frames) })).toStrictEqual([])
	})

	it('fails the frame a run of growing frames reaches its length at', () => {
		const frames = growing(GROWTH_RUN + 1)

		expect(motion_failures({ label: LABEL, frames, due_ms: due_of(frames) })).toStrictEqual([
			`${LABEL} frame 8: growth — 8 frames each writing more for no more changed cells`,
		])
	})
})

describe('run_board_motion_check.motion_failures — cadence', () => {
	it('passes frames made within one refresh after they were due', () => {
		const frames = frames_at([0, FRAME_MS + 1, FRAME_MS * 2 + 1])

		expect(motion_failures({ label: LABEL, frames, due_ms: DUE_MS })).toStrictEqual([])
	})

	it('fails the first frame a slow terminal made late', () => {
		const frames = frames_at([0, FRAME_MS + LATE_MS, FRAME_MS * 2 + LATE_MS])

		expect(motion_failures({ label: LABEL, frames, due_ms: DUE_MS })).toStrictEqual([
			`${LABEL} frame 1: cadence — made at 120 ms, due at 80 ms`,
		])
	})

	it('fails a frame that was due and never made', () => {
		const frames = frames_at([0, FRAME_MS])

		expect(motion_failures({ label: LABEL, frames, due_ms: DUE_MS })).toStrictEqual([
			`${LABEL} frame 2: cadence — made at none, due at 160 ms`,
		])
	})

	it('counts only the frames that wrote', () => {
		const frames = [frame_of(0), { at_ms: 1, writes: [], changed: 0 }, frame_of(FRAME_MS)]

		expect(motion_failures({ label: LABEL, frames, due_ms: [0, FRAME_MS] })).toStrictEqual([])
	})
})
