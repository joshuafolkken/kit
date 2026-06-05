import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_animation } from './git-animation'

const { spinner_spy } = vi.hoisted(() => {
	const spy = {
		start: vi.fn(),
		stop: vi.fn(),
		stopAndPersist: vi.fn(),
	}

	spy.start.mockReturnValue(spy)

	return { spinner_spy: spy }
})

vi.mock('ora', () => ({
	default: vi.fn(() => spinner_spy),
}))

const LOADING = 'loading'
const DONE = 'done'
const ROCKET = '🚀'
const PERSISTED_TEXT = `${LOADING} ${DONE}`

beforeEach(() => {
	vi.clearAllMocks()
	spinner_spy.start.mockReturnValue(spinner_spy)
})

describe('git_animation.create_animation', () => {
	it('starts an ora spinner with the message', () => {
		git_animation.create_animation(LOADING)

		expect(spinner_spy.start).toHaveBeenCalledOnce()
	})

	it('returns a controller exposing stop and pause', () => {
		const controller = git_animation.create_animation(LOADING)

		expect(typeof controller.stop).toBe('function')
		expect(typeof controller.pause).toBe('function')
	})
})

describe('git_animation controller.stop', () => {
	it('persists the result line with the success icon by default', () => {
		const controller = git_animation.create_animation(LOADING)

		controller.stop(DONE)

		expect(spinner_spy.stopAndPersist).toHaveBeenCalledWith({
			symbol: '✅',
			text: PERSISTED_TEXT,
		})
	})

	it('persists the result line with a custom icon when provided', () => {
		const controller = git_animation.create_animation(LOADING)

		controller.stop(DONE, ROCKET)

		expect(spinner_spy.stopAndPersist).toHaveBeenCalledWith({
			symbol: ROCKET,
			text: PERSISTED_TEXT,
		})
	})

	it('stops without persisting when no result is given', () => {
		const controller = git_animation.create_animation(LOADING)

		controller.stop()

		expect(spinner_spy.stop).toHaveBeenCalledOnce()
		expect(spinner_spy.stopAndPersist).not.toHaveBeenCalled()
	})
})

describe('git_animation controller.pause', () => {
	it('stops the spinner so subsequent output is not interleaved', () => {
		const controller = git_animation.create_animation(LOADING)

		controller.pause()

		expect(spinner_spy.stop).toHaveBeenCalledOnce()
	})
})
