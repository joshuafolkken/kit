import { describe, expect, it } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild } from './epic-graph'
import type { EpicReference } from './epic-issue'
import { epic_next_views, type EpicView } from './epic-next-views'
import { epic_report, type EpicNextResult } from './epic-report'

// joshuafolkken/kit#1493: several epics answered as one. What is asserted here is the merge — the
// order the pools come out in, the verdict when none of them offered anything, and that a reader can
// tell which graph a block of the report came from.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const FIRST_EPIC = 858
const SECOND_EPIC = 909
const FIRST_CHILD = 861
const SECOND_CHILD = 862

function child(number: number, repo: string = REPO): EpicChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [] }
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
	}
}

const EMPTY_CLASSIFICATION = { runnable: [], time: [], human: [] }

function result_of(runnable: ReadonlyArray<EpicChild>): EpicNextResult {
	return epic_report.build_result({ runnable, time: [], human: [] }, [])
}

function view(number: number, children: ReadonlyArray<EpicChild>): EpicView {
	const reference: EpicReference = { number }

	return { reference, snapshot: snapshot(children), result: result_of(children) }
}

function view_with(number: number, result: EpicNextResult): EpicView {
	return { reference: { number }, snapshot: snapshot([]), result }
}

describe('epic_next_views.pools_of', () => {
	it('builds one pool per epic, in the order they were named', () => {
		const pools = epic_next_views.pools_of(
			[view(FIRST_EPIC, [child(FIRST_CHILD)]), view(SECOND_EPIC, [child(SECOND_CHILD)])],
			REPO,
		)

		expect(pools.map((entry) => entry.candidates.map((one) => one.number))).toEqual([
			[FIRST_CHILD],
			[SECOND_CHILD],
		])
	})

	// The context is what a candidate's blockers are re-classified against, so merging the candidates
	// into one array would confirm one epic's child against another epic's children.
	it('gives each pool the children of its own epic as the confirmation context', () => {
		const pools = epic_next_views.pools_of(
			[view(FIRST_EPIC, [child(FIRST_CHILD)]), view(SECOND_EPIC, [child(SECOND_CHILD)])],
			REPO,
		)

		expect(pools[1]?.context.children.map((one) => one.number)).toEqual([SECOND_CHILD])
	})

	it('narrows every pool to the repository asked about', () => {
		const elsewhere = view(FIRST_EPIC, [child(FIRST_CHILD, OTHER_REPO)])
		const pools = epic_next_views.pools_of([elsewhere], REPO)

		expect(pools[0]?.candidates).toEqual([])
	})
})

describe('epic_next_views.combined_verdict', () => {
	it('reports complete only when every epic said so', () => {
		const complete = result_of([])

		expect(
			epic_next_views.combined_verdict([
				view_with(FIRST_EPIC, complete),
				view_with(SECOND_EPIC, complete),
			]),
		).toBe('complete')
	})

	it('prefers the epic with work to the one without', () => {
		const idle = view_with(FIRST_EPIC, result_of([]))
		const busy = view_with(SECOND_EPIC, result_of([child(FIRST_CHILD)]))

		expect(epic_next_views.combined_verdict([idle, busy])).toBe('run')
	})

	it('prefers waiting to stopping, as one epic already does', () => {
		const time = [child(FIRST_CHILD)]
		const human = [child(SECOND_CHILD)]
		const held = epic_report.build_result({ runnable: [], time, human: [] }, [])
		const asked = epic_report.build_result({ runnable: [], time: [], human }, [])
		const waiting = view_with(FIRST_EPIC, held)
		const stopped = view_with(SECOND_EPIC, asked)

		expect(epic_next_views.combined_verdict([stopped, waiting])).toBe('wait')
	})
})

describe('epic_next_views.error_view', () => {
	it('finds the epic whose graph is unusable', () => {
		const anomaly = { kind: 'cycle', message: 'a cycle' } as const
		const broken = view_with(SECOND_EPIC, epic_report.build_result(EMPTY_CLASSIFICATION, [anomaly]))
		const found = epic_next_views.error_view([view(FIRST_EPIC, []), broken])

		expect(found?.reference.number).toBe(SECOND_EPIC)
	})

	it('finds nothing when every graph is usable', () => {
		expect(epic_next_views.error_view([view(FIRST_EPIC, [])])).toBeUndefined()
	})
})

describe('epic_next_views.aggregate_text', () => {
	it('heads each block with its epic when there is more than one', () => {
		const text = epic_next_views.aggregate_text([
			view(FIRST_EPIC, [child(FIRST_CHILD)]),
			view(SECOND_EPIC, [child(SECOND_CHILD)]),
		])

		expect(text).toContain(`#${String(FIRST_EPIC)}`)
		expect(text).toContain(`#${String(SECOND_EPIC)}`)
	})

	// A single epic prints exactly what it printed before this existed.
	it('adds no heading for a single epic', () => {
		const only = view(FIRST_EPIC, [child(FIRST_CHILD)])

		expect(epic_next_views.aggregate_text([only])).toBe(epic_report.format_result(only.result))
	})
})

describe('epic_next_views.format_reference', () => {
	it('leaves a bare reference bare', () => {
		expect(epic_next_views.format_reference({ number: FIRST_EPIC })).toBe(`#${String(FIRST_EPIC)}`)
	})

	it('keeps the repository of a qualified one', () => {
		expect(epic_next_views.format_reference({ number: FIRST_EPIC, repo: OTHER_REPO })).toBe(
			`${OTHER_REPO}#${String(FIRST_EPIC)}`,
		)
	})
})
