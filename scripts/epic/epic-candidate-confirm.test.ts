import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { epic_candidate_confirm, type ConfirmContext } from './epic-candidate-confirm'
import { epic_classify } from './epic-classify'
import type { EpicChild, IssueReference } from './epic-graph'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'

interface ChildOptions {
	state?: 'OPEN' | 'CLOSED'
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
	repo?: string
}

const CHILD_DEFAULTS = { repo: REPO, state: 'OPEN', labels: [] } as const

function child(number: number, options: ChildOptions = {}): EpicChild {
	const { blocked_by = [], ...rest } = options
	const repo = options.repo ?? REPO

	return {
		...CHILD_DEFAULTS,
		...rest,
		number,
		blocked_by: blocked_by.map((blocker) => ({ repo, number: blocker })),
	}
}

// What the relations listing answers for each child. A number the map does not name has no
// relations, which is what an issue whose zero summary is honest looks like.
type Listing = ReadonlyMap<number, ReadonlyArray<number>>
type Reader = Mock<(candidate: EpicChild) => Promise<Array<IssueReference>>>

function reader(listing: Listing): Reader {
	return vi.fn(async (candidate: EpicChild) =>
		(listing.get(candidate.number) ?? []).map((blocker) => ({
			repo: candidate.repo,
			number: blocker,
		})),
	)
}

function context(
	children: ReadonlyArray<EpicChild>,
	listing: Listing = new Map(),
): ConfirmContext & { read_blockers: Reader } {
	return { children, resolve: epic_classify.resolve_by_state, read_blockers: reader(listing) }
}

// The candidates `epic_report.candidates_for_repo` would hand over, picked by number.
function bundle(
	children: ReadonlyArray<EpicChild>,
	numbers: ReadonlyArray<number>,
): Array<EpicChild> {
	return children.filter((entry) => numbers.includes(entry.number))
}

describe('epic_candidate_confirm.answer_for_repo — a stale zero summary', () => {
	it('withholds a candidate whose listing names an open blocker the summary missed', async () => {
		const children = [child(1, { labels: [IN_PROGRESS_LABEL] }), child(2)]
		const answer = await epic_candidate_confirm.answer_for_repo(
			bundle(children, [2]),
			context(children, new Map([[2, [1]]])),
		)

		expect(answer.child).toBeUndefined()
		expect(answer.verdict).toBe('wait')
	})

	it('offers the candidate when the listing agrees with the summary', async () => {
		const children = [child(1)]
		const answer = await epic_candidate_confirm.answer_for_repo(children, context(children))

		expect(answer.child?.number).toBe(1)
		expect(answer.verdict).toBe('run')
	})
})

// The classifier is re-run rather than the listing tested for emptiness, so a recovered relation is
// judged by what the blocker actually is.
describe('epic_candidate_confirm.answer_for_repo — what the recovered blocker is', () => {
	it('offers a candidate whose recovered blocker is already closed', async () => {
		const children = [child(1, { state: 'CLOSED' }), child(2)]
		const answer = await epic_candidate_confirm.answer_for_repo(
			bundle(children, [2]),
			context(children, new Map([[2, [1]]])),
		)

		expect(answer.child?.number).toBe(2)
	})

	it('reports a parked blocker as needing a person rather than as waiting', async () => {
		const children = [child(1, { labels: [NEEDS_DECISION_LABEL] }), child(2)]
		const answer = await epic_candidate_confirm.answer_for_repo(
			bundle(children, [2]),
			context(children, new Map([[2, [1]]])),
		)

		expect(answer.verdict).toBe('stop')
	})

	// Two children of one epic can share a number across repositories, so the correction is applied by
	// identity rather than by number (joshuafolkken/kit#864).
	it('matches the candidate by repository as well as number', async () => {
		const children = [child(1), child(1, { repo: OTHER_REPO })]
		const answer = await epic_candidate_confirm.answer_for_repo(
			children.filter((entry) => entry.repo === REPO),
			context(children),
		)

		expect(answer.child?.repo).toBe(REPO)
	})
})

// `classify_children` drops a blocker the epic does not track, so the candidate is still offered —
// the standing rule, applied here to a relation the confirmation just paid a request to recover.
describe('epic_candidate_confirm.answer_for_repo — a blocker outside the epic', () => {
	const OUTSIDER = 999

	it('still offers the candidate, as it does for a relation the summary counted', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const children = [child(2)]
		const answer = await epic_candidate_confirm.answer_for_repo(
			children,
			context(children, new Map([[2, [OUTSIDER]]])),
		)

		expect(answer.child?.number).toBe(2)
		warn.mockRestore()
	})

	it('names the relation it discarded rather than offering the child silently', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const children = [child(2)]

		await epic_candidate_confirm.answer_for_repo(
			children,
			context(children, new Map([[2, [OUTSIDER]]])),
		)

		expect(warn.mock.calls.join('\n')).toContain(`#${String(OUTSIDER)}`)
		expect(warn.mock.calls.join('\n')).toContain('does not track those')
		warn.mockRestore()
	})

	it('says nothing when every recovered relation is one the epic tracks', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const children = [child(1, { state: 'CLOSED' }), child(2)]

		await epic_candidate_confirm.answer_for_repo(
			bundle(children, [2]),
			context(children, new Map([[2, [1]]])),
		)

		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
	})
})

describe('epic_candidate_confirm.answer_for_repo — the cost of confirming', () => {
	it('reads the listing once for a candidate the confirmation accepts', async () => {
		const children = [child(1), child(2)]
		const state = context(children)

		await epic_candidate_confirm.answer_for_repo(children, state)

		expect(state.read_blockers).toHaveBeenCalledTimes(1)
	})

	it('reads nothing when the repository has no candidate', async () => {
		const children = [child(1, { blocked_by: [2] }), child(2, { labels: [IN_PROGRESS_LABEL] })]
		const state = context(children)
		const answer = await epic_candidate_confirm.answer_for_repo([], state)

		expect(state.read_blockers).not.toHaveBeenCalled()
		expect(answer.verdict).toBe('wait')
	})
})

describe('epic_candidate_confirm.answer_for_repo — walking the bundle', () => {
	it('offers the next candidate when the first is withheld', async () => {
		const children = [child(1, { labels: [IN_PROGRESS_LABEL] }), child(2), child(3)]
		const answer = await epic_candidate_confirm.answer_for_repo(
			bundle(children, [2, 3]),
			context(children, new Map([[2, [1]]])),
		)

		expect(answer.child?.number).toBe(3)
	})

	// Only the carried-forward correction reaches `stop`: judged against the stale snapshot instead,
	// #3's blocker #2 still reads as runnable and the verdict comes out `run`.
	it('carries the correction forward so a sibling is judged against it', async () => {
		const children = [child(1, { labels: [NEEDS_DECISION_LABEL] }), child(2), child(3)]
		const answer = await epic_candidate_confirm.answer_for_repo(
			bundle(children, [2, 3]),
			context(
				children,
				new Map([
					[2, [1]],
					[3, [2]],
				]),
			),
		)

		expect(answer.child).toBeUndefined()
		expect(answer.verdict).toBe('stop')
	})
})

describe('epic_candidate_confirm.answer_for_repo — a read that failed', () => {
	it('withholds the candidate rather than offering it unconfirmed', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const children = [child(1)]
		const state: ConfirmContext = {
			children,
			resolve: epic_classify.resolve_by_state,
			read_blockers: async () => {
				throw new Error('rate limited')
			},
		}
		const answer = await epic_candidate_confirm.answer_for_repo(children, state)

		expect(answer.child).toBeUndefined()
		expect(warn.mock.calls[0]?.[0]).toContain('could not confirm the blockers of #1')
		warn.mockRestore()
	})
})

describe('epic_candidate_confirm.is_same_blockers', () => {
	const one = { repo: REPO, number: 1 }
	const two = { repo: REPO, number: 2 }

	it('ignores the order the two reads listed the blockers in', () => {
		expect(epic_candidate_confirm.is_same_blockers([two, one], [one, two])).toBe(true)
	})

	it('separates a listing that names more than the summary counted', () => {
		expect(epic_candidate_confirm.is_same_blockers([], [one])).toBe(false)
	})

	// The same number in two repositories is two different blockers (joshuafolkken/kit#1126).
	it('separates the same number in a different repository', () => {
		expect(epic_candidate_confirm.is_same_blockers([one], [{ repo: OTHER_REPO, number: 1 }])).toBe(
			false,
		)
	})
})
