import type { EpicChild } from '#scripts/epic/epic-graph'
import { PLAN_UNVERIFIED_LABEL, PLANNED_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { describe, expect, it } from 'vitest'
import { run_board_publication } from './run-board-publication'

const ROW = 8114
const EPIC = 8100
const PENDING_BODY = issue_publication_state.prepare('## 背景\n', [RUN_LANE_LABEL])

function child(body: string, labels: ReadonlyArray<string> = [RUN_LANE_LABEL]): EpicChild {
	return { number: ROW, repo: 'joshuafolkken/kit', state: 'OPEN', labels, blocked_by: [], body }
}

describe('run_board_publication.reason_of', () => {
	it('names only the first missing step when both epic and plan are missing', () => {
		expect(run_board_publication.reason_of(child(PENDING_BODY), undefined)?.tail).toBe(
			'→ epic placement: add it to an epic task list',
		)
	})

	it('does not count a plan:unverified record as the plan', () => {
		const labels = [RUN_LANE_LABEL, PLANNED_LABEL, PLAN_UNVERIFIED_LABEL]

		expect(run_board_publication.reason_of(child(PENDING_BODY, labels), EPIC)?.tail).toBe(
			`→ plan record: pnpm josh issue:plan ${String(ROW)} --planned`,
		)
	})

	it('says nothing once the filing has published', () => {
		const published = issue_publication_state.public_body(PENDING_BODY)

		expect(run_board_publication.reason_of(child(published), EPIC)).toBeUndefined()
	})
})
