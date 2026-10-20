import { report_labels } from '#scripts/report/report-labels'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_report_handoff, type HandoffInput } from './run-report-handoff'

// joshuafolkken/kit#4161: every line of the hand-off report is filled from the run record and the
// `cost --cut` figures, so the report is pinned against fixed values rather than a template a session
// fills in by hand.

const AT = '2026-10-20T00:00:00.000Z'
const THRESHOLD = 135_000
const COST = 200_000
const LABELS = report_labels.JAPANESE_LABELS
const BUDGET_ONLY = 'backlogrun --max 5'

const CARRY: RunCarry = {
	invocation: 'backlogrun #11 #12 #13 #14 --only',
	started_at: AT,
	merged: 1,
	merged_issues: [11],
	done: [11, 13],
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

function input_of(overrides: Partial<HandoffInput>): HandoffInput {
	return {
		carry: CARRY,
		events: [event('merge', '#11 merged'), event('park', '#13 waiting on #99')],
		figures: { verdict: 'over', cost: COST, threshold: THRESHOLD },
		labels: LABELS,
		...overrides,
	}
}

describe('run_report_handoff.build_handoff', () => {
	it('fills every line of the hand-off report from the record and the cost figures', () => {
		expect(run_report_handoff.build_handoff(input_of({})).body).toBe(
			[
				'**■ 区切り**',
				'',
				'- **終わったこと**: #11',
				'- **残っていること**: #12, #14 (2) · park 済み: #13',
				'- **止めた理由**: `pnpm josh cost --cut` → over',
				'- **次に打つコマンド**: `backlogrun #11 #12 #13 #14 --only`',
				'',
				'**技術詳細**',
				'',
				`- 計測: ${String(COST)} / ${String(THRESHOLD)}`,
				'- 引き継ぎ: 状態は GitHub とラン記録にあり、会話には何も無い',
			].join('\n'),
		)
	})

	// `run:carry` resumes a record only when the typed invocation matches it exactly, so a command shrunk
	// to the remaining issues would be refused.
	it("names the record's own invocation as the resume command", () => {
		expect(run_report_handoff.build_handoff(input_of({})).resume).toBe(CARRY.invocation)
	})
})

describe('run_report_handoff.build_handoff at the edges', () => {
	it('says none rather than leaving the merged line empty', () => {
		const carry: RunCarry = { ...CARRY, merged: 0, merged_issues: [], done: [] }
		const { body } = run_report_handoff.build_handoff(input_of({ carry, events: [] }))

		expect(body).toContain(`- **終わったこと**: ${LABELS.handoff.none}`)
		expect(body).toContain('- **残っていること**: #11, #12, #13, #14 (4)\n')
	})

	it('names the pool for a budget-only invocation and keeps its budget', () => {
		const carry: RunCarry = { ...CARRY, invocation: BUDGET_ONLY, done: [11] }
		const handoff = run_report_handoff.build_handoff(input_of({ carry, events: [] }))

		expect(handoff.body).toContain('- **残っていること**: 残りの auto-ok プール\n')
		expect(handoff.resume).toBe(BUDGET_ONLY)
	})

	it('quotes the verdict where an unmeasurable session has no cost', () => {
		const figures = { verdict: 'unmeasurable' as const, cost: undefined, threshold: THRESHOLD }
		const { body } = run_report_handoff.build_handoff(input_of({ figures }))

		expect(body).toContain(`- 計測: unmeasurable / ${String(THRESHOLD)}`)
	})
})

describe('run_report_handoff.build_handoff labels and commands', () => {
	it('writes the labels in the session language', () => {
		const { body } = run_report_handoff.build_handoff(
			input_of({ labels: report_labels.ENGLISH_LABELS }),
		)

		expect(body).toContain('**■ Hand-off**')
		expect(body).toContain('- **Remaining**: #12, #14 (2) · parked: #13')
		expect(body).not.toContain('Cause')
	})

	it('names no resume command for an invocation that does not parse', () => {
		const carry: RunCarry = { ...CARRY, invocation: 'fullrun #11' }
		const handoff = run_report_handoff.build_handoff(input_of({ carry }))

		expect(handoff.resume).toBeUndefined()
		expect(handoff.body).toContain(`- **次に打つコマンド**: ${LABELS.handoff.none}`)
	})
})
