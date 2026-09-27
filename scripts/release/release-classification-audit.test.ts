import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const AUDIT_PATH = 'docs/release-classification-audit-2646.tsv'
const EXPECTED_COUNT = 275
const EXPECTED_EXCLUDED_PR_NUMBERS = [349, 352, 364, 379, 385, 531, 675, 756, 758, 763]
const EXPECTED_HISTORY_HASH = '161a1f9c8df27034921ac5385671299006653182b4f89e5d47c226fca0f19ad2'
const CATEGORY_COLUMN = 2
const FILES_COLUMN = 4
const REASON_COLUMN = 5
const EVIDENCE_COLUMN = 6
const COLUMN_COUNT = 8
const IGNORE_LABEL = 'ignore-for-release'
const CATEGORIES = new Set([
	'breaking-change',
	'enhancement',
	'bugfix',
	'other-change',
	IGNORE_LABEL,
])

const lines = readFileSync(AUDIT_PATH, 'utf8').trimEnd().split('\n')
const rows = lines.slice(1).map((line) => line.split('\t'))

describe('release classification audit #2646', () => {
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
		expect(digest).toBe(EXPECTED_HISTORY_HASH)
	})

	it('records one supported classification and review evidence for every PR', () => {
		expect(lines[0]).toBe(
			'pr\tmerge_sha\tclassification\tissues\tchanged_files\treason\tissue_evidence\tlater_comment',
		)

		for (const row of rows) {
			expect(row).toHaveLength(COLUMN_COUNT)
			expect(CATEGORIES.has(row.at(CATEGORY_COLUMN) ?? '')).toBe(true)
			expect(row.at(FILES_COLUMN)).toBeTruthy()
			expect(row.at(REASON_COLUMN)).toBeTruthy()
			expect(row.at(EVIDENCE_COLUMN)).toBeTruthy()
		}
	})

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
