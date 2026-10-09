import { FETCH_TIMEOUT_MS } from './timeouts'

// **The one place in `scripts/` that calls the global `fetch`**. Every request
// carries a time limit, so a stalled connection rejects instead of holding an unattended run forever;
// `timed-fetch-usage.test.ts` refuses a direct `fetch` call anywhere else. The signal also bounds the
// body read, because the response stream aborts with it.
async function timed_fetch(
	url: string,
	init: Omit<RequestInit, 'signal'> = {},
	timeout_ms: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
	return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout_ms) })
}

export { timed_fetch }
