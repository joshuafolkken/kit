// The theme host's noise (joshuafolkken/kit#8917): a number in [0, 1) that three integers fix, so a
// theme draws the same frame for the same tick with no random source. The confirmed theme demo's
// formula, kept bit for bit so a ported theme reproduces the demo's frames.

/* eslint-disable no-bitwise -- the demo's hash is defined over 32-bit integer operations; arithmetic would change every value */

const PRIME_A = 374_761_393
const PRIME_B = 668_265_263
const PRIME_C = 2_246_822_519
const PRIME_MIX = 1_274_126_177
const SHIFT_MIX = 13
const SHIFT_LAST = 16
const UINT32_RANGE = 4_294_967_296

// `Math.imul` takes each argument to a 32-bit integer itself, as the demo's `a | 0` did.
function hash(first: number, second = 0, third = 0): number {
	const sum = Math.imul(first, PRIME_A) + Math.imul(second, PRIME_B) + Math.imul(third, PRIME_C)
	const mixed = Math.imul(sum ^ (sum >>> SHIFT_MIX), PRIME_MIX)

	return ((mixed ^ (mixed >>> SHIFT_LAST)) >>> 0) / UINT32_RANGE
}

const run_board_theme_host_hash = { hash }

export { run_board_theme_host_hash }
