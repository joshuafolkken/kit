import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#5533: two lanes declared at 4 files planned 9 and shipped 16 and 18. A plan past twice
// its declaration is refused with the split it should take; an Issue with no declaration never is.
// joshuafolkken/kit#5568: the probed hunks and the projected lines answer `split` too, with their reason.

const ISSUE = 5533
const DECLARED_BODY = '## 背景\n\n- 規模見積もり: 約 4 ファイル / 70 行（テスト除く）\n'
const PLANNED_AT = '2026-10-31T00:00:00.000Z'
const TEST_FILE = 'scripts/lane/lane-plan-size.test.ts'
const UNPLANNED = 'scripts/lane/unplanned.ts'
const QUIET: PlanSignals = { hunk_files: [], lines_ratio: undefined, split_filed: false }

// `count` probed hunks, all in `file`.
function hunks(count: number, file = UNPLANNED): Pick<PlanSignals, 'hunk_files'> {
	return { hunk_files: Array.from({ length: count }, () => file) }
}

function issue_with(body: string): Array<OpenIssueData> {
	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body }]
}

function declared(file_count: number, line_count: number): Array<OpenIssueData> {
	return issue_with(
		`## 背景\n\n- 規模見積もり: 約 ${String(file_count)} ファイル / ${String(line_count)} 行（テスト除く）\n`,
	)
}

function files(count: number): Array<string> {
	return Array.from({ length: count }, (_, index) => `scripts/lane/file-${String(index + 1)}.ts`)
}

function plan_of(paths: ReadonlyArray<string>): LanePlan {
	return { issue: ISSUE, paths: [...paths], planned_at: PLANNED_AT }
}

function oversize_of(
	paths: ReadonlyArray<string>,
	issues: ReadonlyArray<OpenIssueData> = issue_with(DECLARED_BODY),
	recorded?: ReadonlyArray<string>,
): Oversize | undefined {
	const held = recorded === undefined ? undefined : plan_of(recorded)

	return lane_plan_size.oversize(plan_of(paths), issues, held, QUIET)
}

function signalled(
	issues: ReadonlyArray<OpenIssueData>,
	signals: Partial<PlanSignals>,
): Oversize | undefined {
	return lane_plan_size.oversize(plan_of(files(1)), issues, undefined, { ...QUIET, ...signals })
}

function replanned(
	issues: ReadonlyArray<OpenIssueData>,
	signals: Partial<PlanSignals>,
	is_cleared = true,
): Oversize | undefined {
	const recorded = { ...plan_of(files(1)), cleared: is_cleared }

	return lane_plan_size.oversize(plan_of(files(2)), issues, recorded, { ...QUIET, ...signals })
}

function text_of(over: Oversize | undefined): string {
	return over === undefined ? '' : lane_plan_size.refusal_text(ISSUE, over)
}

describe('lane_plan_size.oversize', () => {
	it('passes an eighth file against a declaration of 4 files', () => {
		expect(oversize_of(files(8))).toBeUndefined()
	})

	it('refuses a ninth file against a declaration of 4 files', () => {
		expect(oversize_of(files(9))).toMatchObject({
			reason: 'files',
			declared: 4,
			limit: 8,
			split_off: ['scripts/lane/file-9.ts'],
		})
	})

	it('does not count test files toward the bar', () => {
		expect(oversize_of([...files(8), TEST_FILE])).toBeUndefined()
	})

	it.each([
		['an Issue with no declaration (an epic)', issue_with('## 背景\n\n- 種別: 非不具合\n')],
		['an Issue missing from the listing', []],
		['an Issue declaring 0 files', declared(0, 0)],
	])('never refuses %s', (_label, issues) => {
		expect(oversize_of(files(20), issues)).toBeUndefined()
	})

	it('keeps the files the recorded plan held and splits off the ones added since', () => {
		const added = 'scripts/lane/added.ts'
		const over = oversize_of([added, ...files(8)], issue_with(DECLARED_BODY), files(8))

		expect(over).toMatchObject({ kept: files(8), split_off: [added] })
	})
})

describe('lane_plan_size.oversize on the hunks and lines axes', () => {
	it('answers hunks for 17 probed hunks against a declaration of 8 files', () => {
		expect(signalled(declared(8, 100), hunks(17))).toMatchObject({
			reason: 'hunks',
			limit: 16,
			measured: 17,
		})
	})

	it('passes 16 probed hunks against a declaration of 8 files', () => {
		expect(signalled(declared(8, 100), hunks(16))).toBeUndefined()
	})

	it('answers lines for 200 declared lines at a ratio of 1.8', () => {
		expect(signalled(declared(4, 200), { lines_ratio: 1.8 })).toMatchObject({
			reason: 'lines',
			measured: 360,
		})
	})

	it('does not answer for 100 declared lines at a ratio of 1.8', () => {
		expect(signalled(declared(4, 100), { lines_ratio: 1.8 })).toBeUndefined()
	})

	it('projects with the default ratio when the period has none', () => {
		expect(signalled(declared(4, 120), {})).toMatchObject({ reason: 'lines', measured: 216 })
	})

	it('stands the lines axis down once the lane filed a split child', () => {
		expect(signalled(declared(4, 200), { split_filed: true })).toBeUndefined()
	})

	it('stands the hunks axis down once the lane filed a split child', () => {
		expect(signalled(declared(8, 100), { ...hunks(17), split_filed: true })).toBeUndefined()
	})
})

// joshuafolkken/kit#5600: a cleared plan's declaration was judged when it cleared, so its re-plan skips the lines axis.
describe('lane_plan_size.oversize on a re-plan of a recorded plan', () => {
	it('skips the lines axis for a cleared plan', () => {
		expect(replanned(declared(4, 200), { lines_ratio: 1.8 })).toBeUndefined()
	})

	it('still answers lines for a yielded plan that never cleared', () => {
		expect(replanned(declared(4, 200), { lines_ratio: 1.8 }, false)).toMatchObject({
			reason: 'lines',
		})
	})

	// joshuafolkken/kit#5605: a plan recorded `sized` before an unread listing or a yield met the bar too.
	it('skips the lines axis for a sized plan that never cleared', () => {
		const recorded = { ...plan_of(files(1)), sized: true }
		const signals = { ...QUIET, lines_ratio: 1.8 }
		const plan = plan_of(files(2))

		expect(lane_plan_size.oversize(plan, declared(4, 200), recorded, signals)).toBeUndefined()
	})

	it('still answers hunks for a cleared plan', () => {
		expect(replanned(declared(8, 100), hunks(17))).toMatchObject({ reason: 'hunks' })
	})
})

// joshuafolkken/kit#5601: the recorded plan's files passed the files axis, so their hunks do not count again.
describe('lane_plan_size.oversize on the hunks of a re-plan', () => {
	const planned = files(1)[0] ?? ''

	it('passes 3 hunks inside the one planned file of a 1-file declaration', () => {
		expect(replanned(declared(1, 15), hunks(3, planned))).toBeUndefined()
	})

	it('still answers hunks for 3 hunks in a code file outside the plan', () => {
		expect(
			replanned(declared(1, 15), { hunk_files: [planned, UNPLANNED, UNPLANNED, UNPLANNED] }),
		).toMatchObject({ reason: 'hunks', limit: 2, measured: 3 })
	})

	it('passes 3 hunks under a directory the recorded plan claims', () => {
		const directory = 'scripts/lane/'
		const recorded = plan_of([directory])
		const signals = { ...QUIET, ...hunks(3) }
		const plan = plan_of([directory, 'docs/x.md'])

		expect(lane_plan_size.oversize(plan, declared(1, 15), recorded, signals)).toBeUndefined()
	})
})

describe('lane_plan_size.refusal_text', () => {
	it.each([
		['hunks', hunks(17), "17 hunks outside the recorded plan's files (tests excluded), over 16"],
		['lines', { lines_ratio: 1.8 }, 'about 360'],
	])('names the %s axis and its measure', (reason, signals, measure) => {
		const text = text_of(signalled(declared(8, 200), signals))

		expect(text).toContain(`split (${reason})`)
		expect(text).toContain(measure)
		expect(text).toContain('--route split')
	})

	it('names the split-off files, the `--route split` filing and the replan on the kept files', () => {
		const text = text_of(oversize_of([...files(9), TEST_FILE]))

		expect(text).toContain('Split off: scripts/lane/file-9.ts')
		expect(text).toContain('pnpm josh issue:file "<title>" --body-file <body.md> --route split')
		expect(text).toContain(
			`pnpm josh lane:plan ${String(ISSUE)} ${files(8).join(' ')} ${TEST_FILE}`,
		)
		expect(text).toContain('split-assessment.md → "The question"')
	})
})
