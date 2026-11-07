import { describe, expect, it, vi } from 'vitest'
import { run_board_rate_limit } from './run-board-rate-limit'

// joshuafolkken/kit#6559: the core REST allowance is read once, unretried, and anything but a
// well-formed answer reads as none.

const { read_core } = run_board_rate_limit
const CORE = '{"limit":5000,"used":679,"remaining":4321,"reset":1793000000}'

describe('run_board_rate_limit.read_core', () => {
	it('reads remaining, limit and the reset in milliseconds off the core resource, unretried', async () => {
		const exec = vi.fn(async () => CORE)

		await expect(read_core(exec)).resolves.toEqual({
			remaining: 4321,
			limit: 5000,
			reset_ms: 1_793_000_000_000,
		})
		expect(exec).toHaveBeenCalledWith({
			path: 'rate_limit',
			jq_filter: '.resources.core',
			should_retry: false,
		})
	})

	it('reads none when the request fails', async () => {
		const exec = vi.fn(async () => {
			throw new Error('HTTP 502')
		})

		await expect(read_core(exec)).resolves.toBeUndefined()
	})

	it('reads none when the answer is not JSON', async () => {
		await expect(read_core(async () => 'gh: not found')).resolves.toBeUndefined()
	})

	it('reads none when a field is missing or misshapen', async () => {
		const misshapen = '{"limit":5000,"remaining":"many","reset":1793000000}'

		await expect(read_core(async () => misshapen)).resolves.toBeUndefined()
		await expect(read_core(async () => '{"limit":5000,"reset":1}')).resolves.toBeUndefined()
	})
})
