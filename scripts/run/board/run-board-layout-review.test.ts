import type { EpicChild } from '#scripts/epic/epic-graph'
import { NEEDS_HUMAN_REVIEW_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import type { ReviewStop } from './run-board-layout-types'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8527: a plan row held at a review stop — `needs-human-review` on an issue whose lane
// stopped — is a person's row naming its lane; the label alone, put on before the run, is not.

const REPO = 'joshuafolkken/kit'
const STOPPED = 5272
const STOPPED_MS = Date.parse('2026-11-21T09:00:00Z')
const NOW_MS = Date.parse('2026-11-21T10:30:00Z')
const DIRECTORY = '/work/.kit-lanes/5272'
const NO_STATUSES: ReadonlyMap<number, ItemStatus> = new Map()

function labelled_child(): EpicChild {
	return {
		number: STOPPED,
		repo: REPO,
		state: 'OPEN',
		labels: [NEEDS_HUMAN_REVIEW_LABEL],
		blocked_by: [],
	}
}

function plan_of(review_stops?: ReadonlyMap<number, ReviewStop>): BoardPlan {
	const child = labelled_child()

	return {
		waves: { waves: [[child]], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([STOPPED]) },
		labels: new Map(),
		review_stops,
		now_ms: NOW_MS,
	}
}

function queued_row(plan: BoardPlan): { state: string; tail: string | undefined } | undefined {
	const [entry] = run_board_layout.layout_of(plan, NO_STATUSES).queued
	if (entry?.kind !== 'row') return undefined

	return { state: entry.row.state, tail: entry.row.reason?.tail }
}

describe('run_board_layout.layout_of — a review stop', () => {
	it('draws a queued child at a review stop as a person’s row naming its lane', () => {
		const stops = new Map([[STOPPED, { stopped_ms: STOPPED_MS, directory: DIRECTORY }]])

		expect(queued_row(plan_of(stops))).toStrictEqual({
			state: 'human',
			tail: `→ review the uncommitted changes in ${DIRECTORY} (stopped 1°30′00″ ago)`,
		})
	})

	it('keeps a child labelled before its run, its lane not stopped, a waiting row', () => {
		expect(queued_row(plan_of())?.state).toBe('waiting')
	})
})
