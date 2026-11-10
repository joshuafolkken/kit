import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_core_rate_limit } from './gh-core-rate-limit'

// joshuafolkken/kit#6559, #6697: the core REST allowance is read once, unretried, and anything but a
// well-formed answer reads as none.

const { read_core, read_resources, read_usage } = gh_core_rate_limit
const CORE = '{"limit":5000,"used":679,"remaining":4321,"reset":1793000000}'
const CORE_REQUEST = { path: 'rate_limit', jq_filter: '.resources.core', should_retry: false }
const GRAPHQL = '{"limit":5000,"used":48,"remaining":4952,"reset":1793000420}'
const RESOURCES_REQUEST = {
	path: 'rate_limit',
	jq_filter: '.resources | {core, graphql}',
	should_retry: false,
}
const CORE_LIMIT = { remaining: 4321, limit: 5000, reset_ms: 1_793_000_000_000 }

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

// joshuafolkken/kit#6822: the GraphQL allowance comes off the same reply, with its own limit and reset.
describe('gh_core_rate_limit.read_resources', () => {
	it('reads the core and graphql allowances apart off one unretried request', async () => {
		const exec = vi.fn(async () => `{"core":${CORE},"graphql":${GRAPHQL}}`)

		await expect(read_resources(exec)).resolves.toStrictEqual({
			core: CORE_LIMIT,
			graphql: { remaining: 4952, limit: 5000, reset_ms: 1_793_000_420_000 },
		})
		expect(exec).toHaveBeenCalledOnce()
		expect(exec).toHaveBeenCalledWith(RESOURCES_REQUEST)
	})

	it('reads the core alone when graphql is missing or misshapen', async () => {
		const missing = `{"core":${CORE},"graphql":null}`
		const misshapen = `{"core":${CORE},"graphql":{"limit":5000}}`
		const expected = { core: CORE_LIMIT, graphql: undefined }

		await expect(read_resources(async () => missing)).resolves.toStrictEqual(expected)
		await expect(read_resources(async () => misshapen)).resolves.toStrictEqual(expected)
	})

	it('reads none when the core is misshapen or the request fails', async () => {
		const failing = vi.fn(async () => {
			throw new Error('HTTP 502')
		})

		await expect(read_resources(async () => `{"core":null,"graphql":${GRAPHQL}}`)).resolves.toBe(
			undefined,
		)
		await expect(read_resources(failing)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#7150: a counted read is answered again for a short while, a failed one never.
describe('gh_core_rate_limit kept reads', () => {
	const FRESH_MS = 30_000
	const NOW_MS = 1_800_000_000_000

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('reads the core once while it is fresh, and again once it is not', async () => {
		const exec = vi.fn(async () => CORE)

		await read_core(exec)
		vi.setSystemTime(NOW_MS + FRESH_MS - 1)
		await expect(read_core(exec)).resolves.toEqual(CORE_LIMIT)
		expect(exec).toHaveBeenCalledOnce()

		vi.setSystemTime(NOW_MS + FRESH_MS)
		await read_core(exec)
		expect(exec).toHaveBeenCalledTimes(2)
	})

	it('reads the resources once while they are fresh', async () => {
		const exec = vi.fn(async () => `{"core":${CORE},"graphql":${GRAPHQL}}`)

		await read_resources(exec)
		await read_resources(exec)
		expect(exec).toHaveBeenCalledOnce()
	})

	it('asks again after a failed read', async () => {
		const exec = vi.fn(async () => CORE).mockRejectedValueOnce(new Error('HTTP 502'))

		await expect(read_core(exec)).resolves.toBeUndefined()
		await expect(read_core(exec)).resolves.toEqual(CORE_LIMIT)
		expect(exec).toHaveBeenCalledTimes(2)
	})
})

describe('gh_core_rate_limit.read_usage', () => {
	it('never keeps the uncounted reading, which measures the calls between two reads', async () => {
		const exec = vi.fn(async () => CORE)

		await read_usage(exec)
		await read_usage(exec)
		expect(exec).toHaveBeenCalledTimes(2)
	})

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
