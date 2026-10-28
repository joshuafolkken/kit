import {
	RETRY_PENDING_KEY,
	RETRY_PENDING_VALUE,
	UNREADABLE_COMMENTS_STOP,
} from '#scripts/gh/git-gh-comments-unreadable'
import { describe, expect, it, vi } from 'vitest'
import type { ShipSection } from './run-ship'
import { run_ship_infra_retry, type RetryHooks } from './run-ship-infra-retry'

// joshuafolkken/kit#3998: a stage that stopped on the infrastructure runs again in place, at most
// `MAX_INFRA_RETRIES` times; any other stop returns at once.

const { MAX_INFRA_RETRIES, RETRY_DELAY_MS, retried } = run_ship_infra_retry
const HEADER = 'followup'
const RATE_LIMITED: ShipSection = { header: HEADER, body: 'Review rate limit exceeded', code: 1 }
const RED: ShipSection = { header: HEADER, body: 'CI / test failed', code: 1 }
const GREEN: ShipSection = { header: HEADER, body: 'merged', code: 0 }

function hooks(): RetryHooks & { waits: Array<number>; notes: Array<string> } {
	const waits: Array<number> = []
	const notes: Array<string> = []

	return {
		waits,
		notes,
		wait: async (milliseconds) => {
			waits.push(milliseconds)
		},
		note: (text) => {
			notes.push(text)
		},
	}
}

function attempts(...sections: Array<ShipSection>): () => Promise<ShipSection> {
	const queue = [...sections]

	return vi.fn(async () => queue.shift() ?? GREEN)
}

describe('run_ship_infra_retry.retried', () => {
	it('returns a green stage after one run', async () => {
		const attempt = attempts(GREEN)

		await expect(retried('followup', attempt, hooks())).resolves.toBe(GREEN)
		expect(attempt).toHaveBeenCalledTimes(1)
	})

	it('re-runs a stage the infrastructure stopped until it passes', async () => {
		const recorded = hooks()
		const attempt = attempts(RATE_LIMITED, GREEN)

		await expect(retried('followup', attempt, recorded)).resolves.toBe(GREEN)
		expect(attempt).toHaveBeenCalledTimes(2)
		expect(recorded.waits).toStrictEqual([RETRY_DELAY_MS])
		expect(recorded.notes).toStrictEqual([
			`josh ship: followup stopped on the infrastructure — retry 1/${String(MAX_INFRA_RETRIES)}`,
		])
	})

	it('stops on the infrastructure once the retries run out', async () => {
		const attempt = attempts(RATE_LIMITED, RATE_LIMITED, RATE_LIMITED, GREEN)

		await expect(retried('followup', attempt, hooks())).resolves.toBe(RATE_LIMITED)
		expect(attempt).toHaveBeenCalledTimes(MAX_INFRA_RETRIES + 1)
	})

	it('never re-runs a red check', async () => {
		const recorded = hooks()
		const attempt = attempts(RED, GREEN)

		await expect(retried('followup', attempt, recorded)).resolves.toBe(RED)
		expect(attempt).toHaveBeenCalledTimes(1)
		expect(recorded.waits).toStrictEqual([])
	})

	it('never re-runs a review, whatever its findings name', async () => {
		const attempt = attempts({ ...RATE_LIMITED, header: 'review' }, GREEN)

		await retried('review', attempt, hooks())
		expect(attempt).toHaveBeenCalledTimes(1)
	})
})

// joshuafolkken/kit#5012: one comment read that failed stopped the ship as a check and relaunched the
// lane, though a second read passed.
describe('run_ship_infra_retry.retried — an unreadable comment listing', () => {
	const REASON = 'gh api timed out after 30s'
	const STOPPED = `⚠️ ${UNREADABLE_COMMENTS_STOP}`
	const UNREADABLE: ShipSection = {
		header: HEADER,
		body: `${STOPPED}\n⚠ pull request comments could not be read for 4983-lane: ${REASON}`,
		out: STOPPED,
		code: 1,
	}

	it('re-runs a followup whose comment read failed once, and passes', async () => {
		const attempt = attempts(UNREADABLE, GREEN)

		await expect(retried('followup', attempt, hooks())).resolves.toBe(GREEN)
		expect(attempt).toHaveBeenCalledTimes(2)
	})

	it('marks a retry pending on every attempt but the final one', async () => {
		const pending: Array<string | undefined> = []
		const queue = [UNREADABLE, UNREADABLE, UNREADABLE]
		const attempt = vi.fn(async () => {
			pending.push(process.env[RETRY_PENDING_KEY])

			return queue.shift() ?? GREEN
		})

		await retried('followup', attempt, hooks())
		expect(pending).toStrictEqual([RETRY_PENDING_VALUE, RETRY_PENDING_VALUE, undefined])
		expect(process.env[RETRY_PENDING_KEY]).toBeUndefined()
	})

	it('stops with gh reason once the read keeps failing', async () => {
		const attempt = attempts(UNREADABLE, UNREADABLE, UNREADABLE, GREEN)
		const section = await retried('followup', attempt, hooks())

		expect(section.body).toContain(REASON)
		expect(attempt).toHaveBeenCalledTimes(MAX_INFRA_RETRIES + 1)
	})
})

// joshuafolkken/kit#4431: a reviewer that did not finish is the infrastructure, yet never re-run.
describe('run_ship_infra_retry.retried — a review round tagged infra', () => {
	it('never re-runs a review its reviewer did not finish', async () => {
		const attempt = attempts({ ...RATE_LIMITED, header: 'review', cause: 'infra' }, GREEN)

		await retried('review', attempt, hooks())
		expect(attempt).toHaveBeenCalledTimes(1)
	})
})
