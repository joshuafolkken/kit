import { stripVTControlCharacters } from 'node:util'
import { NEEDS_DECISION_LABEL, NEEDS_HUMAN_REVIEW_LABEL } from '#scripts/issue/issue-labels'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_pause } from './run-board-pause'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8592: joshuafolkken/kit#5272 as the board read it on 2026-11-22 — parked on
// 11-20, relaunched 11-21 07:49Z, paused by a person with `lane:pause`, then labelled by hand with no
// stop comment. Its 🙋 row ends on a next action, never on the old `Reason unavailable` text.

const { NOW, header } = run_board_render_fixture
const ISSUE = 5272
const BLOCKED = 7491
const REPO = 'joshuafolkken/kit'
const TITLE = 'Upgrade TypeScript to 7 and fix forward'
const LANE = `/lanes/${String(ISSUE)}`
const WIDTH = 160
const STOP_BODY = '### 選択肢\n1. Wait\n   - 層: C\n   - 必要な権限: 人\n\n### 推奨\n1 safer\n'
const OLD_STOP = {
	author: 'owner',
	created_at: '2026-11-20T18:54:00Z',
	is_trusted: true,
	body: issue_outcome.body_of({ body: STOP_BODY, summary: 'Prerequisite #8429 first' }),
	html_url: `https://github.com/${REPO}/issues/${String(ISSUE)}#issuecomment-1`,
}
const RELAUNCHED: ItemStatus = {
	state: 'parked',
	reason: NEEDS_DECISION_LABEL,
	launched_ms: Date.parse('2026-11-21T07:49:24Z'),
}
const BOTH_LABELS = [NEEDS_DECISION_LABEL, NEEDS_HUMAN_REVIEW_LABEL]

function plan_of(labels: Array<string>, has_review_stop: boolean): BoardPlan {
	return {
		now_ms: NOW,
		pause_reasons: new Map([[ISSUE, run_board_pause.from_comments([OLD_STOP])]]),
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		labels: new Map([[ISSUE, labels]]),
		decision_blockers: [{ number: ISSUE, title: TITLE, labels, need: 'decide', blocks: [BLOCKED] }],
		...(has_review_stop && {
			review_stops: new Map([
				[ISSUE, { stopped_ms: Date.parse('2026-11-21T08:08:33Z'), directory: LANE }],
			]),
		}),
		context: { repo: REPO, titles: new Map([[ISSUE, TITLE]]), open_numbers: new Set([ISSUE]) },
	}
}

function line_of(labels: Array<string>, has_review_stop = false): string {
	const layout = run_board_layout.layout_of(
		plan_of(labels, has_review_stop),
		new Map([[ISSUE, RELAUNCHED]]),
	)
	const links = run_board_link.links_of(REPO, (text: string): string => text)
	const lines = run_board_render.render({
		header: header({ layout, ...links }),
		notes: [],
		size: { columns: WIDTH, rows: WIDTH },
	})

	return stripVTControlCharacters(lines.find((line) => line.includes(String(ISSUE))) ?? '')
}

describe('run_board_render on a relaunched decision stopped with no record', () => {
	it('ends the row on a next action, not the old fallback text', () => {
		const line = line_of(BOTH_LABELS)

		expect(line).not.toContain('Reason unavailable')
		expect(line).toContain(`${run_board_pause.FALLBACK} (blocks #${String(BLOCKED)})`)
	})

	it('shows the review stop action when the lane holds one under needs-human-review', () => {
		expect(line_of(BOTH_LABELS, true)).toContain(`→ review the uncommitted changes in ${LANE}`)
	})

	it('keeps the fallback action when the review stop has no needs-human-review label', () => {
		expect(line_of([NEEDS_DECISION_LABEL], true)).toContain(run_board_pause.FALLBACK)
	})
})
