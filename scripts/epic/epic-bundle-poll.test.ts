import { describe, expect, it, vi } from 'vitest'
import { epic_bundle_poll } from './epic-bundle-poll'

// joshuafolkken/kit#3332: `issue:file` runs `epic:bundle` on the issue it has just filed, and the open
// listing did not show it yet on every filing of one run — so the placement answered "not an open
// issue" each time. What these cases pin is that a fresh issue is looked for again until it appears.

const FRESH = 3332
const OTHER = 1
const POLL = { attempts: 3, interval_ms: 0, sleeper: vi.fn(async () => undefined) }

interface Listing {
	is_readable: boolean
	issues: Array<{ number: number }>
}

function listing(...numbers: ReadonlyArray<number>): Listing {
	return { is_readable: true, issues: numbers.map((number) => ({ number })) }
}

const UNREADABLE: Listing = { is_readable: false, issues: [] }

function reader(...answers: ReadonlyArray<Listing>): () => Promise<Listing> {
	const read = vi.fn<() => Promise<Listing>>()

	for (const answer of answers) read.mockResolvedValueOnce(answer)

	return read
}

describe('epic_bundle_poll.read_until_listed', () => {
	it('answers from the read that shows the issue after an earlier one did not', async () => {
		const read = reader(listing(OTHER), listing(OTHER, FRESH))

		expect(await epic_bundle_poll.read_until_listed(read, FRESH, POLL)).toEqual(
			listing(OTHER, FRESH),
		)
		expect(read).toHaveBeenCalledTimes(2)
	})

	it('reads once when no poll is given, as a number typed at the command line is', async () => {
		const read = reader(listing(OTHER), listing(OTHER, FRESH))

		expect(await epic_bundle_poll.read_until_listed(read, FRESH)).toEqual(listing(OTHER))
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('stops at an unreadable listing, which reading again would not change', async () => {
		const read = reader(UNREADABLE, listing(FRESH))

		expect(await epic_bundle_poll.read_until_listed(read, FRESH, POLL)).toEqual(UNREADABLE)
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('hands back the last read when the issue never appears', async () => {
		const read = reader(listing(OTHER), listing(OTHER), listing(OTHER, OTHER))

		expect(await epic_bundle_poll.read_until_listed(read, FRESH, POLL)).toEqual(
			listing(OTHER, OTHER),
		)
		expect(read).toHaveBeenCalledTimes(POLL.attempts)
	})
})
