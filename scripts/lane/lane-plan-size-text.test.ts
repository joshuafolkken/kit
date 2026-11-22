import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type PlanSignals } from './lane-plan-size'
import { lane_plan_size_text, type Oversize } from './lane-plan-size-text'

const ISSUE = 8657
const PLANNED_AT = '2026-11-22T10:46:00Z'
const SINGLE = '--single "<why it cannot be merged in parts>"'
const NOT_WAITED = 'a follow-up Issue this one does not wait on'
const NO_SPLIT =
	"What stays would wait on the carved part's merge, or it is one deliverable → that is no split"
const QUIET: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}
// #8657's shape: 420 declared lines over 10 files, the lines bar refusing it (joshuafolkken/kit#8661).
const SERIAL_BODY =
	'## 背景\n\n- 規模見積もり: 約 10 ファイル / 420 行（テスト含む）\n- 分割しない理由: 分けられない — 描画と除外は同じ開始時刻を読む\n'

function issues(): Array<OpenIssueData> {
	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body: SERIAL_BODY }]
}

function plan(single?: true): LanePlan {
	const base = {
		issue: ISSUE,
		paths: ['scripts/run/board/run-board-notice-trace.ts'],
		planned_at: PLANNED_AT,
	}

	return single === undefined ? base : { ...base, single }
}

function serial_over(): Oversize | undefined {
	return lane_plan_size.oversize(plan(), issues(), undefined, QUIET)
}

describe('lane_plan_size_text.refusal_text', () => {
	it.each<[string, Oversize]>([
		['lines', { reason: 'lines', declared: 420, limit: 40, measured: 840 }],
		['hunks', { reason: 'hunks', declared: 8, limit: 16, measured: 17 }],
		['hub', { reason: 'hub', limit: 50, hubs: ['scripts/hub.ts'] }],
		['files', { reason: 'files', declared: 4, limit: 8, kept: ['a.ts'], split_off: ['b.ts'] }],
	])('names the --single way for a carve-off the rest waits on, on the %s axis', (reason, over) => {
		const text = lane_plan_size_text.refusal_text(ISSUE, over)

		expect(text).toContain(`split (${reason})`)
		expect(text).toContain(NOT_WAITED)
		expect(text).toContain(NO_SPLIT)
		expect(text).toContain(SINGLE)
		expect(text).toContain('your own step, no park')
		expect(text).toContain('split-assessment.md → "The question", 3')
	})
})

// joshuafolkken/kit#8661: #8657's lines refusal names `--single`, and the child's own `--single` re-run
// passes the bar as a warning, needing no person.
describe('lane_plan_size on a lines-bar plan whose carve-off the rest would wait on', () => {
	it('answers split (lines) without --single, as an independent part always did (ac-93d5dc53)', () => {
		const over = serial_over()

		expect(over).toMatchObject({ reason: 'lines' })
		expect(lane_plan_size.is_waived(plan(), over)).toBe(false)
	})

	it('names --single in the refusal and waives the bar once the child runs it (ac-4578644e)', () => {
		const over = serial_over()

		expect(over === undefined ? '' : lane_plan_size.refusal_text(ISSUE, over)).toContain(SINGLE)
		expect(lane_plan_size.is_waived(plan(true), over)).toBe(true)
	})
})
