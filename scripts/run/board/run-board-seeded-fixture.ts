// A seeded random source for replaying the board's animations (joshuafolkken/kit#8750): mulberry32,
// a 32-bit generator whose sequence one seed fixes, so a demo and a test drawing under one seed draw
// from one sequence.

// A random source in [0, 1).
type Random = () => number

/* eslint-disable no-bitwise -- mulberry32 is defined over 32-bit integer operations; arithmetic would change the sequence */

const MIX_STEP = 0x6d_2b_79_f5
const SHIFT_FIRST = 15
const SHIFT_SECOND = 7
const SHIFT_LAST = 14
const MULTIPLIER = 61
const UINT32_RANGE = 4_294_967_296

function next_value(state: number): number {
	let mixed = Math.imul(state ^ (state >>> SHIFT_FIRST), state | 1)

	mixed ^= mixed + Math.imul(mixed ^ (mixed >>> SHIFT_SECOND), mixed | MULTIPLIER)

	return ((mixed ^ (mixed >>> SHIFT_LAST)) >>> 0) / UINT32_RANGE
}

// A random source in [0, 1) whose sequence the seed fixes.
function seeded(seed: number): Random {
	let state = seed >>> 0

	return function random(): number {
		state = (state + MIX_STEP) >>> 0

		return next_value(state)
	}
}

const run_board_seeded = { seeded }

export { run_board_seeded }
export type { Random }
