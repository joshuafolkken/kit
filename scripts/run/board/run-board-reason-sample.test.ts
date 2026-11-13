import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_observation_fixture as observation } from '#scripts/issue/issue-observation-fixture'
import { issue_observation_gate } from '#scripts/issue/issue-observation-gate'
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
const NOW_MS = Date.parse('2026-10-20T00:00:00.000Z')
const { WAIT_ICONS } = run_board_labels
const BODY = `## 背景\n\n- 実施可能条件: #${String(PR)} のマージ後 10 マージ\n`

function row(body = BODY): EpicChild {
	return {
		number: ROW,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: [],
		body,
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

function reason(body = BODY): RowReason | undefined {
	const children = [row(body)]
	const read = {
		plan: plan_of(children),
		statuses: new Map(),
		events: [],
		free_lanes: 1,
		is_stopped: false,
		now_ms: NOW_MS,
	}

	return run_board_reason.reader(read)(row(body), [])
}

afterEach(() => {
	vi.restoreAllMocks()
	issue_observation_gate.reset()
})

it('shows unmet observation requirements and the evidence needed to resume', () => {
	issue_observation_gate.record(observation.URL, observation.comment(['same-head']))
	expect(reason(observation.BODY)).toStrictEqual({
		icon: WAIT_ICONS.not_before,
		value: 'evidence',
		tail: 'observation evidence required: multi-slot, comparison, cost',
		evidence_url: observation.URL,
	})
})

describe('run_board_reason.reader — a row waiting on its declared samples', () => {
	it('says the merges counted of those the body waits on', () => {
		vi.spyOn(issue_sample_gate, 'wait_of').mockReturnValue({
			kind: 'short',
			cited: PR,
			via: 'pull',
			counted: 3,
			needed: 10,
		})

		expect(reason()).toStrictEqual({ icon: WAIT_ICONS.not_before, value: '3/10' })
	})

	it.each(['pull', 'issue'] as const)('names the cited %s while it has not merged', (via) => {
		vi.spyOn(issue_sample_gate, 'wait_of').mockReturnValue({ kind: 'unmerged', cited: PR, via })

		expect(reason()).toStrictEqual({ icon: WAIT_ICONS.not_before, issues: [String(PR)] })
	})
})
