import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, RowReason } from './run-board-layout'
import { run_board_reason } from './run-board-reason'

// joshuafolkken/kit#4414: a row waiting on the merges recorded after a pull request says how many it
// has of how many, or names the pull request while it has not merged.

const REPO = 'joshuafolkken/kit'
const ROW = 4330
const PR = 4313
const { WAIT_ICONS } = run_board_labels
const BODY = `## 背景\n\n- 実施可能条件: #${String(PR)} のマージ後 10 マージ\n`

function row(): EpicChild {
	return {
		number: ROW,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: [],
		body: BODY,
	}
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([ROW]) },
		labels: new Map(),
	}
}

function reason(): RowReason | undefined {
	const children = [row()]
	const read = {
		plan: plan_of(children),
		statuses: new Map(),
		events: [],
		free_lanes: 1,
		is_stopped: false,
	}

	return run_board_reason.reader(read)(row(), [])
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_reason.reader — a row waiting on its declared samples', () => {
	it('says the merges counted of those the body waits on', () => {
		vi.spyOn(issue_sample_gate, 'wait_of').mockReturnValue({
			kind: 'short',
			pr: PR,
			counted: 3,
			needed: 10,
		})

		expect(reason()).toStrictEqual({ icon: WAIT_ICONS.not_before, value: '3/10' })
	})

	it('names the pull request while it has not merged', () => {
		vi.spyOn(issue_sample_gate, 'wait_of').mockReturnValue({ kind: 'unmerged', pr: PR })

		expect(reason()).toStrictEqual({ icon: WAIT_ICONS.not_before, issues: [String(PR)] })
	})
})
