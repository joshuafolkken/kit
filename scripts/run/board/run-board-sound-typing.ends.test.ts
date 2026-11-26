import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
	run_board_sound_typing,
	type TypingPorts,
	type TypingSound,
} from './run-board-sound-typing'

// joshuafolkken/kit#8523: a trill switched on with the time its letters still type stops itself then,
// without waiting for the next `set(false)`.

const { typing_sound } = run_board_sound_typing
const LEFT_MS = 300
const LATER_MS = 200

interface Sounding {
	sound: TypingSound
	start: Mock<TypingPorts['start']>
	kill: Mock<() => unknown>
}

function sounding(): Sounding {
	const kill = vi.fn<() => unknown>()
	const start = vi.fn<TypingPorts['start']>((_file, handlers) => {
		handlers.started({ on: () => undefined, unref: () => undefined, kill })
	})

	return { sound: typing_sound({ file: () => 'teletype.wav', start }), start, kill }
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('run_board_sound_typing.typing_sound letters end', () => {
	it('stops the trill once its letters type through, with no further set', () => {
		const test = sounding()

		test.sound.set(true, LEFT_MS)
		vi.advanceTimersByTime(LEFT_MS - 1)
		expect(test.kill).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(test.kill).toHaveBeenCalledOnce()
	})

	it('neither restarts nor stops the trill while each set moves the end later', () => {
		const test = sounding()

		test.sound.set(true, LEFT_MS)
		vi.advanceTimersByTime(LATER_MS)
		test.sound.set(true, LEFT_MS)
		vi.advanceTimersByTime(LATER_MS)
		test.sound.set(true, LEFT_MS)
		vi.advanceTimersByTime(LEFT_MS - 1)

		expect(test.start).toHaveBeenCalledOnce()
		expect(test.kill).not.toHaveBeenCalled()
	})
})

describe('run_board_sound_typing.typing_sound letters end, switched apart', () => {
	it('does nothing when the end passes after an off', () => {
		const test = sounding()

		test.sound.set(true, LEFT_MS)
		test.sound.set(false)
		test.sound.set(true)
		vi.advanceTimersByTime(LEFT_MS)

		expect(test.kill).toHaveBeenCalledOnce()
		expect(test.start).toHaveBeenCalledTimes(2)
	})

	it('does nothing when the end passes after the board stops the trill', () => {
		const test = sounding()

		test.sound.set(true, LEFT_MS)
		test.sound.stop()
		expect(vi.getTimerCount()).toBe(0)
		vi.advanceTimersByTime(LEFT_MS)

		expect(test.kill).toHaveBeenCalledOnce()
	})

	it('sounds an on given no end until it is switched off', () => {
		const test = sounding()

		test.sound.set(true)
		vi.runAllTimers()

		expect(test.kill).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#8697: the typed-end sound follows a loop that runs out, never one switched off.
describe('run_board_sound_typing.typing_sound letters end, the typed end', () => {
	it('tells `ended` once when the letters type through', () => {
		const test = sounding()
		const ended = vi.fn<() => void>()

		test.sound.set(true, LEFT_MS, ended)
		vi.advanceTimersByTime(LATER_MS)
		test.sound.set(true, LEFT_MS, ended)
		vi.advanceTimersByTime(LEFT_MS - 1)
		expect(ended).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		test.sound.set(false, 0, ended)

		expect(ended).toHaveBeenCalledOnce()
	})

	it('does not tell `ended` when switched off before the letters type through', () => {
		const test = sounding()
		const ended = vi.fn<() => void>()

		test.sound.set(true, LEFT_MS, ended)
		test.sound.set(false, 0, ended)
		vi.runAllTimers()

		expect(ended).not.toHaveBeenCalled()
	})
})

describe('run_board_sound_typing.typing_sound letters end, the typed end by the clock', () => {
	// A spin turn may switch the trill off just after the letters' end, before the late timer fires.
	it('tells `ended` once when an off arrives after the letters type through, before the timer', () => {
		const test = sounding()
		const ended = vi.fn<() => void>()

		test.sound.set(true, LEFT_MS, ended)
		vi.setSystemTime(Date.now() + LEFT_MS)
		test.sound.set(false, 0, ended)
		vi.runAllTimers()

		expect(ended).toHaveBeenCalledOnce()
	})

	it('does not tell `ended` once the board stops the trill', () => {
		const test = sounding()
		const ended = vi.fn<() => void>()

		test.sound.set(true, LEFT_MS, ended)
		test.sound.stop()
		vi.runAllTimers()

		expect(ended).not.toHaveBeenCalled()
	})
})
