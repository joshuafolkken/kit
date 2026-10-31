import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_size, type Oversize } from './lane-plan-size'

// joshuafolkken/kit#5533: two lanes declared at 4 files planned 9 and shipped 16 and 18. A plan past twice
// its declaration is refused with the split it should take; an Issue with no declaration never is.

const ISSUE = 5533
const DECLARED_BODY = '## 背景\n\n- 規模見積もり: 約 4 ファイル / 70 行（テスト除く）\n'
const PLANNED_AT = '2026-10-31T00:00:00.000Z'
const TEST_FILE = 'scripts/lane/lane-plan-size.test.ts'

function issue_with(body: string): Array<OpenIssueData> {
	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body }]
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

	return lane_plan_size.oversize(plan_of(paths), issues, held)
}

describe('lane_plan_size.oversize', () => {
	it('passes an eighth file against a declaration of 4 files', () => {
		expect(oversize_of(files(8))).toBeUndefined()
	})

	it('refuses a ninth file against a declaration of 4 files', () => {
		expect(oversize_of(files(9))).toMatchObject({
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
		[
			'an Issue declaring 0 files',
			issue_with('## 背景\n\n- 規模見積もり: 約 0 ファイル / 0 行（テスト除く）\n'),
		],
	])('never refuses %s', (_label, issues) => {
		expect(oversize_of(files(20), issues)).toBeUndefined()
	})

	it('keeps the files the recorded plan held and splits off the ones added since', () => {
		const added = 'scripts/lane/added.ts'
		const over = oversize_of([added, ...files(8)], issue_with(DECLARED_BODY), files(8))

		expect(over?.kept).toStrictEqual(files(8))
		expect(over?.split_off).toStrictEqual([added])
	})
})

describe('lane_plan_size.refusal_text', () => {
	it('names the split-off files, the `--route split` filing and the replan on the kept files', () => {
		const over = oversize_of([...files(9), TEST_FILE])
		const text = over === undefined ? '' : lane_plan_size.refusal_text(ISSUE, over)

		expect(text).toContain('Split off: scripts/lane/file-9.ts')
		expect(text).toContain('pnpm josh issue:file "<title>" --body-file <body.md> --route split')
		expect(text).toContain(
			`pnpm josh lane:plan ${String(ISSUE)} ${files(8).join(' ')} ${TEST_FILE}`,
		)
		expect(text).toContain('split-assessment.md → "The question"')
	})
})
