import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_new_files } from './lane-plan-new-files'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#8120: #7974 declared 8 files / 170 lines, planned two new modules and shipped 433
// lines; the lines axis read the declaration times the ratio alone and let the plan start within the cap.

const ISSUE = 7974
const PLANNED_AT = '2026-11-18T00:00:00.000Z'
const DECLARED_FILES = 8
const DECLARED_LINES = 170
const BASE = Array.from(
	{ length: DECLARED_FILES - 2 },
	(_, index) => `docs/base-${String(index)}.md`,
)
const NEW_FILES = ['scripts/issue/issue-kind-cli.ts', 'scripts/issue/issue-declaration-line.ts']
const SIGNALS: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	base_files: new Set(BASE),
	lines_ratio: 1,
	implement_rate: undefined,
	split_filed: false,
}

function declared(): Array<OpenIssueData> {
	const body = `## 背景\n\n- 規模見積もり: 約 ${String(DECLARED_FILES)} ファイル / ${String(DECLARED_LINES)} 行（テスト除く）\n`

	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body }]
}

function plan_of(paths: Array<string>): LanePlan {
	return { issue: ISSUE, paths, planned_at: PLANNED_AT }
}

function oversize_of(paths: Array<string>, signals = SIGNALS): Oversize | undefined {
	return lane_plan_size.oversize(plan_of(paths), declared(), undefined, signals)
}

describe('lane_plan_size.oversize floored by the plan new files', () => {
	it('passes the #7974 shape without its new files, as before', () => {
		expect(oversize_of(BASE)).toBeUndefined()
	})

	it('answers lines past the cap for the #7974 shape with two new files', () => {
		const paths = [...BASE, ...NEW_FILES]
		const over = oversize_of(paths)
		const floor = lane_plan_new_files.floor_lines(NEW_FILES.length)

		expect(over).toMatchObject({ reason: 'lines', measured: floor, new_files: NEW_FILES.length })
		expect(over && lane_plan_size.is_past_cap(plan_of(paths), over)).toBe(true)
	})

	it('names the new files in the refusal', () => {
		const over = oversize_of([...BASE, ...NEW_FILES])

		expect(over && lane_plan_size.refusal_text(ISSUE, over)).toContain('2 new file(s) floor it')
	})

	it('does not count new test files or directory claims', () => {
		const paths = [...BASE, 'scripts/issue/issue-kind-cli.test.ts', 'scripts/issue/new/']

		expect(oversize_of(paths)).toBeUndefined()
	})

	it('reads no file as new without a base listing', () => {
		const unlisted = { ...SIGNALS, base_files: undefined }

		expect(oversize_of([...BASE, ...NEW_FILES], unlisted)).toBeUndefined()
	})

	it('keeps the grown declaration when it passes the floor', () => {
		const grown = { ...SIGNALS, lines_ratio: 2 }

		expect(oversize_of([...BASE, NEW_FILES[0] ?? ''], grown)).toMatchObject({
			reason: 'lines',
			measured: DECLARED_LINES * 2,
		})
	})
})
