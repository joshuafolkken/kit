import { repo_party } from '#scripts/discovery/repo-party'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_rework_candidates_cli } from './issue-rework-candidates-cli'
import { issue_search, type SearchIssue } from './issue-search'
import { rework_reference_state } from './rework-reference-state'

const NOW_MS = Date.parse('2026-11-23T00:00:00Z')
const MERGED_PR = 7963
const OPEN_ISSUE = 8770

function issue_of(number: number, cited: number): SearchIssue {
	return {
		number,
		title: `Issue ${String(number)}`,
		state: 'closed',
		body: `## 概要\n\n#${String(cited)} を手直しする。\n\n## 背景\n\n- 種別: 非不具合\n`,
		labels: ['enhancement'],
	}
}

function printed(): string {
	return vi.mocked(console.info).mock.calls.join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(repo_party, 'current_repository').mockReturnValue({ owner: 'o', repo: 'r' })
	vi.spyOn(rework_reference_state, 'delivered').mockResolvedValue(new Set([MERGED_PR]))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_rework_candidates_cli.run', () => {
	it('lists only the Issues reworking delivered work, with what they cite', async () => {
		vi.spyOn(issue_search, 'search_complete').mockResolvedValue({
			issues: [issue_of(1, MERGED_PR), issue_of(2, OPEN_ISSUE)],
			is_capped: false,
		})

		await expect(issue_rework_candidates_cli.run(['--since', '30'], NOW_MS)).resolves.toBe(0)
		expect(printed()).toMatch(new RegExp(String.raw`#1\b.*Issue 1.*→.*#${String(MERGED_PR)}`, 'u'))
		expect(printed()).not.toContain('Issue 2')
	})

	it('searches only enhancements closed inside the window', async () => {
		const search = vi
			.spyOn(issue_search, 'search_complete')
			.mockResolvedValue({ issues: [], is_capped: false })

		await issue_rework_candidates_cli.run(['--since', '30'], NOW_MS)

		expect(search.mock.calls[0]?.[0]).toContain('label:enhancement closed:>=2026-10-24')
	})

	it('fails when the search or the states cannot be read', async () => {
		vi.spyOn(issue_search, 'search_complete').mockResolvedValue(undefined)

		await expect(issue_rework_candidates_cli.run(['--since', '30'], NOW_MS)).resolves.toBe(1)
	})

	it('refuses a missing or non-numeric window', async () => {
		await expect(issue_rework_candidates_cli.run([], NOW_MS)).resolves.toBe(1)
		await expect(issue_rework_candidates_cli.run(['--since', 'x'], NOW_MS)).resolves.toBe(1)
	})
})
