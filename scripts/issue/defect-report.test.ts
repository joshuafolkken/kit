import { describe, expect, it } from 'vitest'
import { defect_report, type OriginPr, type PrFile, type ReportIssue } from './defect-report'

const RUN_AREA = 'scripts/run'
const LANE_AREA = 'scripts/lane'
const UNREAD = '(pull request not read)'
const SOURCE = 'scripts/a/a.ts'
const ADDED = 'added'
const REMOVE = 'remove'
const BUG_BODY = '## 背景\n\n- 種別: 不具合\n'
const EARLY = '2026-10-02T00:00:00Z'
const ADDING_ORIGIN = '- 原因: #4201'

function file(filename: string, status: string, additions = 1, deletions = 0): PrFile {
	return { filename, status, additions, deletions }
}

function bug(number: number, created_at: string, origin: string): ReportIssue {
	return { number, created_at, body: `${BUG_BODY}${origin}\n` }
}

const ADDING: OriginPr = {
	pr: 4201,
	merged_at: '2026-10-10T00:00:00Z',
	kind: 'add',
	areas: [RUN_AREA],
}
const FIXING: OriginPr = {
	pr: 4150,
	merged_at: '2026-10-01T00:00:00Z',
	kind: 'fix',
	areas: [RUN_AREA, LANE_AREA],
}
const ISSUES = [
	bug(1, '2026-10-12T00:00:00Z', ADDING_ORIGIN),
	bug(2, '2026-10-30T00:00:00Z', ADDING_ORIGIN),
	bug(3, EARLY, '- 原因: #4150'),
	bug(4, EARLY, '- 原因: #9999'),
	bug(5, EARLY, '- 原因: 不明（追えない）'),
	{ number: 6, created_at: EARLY, body: BUG_BODY },
]
const PRS = new Map([
	[ADDING.pr, ADDING],
	[FIXING.pr, FIXING],
])

describe('defect:report change kind and area', () => {
	it.each([
		{ files: [file('scripts/a/new.ts', ADDED)], kind: 'add' },
		{
			files: [file('scripts/a/a.test.ts', ADDED), file(SOURCE, 'modified')],
			kind: 'fix',
		},
		{ files: [file(SOURCE, 'modified', 1, 40)], kind: REMOVE },
		{ files: [file(SOURCE, 'removed', 0, 40)], kind: REMOVE },
		{
			files: [file('.josh/metrics-accepted/4300.json', ADDED), file(SOURCE, 'modified')],
			kind: 'fix',
		},
	])('reads $kind off the changed files', ({ files, kind }) => {
		expect(defect_report.change_kind(files)).toBe(kind)
	})

	it('leaves the run records out of the areas a pull request touched', () => {
		const files = [file('.josh/observations/4300.json', ADDED), file(SOURCE, 'modified')]

		expect(defect_report.areas(files)).toEqual(['scripts/a'])
	})

	it.each([
		['scripts/run/board/run-board.ts', RUN_AREA],
		['scripts/josh.ts', 'scripts'],
		['prompts/review.md', 'prompts'],
		['package.json', '(root)'],
	])('places %s in %s', (filename, area) => {
		expect(defect_report.area_of(filename)).toBe(area)
	})
})

describe('defect:report aggregation', () => {
	const report = defect_report.aggregate(ISSUES, PRS)

	it('counts defects per origin pull request, change kind and area', () => {
		expect(report.by_pr).toEqual(
			new Map([
				[4201, 2],
				[4150, 1],
				[9999, 1],
			]),
		)
		expect(report.by_kind).toEqual(
			new Map([
				['add', 2],
				['fix', 1],
				[UNREAD, 1],
			]),
		)
		expect(report.by_area).toEqual(
			new Map([
				[RUN_AREA, 3],
				[LANE_AREA, 1],
				[UNREAD, 1],
			]),
		)
	})

	it('counts unknown and undeclared origins apart', () => {
		expect(report.unknown).toBe(1)
		expect(report.undeclared).toBe(1)
	})

	it('counts the defects filed within a week of a mechanism-adding merge', () => {
		expect(report.added_within_week).toEqual(new Map([[4201, 1]]))
	})
})

describe('defect:report origin pull requests', () => {
	it('lists each origin pull request once', () => {
		expect(defect_report.origin_prs(ISSUES)).toEqual([4201, 4150, 9999])
	})
})
