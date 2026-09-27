import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const EXPECTED_COUNT = 275
const EXPECTED_EXCLUDED_PR_NUMBERS = [349, 352, 364, 379, 385, 531, 675, 756, 758, 763]
const AUDITS = [
	{
		issue: 2646,
		history_hash: '161a1f9c8df27034921ac5385671299006653182b4f89e5d47c226fca0f19ad2',
	},
	{
		issue: 2647,
		history_hash: 'c99da85278e3d90b86ebde878ae7580211760a0545e845e7439928c54f67a4ab',
	},
	{
		issue: 2648,
		history_hash: 'f6ec2428edccde04608818902bffce6ad1f11c79b2487b72ed1998851e46844b',
	},
]
const CATEGORY_COLUMN = 2
const FILES_COLUMN = 4
const REASON_COLUMN = 5
const EVIDENCE_COLUMN = 6
const COLUMN_COUNT = 8
const IGNORE_LABEL = 'ignore-for-release'
const OTHER_LABEL = 'other-change'
const BREAKING_LABEL = 'breaking-change'
const NO_ISSUE_MARKER = '元 Issue なし'
const CATEGORIES = new Set([BREAKING_LABEL, 'enhancement', 'bugfix', OTHER_LABEL, IGNORE_LABEL])

function read_audit(issue: number): Array<Array<string>> {
	return readFileSync(`docs/release-classification-audit-${String(issue)}.tsv`, 'utf8')
		.replace(/\n$/u, '')
		.split('\n')
		.map((line) => line.split('\t'))
}

for (const audit of AUDITS) {
	const [header, ...rows] = read_audit(audit.issue)

	describe(`release classification audit #${String(audit.issue)}`, () => {
		it('matches every first-parent PR and merge SHA in the bounded history', () => {
			const entries = rows
				.map((row) => ({ number: Number(row.at(0)), sha: row.at(1) ?? '' }))
				.toSorted((left, right) => left.number - right.number)
				.map((entry) => `${String(entry.number)} ${entry.sha}`)
			const digest = createHash('sha256')
				.update(`${entries.join('\n')}\n`)
				.digest('hex')

			expect(rows).toHaveLength(EXPECTED_COUNT)
			expect(new Set(entries).size).toBe(EXPECTED_COUNT)
			expect(new Set(rows.map((row) => row.at(0))).size).toBe(EXPECTED_COUNT)
			expect(digest).toBe(audit.history_hash)
		})

		it('records one supported classification and review evidence for every PR', () => {
			expect(header).toEqual([
				'pr',
				'merge_sha',
				'classification',
				'issues',
				'changed_files',
				'reason',
				'issue_evidence',
				'later_comment',
			])

			for (const row of rows) {
				expect(row).toHaveLength(COLUMN_COUNT)
				expect(CATEGORIES.has(row.at(CATEGORY_COLUMN) ?? '')).toBe(true)
				expect(row.at(FILES_COLUMN)).toBeTruthy()
				expect(row.at(REASON_COLUMN)).toBeTruthy()
				expect(row.at(EVIDENCE_COLUMN)).toBeTruthy()
			}
		})
	})
}

describe('release classification audit #2646 exceptions', () => {
	const rows = read_audit(2646).slice(1)

	it('identifies reverted changes and the PR whose linked issue describes another change', () => {
		const excluded = rows.filter((row) => row.at(CATEGORY_COLUMN) === IGNORE_LABEL)
		const mismatched_issue = rows.find((row) => row.at(0) === '297')

		expect(
			excluded.map((row) => Number(row.at(0))).toSorted((left, right) => left - right),
		).toEqual(EXPECTED_EXCLUDED_PR_NUMBERS)
		expect(excluded.every((row) => row.at(REASON_COLUMN)?.includes('PR #'))).toBe(true)
		expect(mismatched_issue?.at(REASON_COLUMN)).toContain('closes #295')
	})
})

describe('release classification audit #2647 exceptions', () => {
	const rows = read_audit(2647).slice(1)

	it('keeps the dependency update without an unrelated issue reference', () => {
		const update = rows.find((row) => row.at(0) === '815')

		expect(update?.at(CATEGORY_COLUMN)).toBe(OTHER_LABEL)
		expect(update?.at(3)).toBe('')
		expect(update?.at(EVIDENCE_COLUMN)).toContain(NO_ISSUE_MARKER)
	})
})

describe('release classification audit #2648 exceptions', () => {
	const rows = read_audit(2648).slice(1)
	const no_issue = rows.filter((row) => !row.at(3))

	it('records release and observation PRs without inventing linked issues', () => {
		expect(no_issue).toHaveLength(14)
		expect(no_issue.every((row) => row.at(EVIDENCE_COLUMN)?.includes(NO_ISSUE_MARKER))).toBe(true)
		expect(no_issue.find((row) => row.at(0) === '2104')?.at(CATEGORY_COLUMN)).toBe(OTHER_LABEL)
	})

	it('identifies removed public commands as breaking changes', () => {
		const breaking = rows.filter((row) => row.at(CATEGORY_COLUMN) === BREAKING_LABEL)

		expect(
			breaking.map((row) => Number(row.at(0))).toSorted((left, right) => left - right),
		).toEqual([1967, 1971, 1994, 1998, 2006, 2007, 2039, 2040])
	})
})
