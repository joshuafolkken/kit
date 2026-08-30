import { describe, expect, it, vi } from 'vitest'
import { listing_of, listing_outcome } from './git-gh-issue-list-fixture'
import { git_next_issues } from './git-next-issues'
import type { OpenIssueData } from './schemas'

vi.mock('./git-gh-command', () => ({
	git_gh_command: { issue_list_recent: vi.fn() },
}))

const { git_gh_command } = await import('./git-gh-command')
const issue_list_recent = vi.mocked(git_gh_command.issue_list_recent)

const HEADER = '🗒 Next issues (newest first):'
const DISPLAY_LIMIT = 5
const OVER_LIMIT_COUNT = 8
const CREATED_EARLIER = '2026-08-01T00:00:00Z'
const CREATED_LATER = '2026-08-02T00:00:00Z'
const CREATED_LATEST = '2026-08-03T00:00:00Z'
const EXCLUDED_LABEL_SPELLINGS: ReadonlyArray<string> = [
	'epic',
	'Epic',
	'in-progress',
	'In-Progress',
	// An `epicrun` parks a child here when it needs a decision; proposing it as the next run would
	// propose work that cannot finish (joshuafolkken/kit#861).
	'needs-decision',
	'Needs-Decision',
]

function issue(
	number: number,
	created_at: string,
	labels: ReadonlyArray<string> = [],
): OpenIssueData {
	return {
		number,
		title: `Issue ${String(number)}`,
		labels: labels.map((name) => ({ name })),
		createdAt: created_at,
	}
}

function prioritized_numbers(
	issues: ReadonlyArray<OpenIssueData>,
	completed_issue_number?: number,
): Array<number> {
	return git_next_issues.prioritize(issues, completed_issue_number).map((entry) => entry.number)
}

describe('git_next_issues.prioritize - ordering', () => {
	it('sorts newest first', () => {
		const issues = [issue(1, CREATED_EARLIER), issue(3, CREATED_LATEST), issue(2, CREATED_LATER)]

		expect(prioritized_numbers(issues)).toEqual([3, 2, 1])
	})

	// Two issues created in one `josh epic` batch can share a timestamp to the second.
	it('breaks a creation-time tie by the higher issue number', () => {
		const issues = [issue(10, CREATED_EARLIER), issue(11, CREATED_EARLIER)]

		expect(prioritized_numbers(issues)).toEqual([11, 10])
	})

	it('caps the result at five', () => {
		const issues = Array.from({ length: OVER_LIMIT_COUNT }, (_, index) =>
			issue(index + 1, `2026-08-0${String(index + 1)}T00:00:00Z`),
		)

		expect(git_next_issues.prioritize(issues)).toHaveLength(DISPLAY_LIMIT)
	})
})

describe('git_next_issues.prioritize - exclusions', () => {
	// An epic tracks a batch and is never run directly (`queue` receives child issues only), and an
	// in-progress issue is already claimed. The mixed casing covers repos whose label predates the
	// scripts: GitHub keeps the casing a label was created with.
	it.each(EXCLUDED_LABEL_SPELLINGS)('excludes issues labeled %j', (label) => {
		const issues = [issue(1, CREATED_EARLIER), issue(2, CREATED_LATER, [label])]

		expect(prioritized_numbers(issues)).toEqual([1])
	})

	// GitHub applies the `closes #N` side effect asynchronously, so right after the merge the
	// completed issue can still be listed as open.
	it('excludes the just-completed issue by number', () => {
		const issues = [issue(1, CREATED_EARLIER), issue(2, CREATED_LATER)]

		expect(prioritized_numbers(issues, 2)).toEqual([1])
	})

	it('keeps issues with unrelated labels', () => {
		const issues = [issue(1, CREATED_EARLIER, ['bug'])]

		expect(git_next_issues.prioritize(issues)).toHaveLength(1)
	})
})

describe('git_next_issues.format_lines', () => {
	it('renders a header and one numbered row per issue', () => {
		const issues = [issue(9, CREATED_EARLIER), issue(7, CREATED_LATER)]

		expect(git_next_issues.format_lines(issues)).toEqual([
			HEADER,
			'  1. #9 Issue 9',
			'  2. #7 Issue 7',
		])
	})

	// A bare header with nothing under it reads as an error.
	it('renders nothing when there are no issues', () => {
		expect(git_next_issues.format_lines([])).toEqual([])
	})
})

describe('git_next_issues.fetch_next_issue_lines', () => {
	it('fetches, prioritizes and formats', async () => {
		issue_list_recent.mockResolvedValueOnce(
			listing_of([issue(1, CREATED_EARLIER), issue(2, CREATED_LATER)]),
		)

		expect(await git_next_issues.fetch_next_issue_lines()).toEqual([
			HEADER,
			'  1. #2 Issue 2',
			'  2. #1 Issue 1',
		])
	})

	it('returns no lines when gh is unavailable', async () => {
		issue_list_recent.mockResolvedValueOnce(listing_outcome(undefined))

		expect(await git_next_issues.fetch_next_issue_lines()).toEqual([])
	})

	// The never-throw contract is local to this function, not delegated to the fetcher's own catch.
	it('returns no lines when the fetch itself rejects', async () => {
		issue_list_recent.mockRejectedValueOnce(new Error('gh exploded'))

		expect(await git_next_issues.fetch_next_issue_lines()).toEqual([])
	})

	it('returns no lines on malformed JSON', async () => {
		issue_list_recent.mockResolvedValueOnce(listing_outcome('not json'))

		expect(await git_next_issues.fetch_next_issue_lines()).toEqual([])
	})

	// This runs after the merge has already succeeded — an unexpected `gh` output shape must not
	// make a completed workflow look failed over a purely informational display.
	it('returns no lines when the payload shape is unexpected', async () => {
		issue_list_recent.mockResolvedValueOnce(listing_of([{ unexpected: true }]))

		expect(await git_next_issues.fetch_next_issue_lines()).toEqual([])
	})
})
