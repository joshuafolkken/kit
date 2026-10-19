import { describe, expect, it } from 'vitest'
import { run_board_keys, type KeyInput } from './run-board-keys'

// joshuafolkken/kit#4172: a live board reads its keys in raw mode, folds a section per key, quits on
// Ctrl-C and puts the terminal back when it leaves.

const { CTRL_C, read_keys } = run_board_keys

interface FakeKeys {
	input: KeyInput
	calls: Array<string>
	type: (chunk: string) => void
}

function fake_keys(is_tty = true): FakeKeys {
	const calls: Array<string> = []
	let on_data: ((chunk: string) => void) | undefined

	const input: KeyInput = {
		is_tty,
		raw: (is_raw) => {
			calls.push(`raw ${String(is_raw)}`)
		},
		listen: (listener) => {
			on_data = listener
		},
		close: () => {
			calls.push('close')
		},
		interrupt: () => {
			calls.push('interrupt')
		},
	}

	return { input, calls, type: (chunk) => on_data?.(chunk) }
}

describe('run_board_keys.read_keys', () => {
	it('reads no key where stdin is not a terminal or there is no keyboard', () => {
		const keys = fake_keys(false)

		expect(read_keys(keys.input).folded).toBeUndefined()
		expect(read_keys(undefined).folded).toBeUndefined()
		expect(keys.calls).toStrictEqual([])
	})

	it('starts every section unfolded and folds the ones typed, in the order typed', () => {
		const keys = fake_keys()
		const reading = read_keys(keys.input)

		expect(keys.calls).toStrictEqual(['raw true'])
		expect(reading.folded?.().size).toBe(0)
		keys.type('qwq')
		expect([...(reading.folded?.() ?? [])]).toStrictEqual(['waiting'])
	})

	it('quits on Ctrl-C, folding nothing, and leaves raw mode once it stops', () => {
		const keys = fake_keys()
		const reading = read_keys(keys.input)

		keys.type(CTRL_C)
		expect(reading.folded?.().size).toBe(0)
		reading.stop?.()
		expect(keys.calls).toStrictEqual(['raw true', 'interrupt', 'raw false', 'close'])
	})
})
