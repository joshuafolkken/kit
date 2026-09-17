import { describe, expect, it } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_next } from './epic-next'

// joshuafolkken/kit#1690: the epic's own body failing to read is its own anomaly. Left silent it
// parses to zero children, the epic is skipped as one tracking none, the verdict falls through to
// `complete`, and `backlog:next` prints that as `none` — the backlog reported exhausted over one
// request that never left the machine.

const REPO = 'joshuafolkken/kit'
const FORBIDDEN_STATUS = 403
const UNREACHABLE = { kind: 'unreadable', reason: 'unreachable', status: undefined } as const
const REJECTED = { kind: 'unreadable', reason: 'rejected', status: FORBIDDEN_STATUS } as const

function snapshot(overrides: Partial<EpicSnapshot> = {}): EpicSnapshot {
	return {
		body: undefined,
		repo: REPO,
		current_repo: REPO,
		children: [] as ReadonlyArray<EpicChild>,
		child_numbers: [],
		unreadable: [] as ReadonlyArray<IssueReference>,
		skipped: [],
		has_external_children: false,
		body_failure: undefined,
		is_unreachable: false,
		...overrides,
	}
}

describe('epic_next.decide — the epic body that could not be read', () => {
	it('raises an anomaly instead of answering complete', () => {
		const result = epic_next.decide(snapshot({ body_failure: UNREACHABLE, is_unreachable: true }))

		expect(result.verdict).toBe('error')
		expect(result.anomalies[0]?.kind).toBe('unreadable_epic_body')
	})

	// The mark is what lets `backlog:next` ask again rather than call the graph unusable, and it comes
	// from the failed request rather than from a probe fired afterwards.
	it('marks the anomaly unreachable when the read never reached GitHub', () => {
		const result = epic_next.decide(snapshot({ body_failure: UNREACHABLE, is_unreachable: true }))

		expect(result.anomalies[0]?.is_unreachable).toBe(true)
	})

	it('leaves the anomaly unmarked when GitHub answered and refused', () => {
		const result = epic_next.decide(snapshot({ body_failure: REJECTED }))

		expect(result.anomalies[0]?.is_unreachable).toBe(false)
	})

	// The ordinary case has to stay exactly where it was: a readable but empty body is an epic that
	// tracks no children, not one nobody could read.
	it('raises nothing for a body that was read and holds no task list', () => {
		const result = epic_next.decide(snapshot())

		expect(result.anomalies).toEqual([])
		expect(result.verdict).toBe('complete')
	})
})

describe('epic_next.decide — the epic body against the children', () => {
	// A body nobody read says nothing about the children either, so it is reported ahead of them.
	it('reports the body ahead of the children it could not read', () => {
		const result = epic_next.decide(
			snapshot({
				child_numbers: [1],
				unreadable: [{ repo: REPO, number: 1 }],
				body_failure: UNREACHABLE,
				is_unreachable: true,
			}),
		)

		expect(result.anomalies).toHaveLength(1)
		expect(result.anomalies[0]?.kind).toBe('unreadable_epic_body')
	})
})
