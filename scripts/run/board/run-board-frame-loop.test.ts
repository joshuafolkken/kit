import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_frame_loop, type FramePorts, type FrameRun } from './run-board-frame-loop'
import { run_board_layer, type Layer } from './run-board-layer'

// joshuafolkken/kit#8826: one frame loop composes every layer and writes only what changed, in one
// synchronized write, at the first moment a layer changes.

const { MIN_FRAME_MS, THIN_AFTER_MS, base_layer, revealed, run, screen_of } = run_board_frame_loop
const { boundary_after } = run_board_layer
const { char_id, put } = run_board_cells
const ESC = '\u{1B}'
const SYNC_ON = `${ESC}[?2026h`
const SYNC_OFF = `${ESC}[?2026l`
const CLEAR = `${ESC}[H${ESC}[2J`
const SIZE = { rows: 2, columns: 8 }
const SPIN_MS = 80
const DIGITS = 10
// A whole number of spinner steps, so a second starts on a step.
const START = 1_000_000
const SECOND_MS = 1000
const STALL_MS = 300
// Slower than a theme tick, so the next frame thins.
const SLOW_MS = THIN_AFTER_MS + 10
// Slower than a refresh, within a theme tick.
const BUSY_MS = 30

interface Fake {
	ports: FramePorts
	writes: Array<{ at_ms: number; bytes: string }>
	clock: { now_ms: number }
}

function fake_of(drained?: (clock: { now_ms: number }) => void): Fake {
	const clock = { now_ms: START }
	const writes: Array<{ at_ms: number; bytes: string }> = []
	const ports: FramePorts = {
		now: () => clock.now_ms,
		sleep: async (ms) => {
			clock.now_ms += Math.max(0, ms)
		},
		write: (bytes) => {
			writes.push({ at_ms: clock.now_ms, bytes })
		},
		size: () => SIZE,
		drained: async () => {
			drained?.(clock)
		},
	}

	return { ports, writes, clock }
}

// The digit of the step `at_ms` is on.
function digit_at(at_ms: number, step_ms: number): number {
	const step = Math.floor(at_ms / step_ms) % DIGITS

	return char_id(String(step))
}

// A spinner at `column`: the step count at `at_ms`, each step a digit, on every `step_ms`.
function spinner(step_ms = SPIN_MS, is_decor = false, column = 0): Layer {
	return {
		is_decor,
		next_change_ms: (now_ms) => boundary_after(now_ms, step_ms),
		draw: (canvas, at_ms) => {
			put(canvas, column, digit_at(at_ms, step_ms), 0)
		},
	}
}

function run_of(layers: ReadonlyArray<Layer>, until_ms = START + SECOND_MS): FrameRun {
	return { layers, until_ms, is_still: false }
}

function offsets(fake: Fake): Array<number> {
	return fake.writes.map(({ at_ms }) => at_ms - START)
}

describe('run_board_frame_loop.run — writes', () => {
	it('writes each frame once, in one synchronized block, the first over a cleared screen', async () => {
		const fake = fake_of()

		await run(run_of([spinner()]), fake.ports, screen_of())

		expect(fake.writes.length).toBeGreaterThan(1)

		for (const { bytes } of fake.writes) {
			expect(bytes.startsWith(SYNC_ON) && bytes.endsWith(SYNC_OFF)).toBe(true)
			expect(bytes.split(SYNC_ON)).toHaveLength(2)
		}

		expect(fake.writes[0]?.bytes.startsWith(`${SYNC_ON}${CLEAR}`)).toBe(true)
		expect(fake.writes[1]?.bytes.includes(CLEAR)).toBe(false)
	})

	it('writes nothing for a frame where no cell changed', async () => {
		const fake = fake_of()
		const still: Layer = { ...spinner(MIN_FRAME_MS), draw: () => undefined }

		await run(run_of([still]), fake.ports, screen_of())

		expect(fake.writes).toHaveLength(1)
	})
})

describe('run_board_frame_loop.run — where it writes', () => {
	it('writes through write_drawn where the ports have it', async () => {
		const fake = fake_of()
		const drawn: Array<string> = []

		await run(
			run_of([spinner()]),
			{
				...fake.ports,
				write_drawn: (bytes) => {
					drawn.push(bytes)
				},
			},
			screen_of(),
		)

		expect(fake.writes).toHaveLength(0)
		expect(drawn.length).toBeGreaterThan(1)
	})

	it('writes nothing over a revealed screen whose base is unchanged', async () => {
		const fake = fake_of()
		const screen = screen_of()

		revealed(screen, 'hello', SIZE)
		await run(
			{ layers: [base_layer(screen)], until_ms: START + SECOND_MS, is_still: true },
			fake.ports,
			screen,
		)

		expect(fake.writes).toHaveLength(0)
		expect(fake.clock.now_ms).toBe(START + SECOND_MS)
	})
})

describe('run_board_frame_loop.run — a resized terminal', () => {
	it('clears and rewrites the screen whole when the terminal is another size than its front', async () => {
		const fake = fake_of()
		const screen = screen_of()
		const resized = { rows: SIZE.rows + 1, columns: SIZE.columns }

		revealed(screen, 'hello', SIZE)
		await run(
			{ layers: [base_layer(screen)], until_ms: START + SECOND_MS, is_still: true },
			{ ...fake.ports, size: () => resized },
			screen,
		)

		expect(fake.writes).toHaveLength(1)
		expect(fake.writes[0]?.bytes.startsWith(`${SYNC_ON}${CLEAR}`)).toBe(true)
		expect(fake.writes[0]?.bytes).toContain('hello')
	})
})

describe('run_board_frame_loop.run — wakes', () => {
	it('wakes on each 80 ms spinner step until the second', async () => {
		const fake = fake_of()

		await run(run_of([spinner()]), fake.ports, screen_of())

		expect(offsets(fake)).toStrictEqual(
			Array.from({ length: Math.ceil(SECOND_MS / SPIN_MS) }, (_, step) => step * SPIN_MS),
		)
	})

	it('makes no frame sooner than MIN_FRAME_MS after the last', async () => {
		const fake = fake_of()

		await run(run_of([spinner(1)]), fake.ports, screen_of())
		const gaps = offsets(fake)
			.slice(1)
			.map((at_ms, index) => at_ms - (offsets(fake)[index] ?? 0))

		expect(gaps.length).toBeGreaterThan(0)
		expect(gaps.every((gap) => gap === MIN_FRAME_MS)).toBe(true)
	})

	it('waits for the terminal to drain, then draws one frame at the moment it drained', async () => {
		const stalls = { left: 1 }
		const fake = fake_of((clock) => {
			if (stalls.left === 0) return
			stalls.left -= 1
			clock.now_ms += STALL_MS
		})

		await run(run_of([spinner()]), fake.ports, screen_of())

		expect(offsets(fake).slice(0, 3)).toStrictEqual([0, SPIN_MS + STALL_MS, SPIN_MS * 5])
	})
})

interface Moments {
	spin: Array<number>
	decor: Array<number>
}

// The moments a spinner and a decor layer are drawn at over three steps, the first frame taking
// `compose_ms` to compose.
async function moments_of(compose_ms: number): Promise<Moments> {
	const fake = fake_of()
	const moments: Moments = { spin: [], decor: [] }
	const slow: Layer = {
		...spinner(),
		draw: (_canvas, at_ms) => {
			if (moments.spin.length === 0) fake.clock.now_ms += compose_ms
			moments.spin.push(at_ms - START)
		},
	}
	const decor: Layer = {
		...spinner(SPIN_MS, true),
		draw: (_canvas, at_ms) => {
			moments.decor.push(at_ms - START)
		},
	}

	await run(run_of([slow, decor], START + SPIN_MS * 3), fake.ports, screen_of())

	return moments
}

describe('run_board_frame_loop.run — thinning and moments', () => {
	it('draws the decor at the last moment after a frame slower than a theme tick', async () => {
		const moments = await moments_of(SLOW_MS)

		expect(moments.spin).toStrictEqual([0, SPIN_MS, SPIN_MS * 2])
		expect(moments.decor).toStrictEqual([0, 0, SPIN_MS * 2])
	})

	it('draws the decor at its own moment after a frame slower than a refresh but within a theme tick', async () => {
		const moments = await moments_of(BUSY_MS)

		expect(moments.spin).toStrictEqual([0, SPIN_MS, SPIN_MS * 2])
		expect(moments.decor).toStrictEqual([0, SPIN_MS, SPIN_MS * 2])
	})
})

describe('run_board_frame_loop.run — skipped frames', () => {
	it('shows the same screen at the same moment however many frames were skipped', async () => {
		const smooth = fake_of()
		const stalls = { left: 1 }
		const stalled = fake_of((clock) => {
			if (stalls.left === 0) return
			stalls.left -= 1
			clock.now_ms += STALL_MS
		})
		const screens = [screen_of(), screen_of()]
		const layers = [spinner(), spinner(SPIN_MS * 2, true, 1)]

		await run(run_of(layers), smooth.ports, screens[0] ?? screen_of())
		await run(run_of(layers), stalled.ports, screens[1] ?? screen_of())

		expect(screens[1]?.front).toStrictEqual(screens[0]?.front)
	})
})
