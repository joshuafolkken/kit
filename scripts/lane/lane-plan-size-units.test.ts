import type { OpenIssueData } from '#scripts/git/git-schemas'
import { split_assess } from '#scripts/split/split-assess'
import { describe, expect, it, vi } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#6635: `lane:plan` kept a new scripts module and split off its only importer, so the
// kept lane shipped a module no consumer entry reaches and `pack-boundary.test.ts` refused it. A new
// module and the planned file the base already holds count and split as one.

const ISSUE = 6635
const PLANNED_AT = '2026-11-07T00:00:00.000Z'
const MODULE = 'scripts/backlog/backlog-drive-rate-limit.ts'
const MODULE_TEST = 'scripts/backlog/backlog-drive-rate-limit.test.ts'
const IMPORTER = 'scripts/backlog/backlog-drive-cli.ts'
const OTHER = 'scripts/backlog/backlog-drive-other.ts'
const FILES_RATIO = 1.5
const SIGNALS: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	base_files: new Set([IMPORTER, OTHER]),
	files_ratio: FILES_RATIO,
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

function declared(file_count: number): Array<OpenIssueData> {
	const body = `## 背景\n\n- 規模見積もり: 約 ${String(file_count)} ファイル / 20 行（テスト除く）\n`

	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body }]
}

function oversize_of(paths: Array<string>, file_count = 1, signals = SIGNALS): unknown {
	const plan: LanePlan = { issue: ISSUE, paths, planned_at: PLANNED_AT }

	return lane_plan_size.oversize(plan, declared(file_count), undefined, signals)
}

// joshuafolkken/kit#6724: the split notice groups on the same units, so the two cannot drift.
describe('lane_plan_size.oversize grouping through the split notice', () => {
	it('groups the plan with split_assess.units_of', () => {
		const units_of = vi.spyOn(split_assess, 'units_of')

		oversize_of([MODULE, MODULE_TEST, IMPORTER])

		expect(units_of).toHaveBeenCalledWith([MODULE, IMPORTER], new Set([MODULE]))
		units_of.mockRestore()
	})
})

describe('lane_plan_size.oversize on a new scripts module', () => {
	it('does not split a new module from its importer when the importer is counted in the plan', () => {
		expect(oversize_of([MODULE, MODULE_TEST, IMPORTER])).toBeUndefined()
	})

	it('still splits on the pair alone without a base listing', () => {
		const unlisted = { ...SIGNALS, base_files: undefined }

		expect(oversize_of([MODULE, MODULE_TEST, IMPORTER], 1, unlisted)).toMatchObject({
			reason: 'files',
			split_off: [IMPORTER],
		})
	})

	it('keeps a new module beside its importer when another file is split off', () => {
		const added = 'scripts/backlog/backlog-drive-added.ts'

		expect(oversize_of([MODULE, IMPORTER, added])).toMatchObject({
			reason: 'files',
			kept: [MODULE, IMPORTER],
			split_off: [added],
		})
	})
})

describe('lane_plan_size.oversize pairing a new scripts module with its importer', () => {
	it('splits a new module off together with its importer when the importer comes later', () => {
		const document = 'docs/backlog-drive.md'

		expect(oversize_of([document, MODULE, IMPORTER])).toMatchObject({
			kept: [document],
			split_off: [MODULE, IMPORTER],
		})
	})

	it('pairs a new module with a planned file of its own directory, not an unrelated one listed first', () => {
		const unrelated = 'scripts/lane/lane-unrelated.ts'
		const listed = { ...SIGNALS, base_files: new Set([IMPORTER, unrelated]) }

		expect(oversize_of([unrelated, MODULE, IMPORTER], 1, listed)).toMatchObject({
			kept: [unrelated],
			split_off: [MODULE, IMPORTER],
		})
	})

	it('counts a new module with no planned importer as a file of its own', () => {
		const second = 'scripts/backlog/backlog-drive-second.ts'

		expect(oversize_of([MODULE, second, IMPORTER])).toMatchObject({
			kept: [MODULE, IMPORTER],
			split_off: [second],
		})
	})
})
