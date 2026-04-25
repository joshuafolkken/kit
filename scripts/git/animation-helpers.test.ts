import { beforeEach, describe, expect, it, vi } from 'vitest'
import { animation_helpers } from './animation-helpers'

const LOADING_MESSAGE = 'loading'
const ORIGINAL_ERROR_MESSAGE = 'original error'
const CUSTOM_ERROR_MESSAGE = 'Custom failure'

const { stop_spy, pause_spy } = vi.hoisted(() => ({
	stop_spy: vi.fn(),
	pause_spy: vi.fn(),
}))

vi.mock('./git-animation', () => ({
	git_animation: {
		create_animation: vi.fn().mockReturnValue({
			stop: stop_spy,
			pause: pause_spy,
		}),
	},
}))

beforeEach(() => {
	stop_spy.mockReset()
	pause_spy.mockReset()
})

describe('animation_helpers.execute_with_animation — success', () => {
	it('calls stop with formatted result when result_formatter is provided', async () => {
		const result = await animation_helpers.execute_with_animation(
			LOADING_MESSAGE,
			async () => await Promise.resolve('hello'),
			{ result_formatter: (value) => value.toUpperCase() },
		)

		expect(result).toBe('hello')
		expect(stop_spy).toHaveBeenCalledWith('HELLO', undefined)
	})

	it('calls stop with String(result) when no formatter', async () => {
		await animation_helpers.execute_with_animation(
			LOADING_MESSAGE,
			async () => await Promise.resolve(42),
		)

		expect(stop_spy).toHaveBeenCalledWith('42', undefined)
	})

	it('calls stop with icon from icon_selector', async () => {
		await animation_helpers.execute_with_animation(
			LOADING_MESSAGE,
			async () => await Promise.resolve('ok'),
			{ icon_selector: () => '🚀' },
		)

		expect(stop_spy).toHaveBeenCalledWith('ok', '🚀')
	})
})

describe('animation_helpers.execute_with_animation — error', () => {
	it('calls stop() and rethrows original Error when no error_message', async () => {
		const original = new Error(ORIGINAL_ERROR_MESSAGE)

		await expect(
			animation_helpers.execute_with_animation(
				LOADING_MESSAGE,
				async () => await Promise.reject(original),
			),
		).rejects.toThrow(ORIGINAL_ERROR_MESSAGE)

		expect(stop_spy).toHaveBeenCalledOnce()
	})

	it('calls stop() and throws with custom error_message when provided', async () => {
		await expect(
			animation_helpers.execute_with_animation(
				LOADING_MESSAGE,
				async () => await Promise.reject(new Error('underlying')),
				{ error_message: CUSTOM_ERROR_MESSAGE },
			),
		).rejects.toThrow(CUSTOM_ERROR_MESSAGE)

		expect(stop_spy).toHaveBeenCalledOnce()
	})
})
