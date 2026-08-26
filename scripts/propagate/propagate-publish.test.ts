import { describe, expect, it, vi } from 'vitest'
import { propagate_publish } from './propagate-publish'

const ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const TARGET = '1.111.0'
const NEWER = '1.112.0'
const OLDER = '1.110.0'

async function no_sleep(): Promise<void> {
	// The wait's delay is what makes it a wait; the suite drives the clock instead.
}

// A clock that advances by `step_ms` on every read, so a loop that keeps probing reaches the timeout
// rather than running forever.
function stepping_clock(step_ms: number): () => number {
	const state = { now: 0 }

	return () => {
		state.now += step_ms

		return state.now
	}
}

describe('propagate_publish.is_version_published', () => {
	it('recognizes the exact version', () => {
		expect(propagate_publish.is_version_published([OLDER, TARGET], TARGET)).toBe(true)
	})

	it('is not satisfied by a newer release', () => {
		expect(propagate_publish.is_version_published([OLDER, NEWER], TARGET)).toBe(false)
	})

	it('is not satisfied by an empty registry', () => {
		expect(propagate_publish.is_version_published([], TARGET)).toBe(false)
	})
})

describe('propagate_publish.wait_for_publish', () => {
	it('returns as soon as the target version appears', async () => {
		const fetch_versions = vi.fn().mockReturnValue([TARGET])
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions,
			sleep: no_sleep,
		})

		expect(result.state).toBe('published')
		expect(result.attempts).toBe(1)
	})

	it('keeps probing while only older releases are there', async () => {
		const fetch_versions = vi
			.fn()
			.mockReturnValueOnce([OLDER])
			.mockReturnValueOnce([OLDER])
			.mockReturnValue([OLDER, TARGET])
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions,
			sleep: no_sleep,
			now: stepping_clock(1),
			timeout_ms: 1000,
		})

		expect(result.state).toBe('published')
		expect(result.attempts).toBe(3)
	})
})

describe('propagate_publish.wait_for_publish — when it must not proceed', () => {
	it('gives up rather than waiting forever when the publish never lands', async () => {
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions: () => [OLDER],
			sleep: no_sleep,
			now: stepping_clock(10),
			timeout_ms: 50,
		})

		expect(result.state).toBe('timed_out')
	})

	it('reports an unreadable registry apart from a publish that has not landed', async () => {
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions: () => undefined,
			sleep: no_sleep,
			now: stepping_clock(1),
			timeout_ms: 1000,
		})

		expect(result.state).toBe('unreadable')
	})

	it('carries the version it was waiting for into the result', async () => {
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions: () => [TARGET],
			sleep: no_sleep,
		})

		expect(result.version).toBe(TARGET)
	})
})

describe('propagate_publish.should_keep_waiting', () => {
	it('keeps waiting before the deadline', () => {
		expect(propagate_publish.should_keep_waiting(10, 100)).toBe(true)
	})

	it('stops at the deadline', () => {
		expect(propagate_publish.should_keep_waiting(100, 100)).toBe(false)
	})
})

// A ten-minute wait that ends seconds in, on one rate-limit response, is not a wait at all.
describe('propagate_publish.wait_for_publish — a transient registry error is not a broken one', () => {
	it('keeps waiting through a single failed probe', async () => {
		const fetch_versions = vi.fn().mockReturnValueOnce(undefined).mockReturnValue([TARGET])
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions,
			sleep: no_sleep,
			now: stepping_clock(1),
			timeout_ms: 1000,
		})

		expect(result.state).toBe('published')
	})

	it('resets the streak once a probe answers', async () => {
		const fetch_versions = vi
			.fn()
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce([OLDER])
			.mockReturnValueOnce(undefined)
			.mockReturnValue([TARGET])
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions,
			sleep: no_sleep,
			now: stepping_clock(1),
			timeout_ms: 1000,
		})

		expect(result.state).toBe('published')
	})
})

describe('propagate_publish.wait_for_publish — a registry that keeps failing', () => {
	it('calls the registry unreadable once probes keep failing in a row', async () => {
		const result = await propagate_publish.wait_for_publish(ENDPOINT, TARGET, {
			fetch_versions: () => undefined,
			sleep: no_sleep,
			now: stepping_clock(1),
			timeout_ms: 1000,
		})

		expect(result.state).toBe('unreadable')
		expect(result.attempts).toBe(propagate_publish.UNREADABLE_THRESHOLD)
	})
})
