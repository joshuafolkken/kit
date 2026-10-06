import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openai_lane_supervisor_decision as decision } from './openai-lane-supervisor-decision'

// joshuafolkken/kit#3253: the approve / cancel handshake between the OpenAI lane supervisor and its
// owner had no test. The first decision recorded for a nonce is the one that holds; a later,
// different one is refused rather than overwriting it.

// Polling gives up after 200 reads 50ms apart; the clock is advanced past that in one step.
const POLL_WINDOW_MS = 10_050

// A lane directory no real lane uses, so the stamp keyed to it is this test's alone.
function lane(): string {
	return `/nonexistent/lane-${randomUUID()}`
}

const used: Array<[string, string]> = []

function fresh(): [string, string] {
	const pair: [string, string] = [lane(), randomUUID()]

	used.push(pair)

	return pair
}

afterEach(() => {
	vi.useRealTimers()
	for (const [directory, nonce] of used.splice(0)) decision.remove(directory, nonce)
})

describe('openai_lane_supervisor_decision — the first decision holds', () => {
	it('approves a nonce no one has decided', async () => {
		const [directory, nonce] = fresh()

		expect(decision.approve(directory, nonce)).toBe(true)
		expect(await decision.is_approved(directory, nonce)).toBe(true)
	})

	it('answers true again for the same decision', () => {
		const [directory, nonce] = fresh()

		decision.cancel(directory, nonce)

		expect(decision.cancel(directory, nonce)).toBe(true)
	})

	it('refuses a cancel once the nonce is approved', async () => {
		const [directory, nonce] = fresh()

		decision.approve(directory, nonce)

		expect(decision.cancel(directory, nonce)).toBe(false)
		expect(await decision.is_approved(directory, nonce)).toBe(true)
	})

	it('reads a cancelled nonce as not approved', async () => {
		const [directory, nonce] = fresh()

		decision.cancel(directory, nonce)

		expect(await decision.is_approved(directory, nonce)).toBe(false)
	})

	it('accepts a new decision once the old one is removed', () => {
		const [directory, nonce] = fresh()

		decision.approve(directory, nonce)
		decision.remove(directory, nonce)

		expect(decision.cancel(directory, nonce)).toBe(true)
	})
})

describe('openai_lane_supervisor_decision.is_approved — no decision arrives', () => {
	it('gives up as not approved once the polling window passes', async () => {
		vi.useFakeTimers()
		const [directory, nonce] = fresh()
		const pending = decision.is_approved(directory, nonce)

		await vi.advanceTimersByTimeAsync(POLL_WINDOW_MS)

		expect(await pending).toBe(false)
	})

	it('answers with a decision made while it polls', async () => {
		vi.useFakeTimers()
		const [directory, nonce] = fresh()
		const pending = decision.is_approved(directory, nonce)

		decision.approve(directory, nonce)
		await vi.advanceTimersByTimeAsync(POLL_WINDOW_MS)

		expect(await pending).toBe(true)
	})
})
