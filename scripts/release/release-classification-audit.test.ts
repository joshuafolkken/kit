import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const EXPECTED_COUNT = 275
const OTHER_LABEL = 'other-change'
const EXPECTED_TOTAL = 1104
const EXPECTED_HISTORY_HASH = '4bfb0abe08e5ff7e6c5a8afeb31f67b529c51b71f740524bb2be52792c525a7c'
const EXPECTED_CATEGORIES = {
	'breaking-change': 14,
	enhancement: 458,
	bugfix: 413,
	[OTHER_LABEL]: 208,
	'ignore-for-release': 11,
}
const ADDITIONAL_MERGES = [
	{ number: 2650, sha: '0683a385fe14164dca37c7a71f4e877c8005530e', category: OTHER_LABEL },
	{ number: 2651, sha: '8738742abd4dee95f4c94fda977f52b884da3c94', category: OTHER_LABEL },
	{ number: 2652, sha: 'df7f1dbb1e23ef154a99e20449086dcb43634c29', category: OTHER_LABEL },
	{ number: 2657, sha: '01eb8610556d27a5a0f60726d133561916dba9b3', category: OTHER_LABEL },
]
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
	{
		issue: 2649,
		history_hash: 'b4d6b9e1739743805946cc91fb8e3b8df76571a01b202f03f3378ef5de60c5b8',
	},
]
const CATEGORY_COLUMN = 2
const FILES_COLUMN = 4
const REASON_COLUMN = 5
const EVIDENCE_COLUMN = 6
const COLUMN_COUNT = 8
const IGNORE_LABEL = 'ignore-for-release'
const BREAKING_LABEL = 'breaking-change'
const NO_ISSUE_MARKER = '元 Issue なし'
const CATEGORIES = new Set([BREAKING_LABEL, 'enhancement', 'bugfix', OTHER_LABEL, IGNORE_LABEL])

function read_audit(issue: number): Array<Array<string>> {
	return readFileSync(`docs/maintainers/release-classification-audit-${String(issue)}.tsv`, 'utf8')
		.replace(/\n$/u, '')
		.split('\n')
		.map((line) => line.split('\t'))
}

const COMBINED_ROWS = AUDITS.flatMap((audit) => read_audit(audit.issue).slice(1))
const COMBINED_MERGES = [
	...COMBINED_ROWS.map((row) => ({ number: Number(row.at(0)), sha: row.at(1) ?? '' })),
	...ADDITIONAL_MERGES,
]

it('covers the complete bounded first-parent merge history once', () => {
	const entries = COMBINED_MERGES.toSorted((left, right) => left.number - right.number)
	const digest = createHash('sha256')
		.update(`${entries.map((entry) => [entry.number, entry.sha].join(' ')).join('\n')}\n`)
		.digest('hex')

	expect(entries).toHaveLength(EXPECTED_TOTAL)
	expect(new Set(entries.map((entry) => entry.number)).size).toBe(EXPECTED_TOTAL)
	expect(digest).toBe(EXPECTED_HISTORY_HASH)
})

it('matches the recorded categories and release-notes preview', () => {
	const categories = [
		...COMBINED_ROWS.map((row) => row.at(CATEGORY_COLUMN)),
		...ADDITIONAL_MERGES.map((merge) => merge.category),
	]
	const counts = Object.fromEntries(
		Object.keys(EXPECTED_CATEGORIES).map((category) => [
			category,
			categories.filter((value) => value === category).length,
		]),
	)

	expect(counts).toEqual(EXPECTED_CATEGORIES)
	expect(categories.length - (counts[IGNORE_LABEL] ?? 0)).toBe(1093)
})

it('keeps the published summary in sync with the audit', () => {
	const report = readFileSync(
		'docs/maintainers/release-classification-audit.md',
		'utf8',
	).replaceAll(/\s+/gu, ' ')

	for (const [category, count] of Object.entries(EXPECTED_CATEGORIES)) {
		const release_count = category === IGNORE_LABEL ? 0 : count

		expect(report).toContain(`(\`${category}\`) | ${String(count)} | ${String(release_count)} |`)
	}

	expect(report).toContain('| 合計 | 1,104 | 1,093 |')
})

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
				if (audit.issue !== 2649 || row.at(0) !== '2520') expect(row.at(FILES_COLUMN)).toBeTruthy()
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
		expect(excluded.every((row) => Boolean(row.at(FILES_COLUMN)))).toBe(true)
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

describe('release classification audit #2649 exceptions', () => {
	const rows = read_audit(2649).slice(1)

	it('excludes the merge with no first-parent changes', () => {
		const excluded = rows.filter((row) => row.at(CATEGORY_COLUMN) === IGNORE_LABEL)

		expect(excluded.map((row) => row.at(0))).toEqual(['2520'])
		expect(excluded[0]?.at(FILES_COLUMN)).toBe('')
		expect(excluded[0]?.at(REASON_COLUMN)).toContain('差分が空')
	})

	it('records issue-free automated PRs and consumer-facing breaking changes', () => {
		const no_issue = rows.filter((row) => !row.at(3))
		const breaking = rows.filter((row) => row.at(CATEGORY_COLUMN) === BREAKING_LABEL)

		expect(no_issue).toHaveLength(59)
		expect(no_issue.every((row) => row.at(EVIDENCE_COLUMN)?.includes(NO_ISSUE_MARKER))).toBe(true)
		expect(breaking.map((row) => row.at(0))).toEqual(['2635', '2576'])
	})
})
