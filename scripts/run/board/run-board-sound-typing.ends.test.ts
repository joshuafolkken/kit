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
		vi.advanceTimersByTime(LEFT_MS)

		expect(test.kill).toHaveBeenCalledOnce()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('sounds an on given no end until it is switched off', () => {
		const test = sounding()

		test.sound.set(true)
		vi.runAllTimers()

		expect(test.kill).not.toHaveBeenCalled()
	})
})
