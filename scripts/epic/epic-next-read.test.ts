import { afterEach, describe, expect, it, vi } from 'vitest'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import type { EpicChild } from './epic-graph'
import { epic_next } from './epic-next'
import { epic_next_read } from './epic-next-read'

// joshuafolkken/kit#1493: `epic:next` reads several epics, so one read became a walk — and a walk has
// answers a single read did not. What is pinned here is which of them stops the command and which
// only removes one epic from it.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const THIRD_PARTY_REPO = 'sveltejs/kit'
const FIRST_EPIC = 858
const SECOND_EPIC = 909
const FIRST_CHILD = 861
const FAILURE_EXIT_CODE = 1

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [] }
}

function snapshot(children: ReadonlyArray<EpicChild>): EpicSnapshot {
	return {
		body: undefined,
		repo: REPO,
		current_repo: REPO,
		children,
		child_numbers: children.map((entry) => entry.number),
		unreadable: [],
		skipped: [],
		has_external_children: false,
		body_failure: undefined,
		is_unreachable: false,
	}
}

// An epic whose own body read never reached GitHub: no children parsed, and a recorded reason why.
function unread_body_snapshot(): EpicSnapshot {
	return {
		...snapshot([]),
		body_failure: { kind: 'unreadable', reason: 'unreachable', status: undefined },
		is_unreachable: true,
	}
}

// The epic each call is for, keyed by number, so a walk over two references is one mock.
function fetch_returning(by_number: Readonly<Record<number, EpicSnapshot>>): void {
	vi.spyOn(epic_fetch, 'fetch_epic').mockImplementation(async (number: number) => {
		await Promise.resolve()

		return by_number[number] ?? snapshot([])
	})
}

afterEach(() => {
	vi.restoreAllMocks()
})

// The same epic named twice is one epic. Left to `dedupe_pools` the duplicate would already have
// been fetched, and an unattended run pays that fetch every polling round.
describe('epic_next_read.unique_references', () => {
	it('drops a repeated bare reference', () => {
		const unique = epic_next_read.unique_references(
			[{ number: FIRST_EPIC }, { number: FIRST_EPIC }],
			REPO,
		)

		expect(unique).toEqual([{ number: FIRST_EPIC }])
	})

	// A bare reference means the repository the command runs in, so the qualified spelling of the same
	// epic is the same epic — recognized through `epic_graph.key_of` rather than by string equality.
	it('recognizes the qualified spelling of a bare reference', () => {
		const unique = epic_next_read.unique_references(
			[{ number: FIRST_EPIC }, { repo: REPO, number: FIRST_EPIC }],
			REPO,
		)

		expect(unique).toHaveLength(1)
	})

	it('keeps the same number in two repositories', () => {
		const unique = epic_next_read.unique_references(
			[{ number: FIRST_EPIC }, { repo: OTHER_REPO, number: FIRST_EPIC }],
			REPO,
		)

		expect(unique).toHaveLength(2)
	})

	it('keeps two different epics in the order they were named', () => {
		const unique = epic_next_read.unique_references(
			[{ number: SECOND_EPIC }, { number: FIRST_EPIC }],
			REPO,
		)

		expect(unique.map((entry) => entry.number)).toEqual([SECOND_EPIC, FIRST_EPIC])
	})
})

describe('epic_next_read.read_snapshots', () => {
	it('reads every named epic', async () => {
		fetch_returning({ [FIRST_EPIC]: snapshot([child(FIRST_CHILD)]) })

		const result = await epic_next_read.read_snapshots(
			[{ number: FIRST_EPIC }, { number: SECOND_EPIC }],
			REPO,
		)

		expect(result.reads.map((entry) => entry.reference.number)).toEqual([FIRST_EPIC])
		expect(result.notices).toHaveLength(1)
	})

	// The whole point of skipping rather than refusing: an `epic:plan` epic whose task list is not
	// filled in yet must not stop the other named epic's children being offered.
	it('skips a childless epic rather than refusing the walk', async () => {
		fetch_returning({ [SECOND_EPIC]: snapshot([child(FIRST_CHILD)]) })

		const result = await epic_next_read.read_snapshots(
			[{ number: FIRST_EPIC }, { number: SECOND_EPIC }],
			REPO,
		)

		expect(result.refusal).toBeUndefined()
		expect(result.reads.map((entry) => entry.reference.number)).toEqual([SECOND_EPIC])
	})

	it('names the skipped epic', async () => {
		fetch_returning({})

		const result = await epic_next_read.read_snapshots([{ number: FIRST_EPIC }], REPO)

		expect(result.notices.join('\n')).toContain(`#${String(FIRST_EPIC)}`)
	})

	// A reference naming another owner's tracker is a read we must not make at all, so it stops the
	// walk before that repository is asked anything — which is why the reads stay serial.
	it('refuses an epic belonging to another owner, and asks it nothing', async () => {
		const fetch_epic = vi.spyOn(epic_fetch, 'fetch_epic')

		const result = await epic_next_read.read_snapshots(
			[{ repo: THIRD_PARTY_REPO, number: FIRST_EPIC }, { number: SECOND_EPIC }],
			REPO,
		)

		expect(result.refusal).toBe(epic_next_read.FOREIGN_EPIC)
		expect(fetch_epic).not.toHaveBeenCalled()
	})
})

// What the command then does with that walk: a skipped epic is a note beside work that survived, and
// the same note is the refusal when nothing did.
describe('epic_next.refuse_reads', () => {
	it('lets the run continue when at least one epic was read', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const reads = [{ reference: { number: SECOND_EPIC }, snapshot: snapshot([child(FIRST_CHILD)]) }]

		expect(epic_next.refuse_reads({ reads, notices: ['skipped'] })).toBeUndefined()
		expect(errors).toHaveBeenCalledWith('skipped')
	})

	// Exactly the line a single childless epic printed before several epics were allowed.
	it('makes the notices the refusal when no epic survived', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const notice = epic_next_read.childless({ number: FIRST_EPIC })

		expect(epic_next.refuse_reads({ reads: [], notices: [notice] })).toBe(FAILURE_EXIT_CODE)
		expect(errors).toHaveBeenCalledWith(notice)
	})

	it('reports a refusal ahead of anything that was skipped', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const walk = { reads: [], notices: ['skipped'], refusal: epic_next_read.FOREIGN_EPIC }

		expect(epic_next.refuse_reads(walk)).toBe(FAILURE_EXIT_CODE)
		expect(errors).toHaveBeenCalledWith(epic_next_read.FOREIGN_EPIC)
		expect(errors).not.toHaveBeenCalledWith('skipped')
	})
})

// joshuafolkken/kit#1690: an epic whose body could not be read parses to zero children exactly as an
// unpopulated one does. Skipped as childless it leaves no anomaly anywhere, so the run reports the
// backlog empty over one request that never left the machine.
describe('epic_next_read.read_snapshots — an epic body that could not be read', () => {
	it('keeps the epic rather than calling it childless', async () => {
		fetch_returning({ [FIRST_EPIC]: unread_body_snapshot() })

		const result = await epic_next_read.read_snapshots([{ number: FIRST_EPIC }], REPO)

		expect(result.notices).toEqual([])
		expect(result.reads.map((entry) => entry.reference.number)).toEqual([FIRST_EPIC])
	})

	it('still calls an epic with a readable but empty body childless', async () => {
		fetch_returning({ [FIRST_EPIC]: snapshot([]) })

		const result = await epic_next_read.read_snapshots([{ number: FIRST_EPIC }], REPO)

		expect(result.reads).toEqual([])
		expect(result.notices).toHaveLength(1)
	})
})
