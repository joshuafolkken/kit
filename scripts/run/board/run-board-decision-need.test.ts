import {
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	RUN_LANE_LABEL,
} from '#scripts/issue/issue-labels'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { describe, expect, it } from 'vitest'
import { run_board_decision, type DecisionNode } from './run-board-decision'

const REPO = 'joshuafolkken/kit'
const PERSON = 6113
const WAITING = 6108
const TITLE = 'Confirm the promotional credits'
const DETAIL = '外部アカウント'
const PENDING_BODY = issue_publication_state.prepare('## 背景\n', [RUN_LANE_LABEL])

function node_of(labels: ReadonlyArray<string>, body = ''): DecisionNode {
	return { number: PERSON, repo: REPO, state: 'OPEN', title: TITLE, labels, body, blocked_by: [] }
}

describe('run_board_decision.blocker_of need (joshuafolkken/kit#8026)', () => {
	it.each([
		['merge', [NEEDS_HUMAN_MERGE_LABEL, NEEDS_DECISION_LABEL], PENDING_BODY],
		['publish', [NEEDS_DECISION_LABEL], PENDING_BODY],
		['decide', [NEEDS_DECISION_LABEL], ''],
		['take', [RUN_LANE_LABEL], ''],
	] as const)('reads the need %s', (need, labels, body) => {
		expect(run_board_decision.blocker_of(node_of(labels, body), [WAITING]).need).toBe(need)
	})

	it('carries the human detail and the children the blocker holds', () => {
		const body = `- 人の判断: 要（${DETAIL}）`

		expect(
			run_board_decision.blocker_of(node_of([NEEDS_DECISION_LABEL], body), [WAITING]),
		).toStrictEqual({
			number: PERSON,
			title: TITLE,
			labels: [NEEDS_DECISION_LABEL],
			need: 'decide',
			detail: DETAIL,
			blocks: [WAITING],
		})
	})

	it.each(['', '- 人の判断: 不要'])(
		'omits the detail when the body has no human detail: %s',
		(body) => {
			expect(
				run_board_decision.blocker_of(node_of([NEEDS_DECISION_LABEL], body), []).detail,
			).toBeUndefined()
		},
	)
})
