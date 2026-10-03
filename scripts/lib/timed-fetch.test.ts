import { afterEach, describe, expect, it, vi } from 'vitest'
import { timed_fetch } from './timed-fetch'
import { FETCH_TIMEOUT_MS } from './timeouts'

const URL = 'https://example.invalid/resource'
const SHORT_TIMEOUT_MS = 20

// A request that never answers on its own: it settles only when its signal aborts.
function hanging_fetch(): ReturnType<typeof vi.fn> {
	return vi.fn(
		async (_url: string, init: RequestInit): Promise<Response> =>
			await new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => {
					const reason: unknown = init.signal?.reason

					reject(reason instanceof Error ? reason : new Error(String(reason)))
				})
			}),
	)
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('timed_fetch', () => {
	it('aborts a request that outlives its time limit', async () => {
		vi.stubGlobal('fetch', hanging_fetch())

		await expect(timed_fetch(URL, {}, SHORT_TIMEOUT_MS)).rejects.toMatchObject({
			name: 'TimeoutError',
		})
	})

	it('passes the request options through with a signal attached', async () => {
		const fetch_spy = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))

		vi.stubGlobal('fetch', fetch_spy)
		await timed_fetch(URL, { method: 'POST', body: 'payload' })
		const [call] = fetch_spy.mock.calls

		expect(call?.[0]).toBe(URL)
		expect(call?.[1]).toMatchObject({ method: 'POST', body: 'payload' })
		expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal)
	})

	it('defaults to the shared fetch time limit', async () => {
		const timeout_spy = vi.spyOn(AbortSignal, 'timeout')

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))
		await timed_fetch(URL)

		expect(timeout_spy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS)
	})
})
