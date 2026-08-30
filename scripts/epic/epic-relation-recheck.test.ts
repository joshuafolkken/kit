import { describe, expect, it, vi } from 'vitest'
import type { EpicChild } from './epic-graph'
import { epic_relation_recheck } from './epic-relation-recheck'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const BLOCKER = 1106
const BLOCKED = 1111
const RATE_LIMITED = 'rate limited'

function reference(issue_number: number): string {
	return `#${String(issue_number)}`
}

// One more child than the recheck will look at, each declared in one chain, so every link in it is a
// mismatch — the shape a body that is legitimately ahead of its relations produces.
function over_limit_numbers(): Array<number> {
	const length = epic_relation_recheck.RECHECK_LIMIT + 2

	return Array.from({ length }, (_, index) => index + 1)
}

function declared_chain(numbers: ReadonlyArray<number>): string {
	return `## Dependencies\n\n${numbers.map((number) => reference(number)).join(' -> ')}\n`
}

const ORDERED_BODY = `## Dependencies\n\n${reference(BLOCKER)} -> ${reference(BLOCKED)}\n`

function child(
	number: number,
	blocked_by: ReadonlyArray<number> = [],
	repo: string = REPO,
): EpicChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [...blocked_by] }
}

function blockers_of(
	children: ReadonlyArray<EpicChild>,
	repo: string,
): ReadonlyArray<number> | undefined {
	return children.find((entry) => entry.number === BLOCKED && entry.repo === repo)?.blocked_by
}

// The state joshuafolkken/kit#1113 was measured in: the body declares `#1106 -> #1111`, the relation
// is recorded on GitHub, and the summary count that the first read trusted says there is none. The
// reader stands in for the listing, which reports it correctly.
const STALE_SUMMARY_CHILDREN: ReadonlyArray<EpicChild> = [child(BLOCKER), child(BLOCKED)]

async function recheck(
	children: ReadonlyArray<EpicChild>,
	body: string | undefined,
	read_blockers: BlockersStub,
): Promise<ReadonlyArray<EpicChild>> {
	return await epic_relation_recheck.recheck_missing_relations(children, body, REPO, read_blockers)
}

type BlockersStub = (child: EpicChild) => Promise<Array<number>>

describe('recheck_missing_relations — when it looks again', () => {
	it('replaces the blockers of a child a declared link says should have one', async () => {
		const read_blockers = vi.fn().mockResolvedValue([BLOCKER])

		const rechecked = await recheck(STALE_SUMMARY_CHILDREN, ORDERED_BODY, read_blockers)

		expect(blockers_of(rechecked, REPO)).toStrictEqual([BLOCKER])
		expect(read_blockers).toHaveBeenCalledTimes(1)
	})

	// joshuafolkken/kit#1024's optimization is what this must not undo. An epic whose relations all
	// match is the ordinary case, and it has to cost exactly what it cost before: nothing.
	it('reads nothing when every declared link is already recorded', async () => {
		const read_blockers = vi.fn().mockResolvedValue([BLOCKER])
		const children = [child(BLOCKER), child(BLOCKED, [BLOCKER])]

		const rechecked = await recheck(children, ORDERED_BODY, read_blockers)

		expect(rechecked).toBe(children)
		expect(read_blockers).not.toHaveBeenCalled()
	})

	it('reads nothing when the body declares no order', async () => {
		const read_blockers = vi.fn().mockResolvedValue([BLOCKER])

		await recheck(STALE_SUMMARY_CHILDREN, undefined, read_blockers)

		expect(read_blockers).not.toHaveBeenCalled()
	})
})

describe('recheck_missing_relations — what it refuses to touch', () => {
	// joshuafolkken/kit#1014: a declared number is bare, so it names the epic's own repository. A
	// child of the same number elsewhere is a different issue, and re-reading it would replace its
	// relations on another issue's account.
	it('leaves a same-numbered child in another repository alone', async () => {
		const read_blockers = vi.fn().mockResolvedValue([BLOCKER])
		const children = [child(BLOCKER), child(BLOCKED), child(BLOCKED, [], OTHER_REPO)]

		const rechecked = await recheck(children, ORDERED_BODY, read_blockers)

		expect(blockers_of(rechecked, OTHER_REPO)).toStrictEqual([])
		expect(read_blockers).toHaveBeenCalledTimes(1)
	})

	// A body legitimately ahead of its relations declares a mismatch for every child, and confirming
	// that one request at a time is a fan-out this check was never for.
	it('reports a whole-graph mismatch unchecked rather than fanning out, and says so', async () => {
		const read_blockers = vi.fn().mockResolvedValue([BLOCKER])
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const numbers = over_limit_numbers()
		const children = numbers.map((number) => child(number))

		await recheck(children, declared_chain(numbers), read_blockers)

		expect(read_blockers).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('declared links are unrecorded'))
		warn.mockRestore()
	})
})

describe('recheck_missing_relations — what the second look does not change', () => {
	// A relation that is genuinely absent stays absent. The mismatch is still reported afterwards —
	// what changed is that the report is about the relations rather than about a counter.
	it('leaves a genuinely unrecorded relation unrecorded', async () => {
		const read_blockers = vi.fn().mockResolvedValue([])

		const rechecked = await recheck(STALE_SUMMARY_CHILDREN, ORDERED_BODY, read_blockers)

		expect(blockers_of(rechecked, REPO)).toStrictEqual([])
	})

	// The second look only ever adds information, so failing to take it must not end the run — but it
	// must say so, or the mismatch that follows is indistinguishable from a real one.
	it('keeps the first read when the listing cannot be read, and warns', async () => {
		const read_blockers = vi.fn().mockRejectedValue(new Error(RATE_LIMITED))
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		const rechecked = await recheck(STALE_SUMMARY_CHILDREN, ORDERED_BODY, read_blockers)

		expect(blockers_of(rechecked, REPO)).toStrictEqual([])
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(RATE_LIMITED))
		warn.mockRestore()
	})
})
