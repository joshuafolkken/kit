import { describe, expect, it, vi } from 'vitest'
import { gh_core_rate_limit } from './gh-core-rate-limit'

// joshuafolkken/kit#6559, #6697: the core REST allowance is read once, unretried, and anything but a
// well-formed answer reads as none.

const { read_core, read_usage } = gh_core_rate_limit
const CORE = '{"limit":5000,"used":679,"remaining":4321,"reset":1793000000}'
const CORE_REQUEST = { path: 'rate_limit', jq_filter: '.resources.core', should_retry: false }

describe('gh_core_rate_limit.read_core', () => {
	it('reads remaining, limit and the reset in milliseconds off the core resource, unretried', async () => {
		const exec = vi.fn(async () => CORE)

		await expect(read_core(exec)).resolves.toEqual({
			remaining: 4321,
			limit: 5000,
			reset_ms: 1_793_000_000_000,
		})
		expect(exec).toHaveBeenCalledWith(CORE_REQUEST)
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
		const misshapen = '{"limit":5000,"used":1,"remaining":"many","reset":1793000000}'

		await expect(read_core(async () => misshapen)).resolves.toBeUndefined()
		await expect(read_core(async () => '{"limit":5000,"reset":1}')).resolves.toBeUndefined()
	})
})

describe('gh_core_rate_limit.read_usage', () => {
	it('reads used and the reset in milliseconds off the same request', async () => {
		const exec = vi.fn(async () => CORE)

		await expect(read_usage(exec)).resolves.toEqual({ used: 679, reset_ms: 1_793_000_000_000 })
		expect(exec).toHaveBeenCalledWith(CORE_REQUEST)
	})

	it('reads none when the request fails or used is missing', async () => {
		const failing = vi.fn(async () => {
			throw new Error('HTTP 502')
		})
		const no_used = '{"limit":5000,"remaining":4321,"reset":1793000000}'

		await expect(read_usage(failing)).resolves.toBeUndefined()
		await expect(read_usage(async () => no_used)).resolves.toBeUndefined()
	})
})
