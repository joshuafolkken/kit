import { describe, expect, it } from 'vitest'
import { epic_bundle, type BacklogIssue } from './epic-bundle'
import { epic_bundle_referenced, type ReferencedContext } from './epic-bundle-referenced'
import type { EpicIssue } from './epic-issue'

// joshuafolkken/kit#947: `epic:bundle` searched open issues only, so it could answer correctly for
// about three minutes. A follow-up issue names its parent in its body; the parent's pull request
// merges right after. On kit#943 the gap between filing and the parent closing was 3m08s, and past
// it the command printed `Nothing to bundle.` with exit 0 — asserting there was no relation rather
// than that it had stopped being able to see one.
//
// The exact shape is reconstructed here from fixed input: a body naming closed #891, #891 tracked by
// the open epic #893, and the correct answer `add_to_epic #893`.

const REPO = 'joshuafolkken/kit'
const OPEN = 'OPEN'
const CLOSED = 'CLOSED'

// The subject as it reached the command: filed from a review round cap, naming its parent.
const SUBJECT_BODY = '親: joshuafolkken/kit#891（起票元: joshuafolkken/kit#891）'

function issue(number: number, overrides: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...overrides }
}

function fetched(number: number, state: string, overrides: Partial<EpicIssue> = {}): EpicIssue {
	return {
		number,
		title: '',
		body: '',
		state,
		url: `https://github.com/${REPO}/issues/${String(number)}`,
		labels: [],
		blockedBy: undefined,
		...overrides,
	}
}

// What a read answers when the number turns out to be a pull request: the issue endpoint serves
// one as readily as an issue.
function fetched_pull_request(number: number, state: string): EpicIssue {
	return fetched(number, state, { url: `https://github.com/${REPO}/pull/${String(number)}` })
}

function context(overrides: Partial<ReferencedContext> = {}): ReferencedContext {
	return {
		repo: REPO,
		epics: new Map([[891, 893]]),
		epic_numbers: new Set([893]),
		...overrides,
	}
}

describe('epic_bundle_referenced.referenced_lookups', () => {
	it('names the issues the body cites that the listing did not carry', () => {
		const subject = issue(943, { body: SUBJECT_BODY })

		expect(epic_bundle_referenced.referenced_lookups(subject, new Set()).numbers).toEqual([891])
	})

	// The listing already carried them with their relations; reading them again would be one request
	// per reference for data already in hand.
	it('skips a reference the open listing already provided', () => {
		const subject = issue(943, { body: SUBJECT_BODY })

		expect(epic_bundle_referenced.referenced_lookups(subject, new Set([891])).numbers).toEqual([])
	})

	it('never looks up the subject itself', () => {
		const subject = issue(943, { body: 'see #943 and #891' })

		expect(epic_bundle_referenced.referenced_lookups(subject, new Set()).numbers).toEqual([891])
	})

	// One read each, so the count is the cost. A body naming more than the cap is prose about the
	// backlog rather than an issue with that many prerequisites.
	it('caps how many references one body can spend requests on', () => {
		const limit = epic_bundle_referenced.REFERENCED_LOOKUP_LIMIT
		const numbers = Array.from({ length: limit + 5 }, (_, index) => index + 1)
		const subject = issue(999, { body: numbers.map((number) => `#${String(number)}`).join(' ') })

		expect(epic_bundle_referenced.referenced_lookups(subject, new Set()).numbers).toHaveLength(
			limit,
		)
	})

	// The cap is a guard, and a guard that truncates in silence puts the command back to asserting
	// there was no relation when it had merely stopped looking.
	it('names what the cap left unread rather than dropping it', () => {
		const limit = epic_bundle_referenced.REFERENCED_LOOKUP_LIMIT
		const numbers = Array.from({ length: limit + 5 }, (_, index) => index + 1)
		const subject = issue(999, { body: numbers.map((number) => `#${String(number)}`).join(' ') })

		expect(epic_bundle_referenced.referenced_lookups(subject, new Set()).dropped).toEqual(
			numbers.slice(limit),
		)
	})
})

describe('epic_bundle_referenced.collect_referenced', () => {
	it('recovers the epic that tracks a closed reference', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 891, result: fetched(891, CLOSED) }],
			context(),
		)

		expect(found.issues).toEqual([
			{ number: 891, repo: REPO, body: '', blocked_by: [], is_epic: false, epic: 893 },
		])
		expect(found.unreadable).toEqual([])
	})

	// The decision this Issue records: a closed issue no epic tracks is not a candidate. `create_epic`
	// over it would build an epic whose other child is already finished — nothing for a run to
	// execute, and half-done from the moment it is created.
	it('drops a closed reference that no epic tracks', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 700, result: fetched(700, CLOSED) }],
			context(),
		)

		expect(found.issues).toEqual([])
	})

	// An open reference missing from the listing means the listing was capped, not that the issue is
	// unrelated — so it counts whether or not an epic tracks it.
	it('keeps an open reference the listing did not carry', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 700, result: fetched(700, OPEN) }],
			context(),
		)

		expect(found.issues.map((entry) => entry.number)).toEqual([700])
	})
})

describe('epic_bundle_referenced.collect_referenced — what it refuses to answer with', () => {
	// An epic is a container, not a sibling: every child names it as its parent, so without the guard
	// each one would find its own epic through this path and be told to bundle with it.
	it('never returns an epic as a candidate', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 893, result: fetched(893, OPEN) }],
			context(),
		)

		expect(found.issues).toEqual([])
	})

	// The whole point: a refused read has to arrive as a gap. Folded into "nothing found" it becomes
	// the confident wrong answer this Issue is about.
	it('reports a failed read instead of counting it as no relation', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 891, result: 'unreadable' }],
			context(),
		)

		expect(found.unreadable).toEqual([891])
		expect(found.issues).toEqual([])
	})
})

describe('epic_bundle_referenced.collect_referenced — a number that does not exist', () => {
	// joshuafolkken/kit#957: a number that resolves to nothing is not a gap. Reported as one, a single
	// typo in prose puts a `⚠ Could not read #N.` above the verdict — and joshuafolkken/kit#950 has an
	// unattended run stop on exactly that, for a reference that never existed.
	it('says nothing about a reference that does not exist', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 99_999, result: 'missing' }],
			context(),
		)

		expect(found.unreadable).toEqual([])
		expect(found.issues).toEqual([])
	})

	// The two arrive through the same failed read, so the distinction is worth asserting together:
	// only the one that could have been read is reported.
	it('separates a reference that does not exist from one it could not read', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[
				{ number: 99_999, result: 'missing' },
				{ number: 891, result: 'unreadable' },
			],
			context(),
		)

		expect(found.unreadable).toEqual([891])
	})
})

describe('epic_bundle_referenced.collect_referenced — a number that is a pull request', () => {
	// The issue endpoint serves a pull request too, and "the fix landed in #952" is ordinary prose.
	// A merged PR reports `state: MERGED`, which the auto-close's state reader maps to OPEN — so
	// without the URL check the command proposes an epic with a pull request among its children.
	it('never returns a merged pull request as a candidate', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 952, result: fetched_pull_request(952, 'MERGED') }],
			context(),
		)

		expect(found.issues).toEqual([])
	})

	it('never returns an open pull request as a candidate', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 952, result: fetched_pull_request(952, OPEN) }],
			context(),
		)

		expect(found.issues).toEqual([])
	})
})

describe('epic_bundle_referenced.collect_referenced — a read that is not an open issue', () => {
	// A read that came back shaped wrong defaults to `UNKNOWN`. Treating it as open would let a
	// malformed answer into the candidate pool as though it had been read successfully.
	it('does not treat an unknown state as open', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[{ number: 700, result: fetched(700, 'UNKNOWN') }],
			context(),
		)

		expect(found.issues).toEqual([])
	})

	it('carries the blockers a reference declares', () => {
		const found = epic_bundle_referenced.collect_referenced(
			[
				{
					number: 891,
					result: fetched(891, CLOSED, { blockedBy: { nodes: [{ number: 890 }] } }),
				},
			],
			context(),
		)

		expect(found.issues[0]?.blocked_by).toEqual([890])
	})
})

// End to end over the pure layer: the reconstructed kit#943 input, through the same `decide_bundle`
// the command calls, has to reach the answer that was lost.
describe('the kit#943 shape reaches the epic it belonged to', () => {
	it('recommends the epic that tracks the closed parent', () => {
		const subject = issue(943, { body: SUBJECT_BODY })
		const lookups = epic_bundle_referenced.referenced_lookups(subject, new Set()).numbers
		const found = epic_bundle_referenced.collect_referenced(
			lookups.map((number) => ({ number, result: fetched(number, CLOSED) })),
			context(),
		)
		const decision = epic_bundle.decide_bundle(subject, found.issues)

		expect(decision.action).toBe('add_to_epic')
		expect(decision.epic).toBe(893)
		expect(decision.candidates).toEqual([891])
	})

	// What the command did before the fix, reproduced by handing it the open backlog alone.
	it('answered nothing to bundle when the closed parent was invisible', () => {
		const subject = issue(943, { body: SUBJECT_BODY })

		expect(epic_bundle.decide_bundle(subject, []).action).toBe('none')
	})
})
