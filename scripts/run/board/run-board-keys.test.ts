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

// joshuafolkken/kit#7213: the folds are kept across launches through the keyboard's store.
describe('run_board_keys.read_keys store', () => {
	it('starts from the stored folds and saves each fold that changes them', () => {
		const keys = fake_keys()
		const saved: Array<Array<string>> = []
		const reading = read_keys({
			...keys.input,
			store: {
				load: () => new Set(['usage']),
				save: (folded) => {
					saved.push([...folded])
				},
			},
		})

		expect([...(reading.folded?.() ?? [])]).toStrictEqual(['usage'])
		keys.type('q')
		keys.type('x')
		keys.type('u')
		expect(saved).toStrictEqual([['usage', 'queued'], ['queued']])
	})

	it('neither loads nor saves where stdin is not a terminal', () => {
		const calls: Array<string> = []
		const store = {
			load: (): ReadonlySet<never> => {
				calls.push('load')

				return new Set()
			},
			save: () => {
				calls.push('save')
			},
		}

		read_keys({ ...fake_keys(false).input, store })
		expect(calls).toStrictEqual([])
	})
})

// joshuafolkken/kit#7927: the key that skips the intro is spent on it, neither folding nor saving.
describe('run_board_keys.read_keys intercept', () => {
	it('hands intercepted keys to the taker, not the folds, until released', () => {
		const keys = fake_keys()
		const saved: Array<Array<string>> = []
		const taken: Array<string> = []
		const reading = read_keys({
			...keys.input,
			store: {
				load: () => new Set(),
				save: (folded) => {
					saved.push([...folded])
				},
			},
		})
		const release = reading.intercept?.(() => {
			taken.push('key')
		})

		keys.type('q')
		keys.type(CTRL_C)
		release?.()
		keys.type('q')
		expect([taken, saved, keys.calls]).toStrictEqual([
			['key'],
			[['queued']],
			['raw true', 'interrupt'],
		])
	})
})

// joshuafolkken/kit#7953: `s` flips the sound, saving each flip; switching it on plays launch once, and
// while it is off the board's cue plays nothing.
interface SoundRig {
	keys: FakeKeys
	saved: Array<boolean>
	played: Array<string>
	reading: ReturnType<typeof read_keys>
}

function sound_rig(is_on: boolean): SoundRig {
	const keys = fake_keys()
	const saved: Array<boolean> = []
	const played: Array<string> = []
	const store = {
		load: (): ReadonlySet<never> => new Set(),
		save: () => undefined,
		load_sound: () => is_on,
		save_sound: (next: boolean) => {
			saved.push(next)
		},
	}
	const reading = read_keys({ ...keys.input, store }, (name) => {
		played.push(name)
	})

	return { keys, saved, played, reading }
}

describe('run_board_keys.read_keys sound', () => {
	it('flips on → off → on with s, saving each flip and folding nothing', () => {
		const { keys, saved, reading } = sound_rig(true)

		keys.type('s')
		expect(reading.sound?.()).toBe(false)
		keys.type('s')
		expect([reading.sound?.(), saved, reading.folded?.().size]).toStrictEqual([
			true,
			[false, true],
			0,
		])
	})

	it('plays launch once at the moment the sound is switched on', () => {
		const { keys, played } = sound_rig(false)

		keys.type('s')
		expect(played).toStrictEqual(['launch'])
	})

	it('plays no cue while the sound is off, and the cue passed on while it is on', () => {
		const { keys, played, reading } = sound_rig(true)

		reading.cue?.('drain')
		keys.type('s')
		reading.cue?.('alert')
		expect(played).toStrictEqual(['drain'])
	})
})
