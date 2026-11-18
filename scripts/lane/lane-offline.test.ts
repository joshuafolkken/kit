import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#7867: the per-tick reachability probe, recorded only when its answer changes.

const fetch_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lib/timed-fetch', () => ({ timed_fetch: fetch_mock }))

const { lane_offline } = await import('./lane-offline')
const { run_event_stream } = await import('#scripts/run/event/run-event-stream')

const scratch = temporary_directory('suite')('lane-offline-test-')

function fresh_stream(): string {
	return path.join(scratch, `${randomUUID()}.jsonl`)
}

function kinds(events_path: string): Array<string> {
	return run_event_stream.read_events(events_path).map((event) => event.kind)
}

// Answers the probe with `answers` in turn: true is a response, false a dropped connection.
function answer(...answers: Array<boolean>): void {
	for (const is_up of answers) {
		if (is_up) fetch_mock.mockResolvedValueOnce(new Response())
		else fetch_mock.mockRejectedValueOnce(new TypeError('fetch failed'))
	}
}

beforeEach(() => {
	fetch_mock.mockReset().mockResolvedValue(new Response())
})

describe('lane_offline.reachable', () => {
	it('reads any answer as up and a failed request as down', async () => {
		answer(true, false)

		expect(await lane_offline.reachable()).toBe(true)
		expect(await lane_offline.reachable()).toBe(false)
	})

	it('sends no credentials, headers or body', async () => {
		await lane_offline.reachable()

		const [url, init] = fetch_mock.mock.calls[0] ?? []

		expect(url).toBe(lane_offline.PROBE_URL)
		expect(init).toStrictEqual({ method: 'HEAD', credentials: 'omit', redirect: 'manual' })
	})
})

describe('lane_offline.watcher', () => {
	it('writes each change once and a sighting for each tick still down', async () => {
		const events_path = fresh_stream()
		const check = lane_offline.watcher(events_path)

		answer(true, false, false, true, true)
		await check()
		await check()
		await check()
		await check()
		await check()

		expect(kinds(events_path)).toStrictEqual(['offline', 'offline-tick', 'online'])
	})

	it('closes an outage a previous drive left open', async () => {
		const events_path = fresh_stream()

		answer(false)
		await lane_offline.watcher(events_path)()
		await lane_offline.watcher(events_path)()

		expect(kinds(events_path)).toStrictEqual(['offline', 'online'])
	})

	it('never throws when the event cannot be written', async () => {
		answer(false)

		// A directory stands where the stream file should be, so the append fails.
		await expect(lane_offline.watcher(scratch)()).resolves.toBeUndefined()
	})
})
