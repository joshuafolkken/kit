import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardStore } from './run-board-fold-store'
import type { KeyInput } from './run-board-keys'
import { run_board_sound_option } from './run-board-sound-option'
import type { BoardPorts } from './run-board-state'

// joshuafolkken/kit#8915: `--sound on|off` sets one launch's sound and never writes the saved switch.

const { LOCAL, harness } = run_board_fixture
const { split, sounded } = run_board_sound_option

interface Recorded {
	store: BoardStore
	sound_saves: Array<boolean>
	fold_saves: number
}

function recorded(): Recorded {
	const record: Recorded = {
		sound_saves: [],
		fold_saves: 0,
		store: {
			load: () => new Set(['lanes']),
			save: () => {
				record.fold_saves += 1
			},
			load_sound: () => true,
			save_sound: (is_on) => {
				record.sound_saves.push(is_on)
			},
		},
	}

	return record
}

function keyed(store: BoardStore): BoardPorts {
	const { ports } = harness(LOCAL, [])

	return {
		...ports,
		cue: () => undefined,
		keys: {
			is_tty: true,
			raw: () => undefined,
			listen: () => undefined,
			close: () => undefined,
			interrupt: () => undefined,
			store,
		},
	}
}

// The store the launch's sound holds over `record`'s.
function held_store(record: Recorded, is_on: boolean): NonNullable<KeyInput['store']> {
	const store = sounded(keyed(record.store), is_on).keys?.store

	if (store === undefined) throw new Error('the held ports carry no store')

	return store
}

describe('run_board_sound_option.split', () => {
	it.each([
		['off', false],
		['on', true],
	])('reads --sound %s and leaves the other arguments', (value, is_on) => {
		expect(split(['--once', '--sound', value])).toStrictEqual({ is_on, argv: ['--once'] })
	})

	it('leaves the saved switch deciding where no flag is given', () => {
		expect(split(['--once'])).toStrictEqual({ is_on: undefined, argv: ['--once'] })
	})

	it.each([[['--sound', 'loud']], [['--sound']]])('refuses %j', (argv) => {
		expect(split(argv)).toBeUndefined()
	})
})

describe('run_board_sound_option.sounded', () => {
	it('keeps the ports as they are where no flag is given', () => {
		const ports = keyed(recorded().store)

		expect(sounded(ports, undefined)).toBe(ports)
	})

	it.each([true, false])('reads %s as the switch and never saves it', (is_on) => {
		const record = recorded()
		const store = held_store(record, is_on)

		store.save_sound?.(!is_on)
		expect(store.load_sound?.()).toBe(is_on)
		expect(record.sound_saves).toStrictEqual([])
	})

	it('passes the folds through to the saved store', () => {
		const record = recorded()
		const store = held_store(record, false)

		store.save(new Set())
		expect(store.load()).toStrictEqual(new Set(['lanes']))
		expect(record.fold_saves).toBe(1)
	})

	it('drops the cue player and the trill when off, and keeps them when on', () => {
		const ports = keyed(recorded().store)

		expect(sounded(ports, false).cue).toBeUndefined()
		expect(sounded(ports, false).typing_sound).toBeUndefined()
		expect(sounded(ports, true).cue).toBe(ports.cue)
	})

	it('adds no keys to ports that read none', () => {
		const { ports } = harness(LOCAL, [])

		expect(sounded({ ...ports, keys: undefined }, false).keys).toBeUndefined()
	})
})
