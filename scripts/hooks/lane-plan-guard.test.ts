import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_plan } from '#scripts/lane/lane-plan'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan_guard } from './lane-plan-guard'

// joshuafolkken/kit#4864: a dispatched lane child's first runtime edit waits for its recorded plan.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-guard-'))
const ISSUE = '4864'
const LANE = path.join(ROOT, '.kit-lanes', ISSUE)
const CHILD = { JOSH_LANE_CHILD: ISSUE }
const RUNTIME_FILE = 'scripts/lane/lane-overrun.ts'
const DOC_FILE = 'docs/why.md'
const PLAN = { issue: Number(ISSUE), paths: [RUNTIME_FILE], planned_at: '2026-10-25T03:10:00Z' }

function edit_of(file_path: string): string {
	const transcript_path = path.join(ROOT, 'transcript.jsonl')

	return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path }, transcript_path })
}

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('lane_plan_guard.reason', () => {
	it("refuses a lane child's runtime edit before its plan is recorded", () => {
		const reason = lane_plan_guard.reason(edit_of(RUNTIME_FILE), LANE, CHILD)

		expect(reason).toContain(`pnpm josh lane:plan ${ISSUE}`)
	})

	// The review of #4864: the plan is recorded before `lane:plan` checks, so a `wait` lifted the hold;
	// joshuafolkken/kit#4926: a `yield` ends the session instead of polling.
	it('keeps refusing while the recorded plan is uncleared, naming the yield', () => {
		lane_plan.record(PLAN, LANE)

		expect(lane_plan_guard.reason(edit_of(RUNTIME_FILE), LANE, CHILD)).toContain('on `yield` end')
	})

	it('lets the edit through once the plan is cleared', () => {
		lane_plan.record({ ...PLAN, cleared: true }, LANE)

		expect(lane_plan_guard.reason(edit_of(RUNTIME_FILE), LANE, CHILD)).toBeUndefined()
	})

	it('stays silent on a document edit', () => {
		expect(lane_plan_guard.reason(edit_of(DOC_FILE), LANE, CHILD)).toBeUndefined()
	})

	it('stays silent in a session that is not the dispatched lane child', () => {
		expect(lane_plan_guard.reason(edit_of(RUNTIME_FILE), LANE, {})).toBeUndefined()
		expect(
			lane_plan_guard.reason(edit_of(RUNTIME_FILE), LANE, { JOSH_LANE_CHILD: '4858' }),
		).toBeUndefined()
	})
})
