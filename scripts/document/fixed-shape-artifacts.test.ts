import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { issue_backlinks } from '#scripts/issue/issue-backlinks'
import { issue_lint } from '#scripts/issue/issue-lint'
import { report_lint } from '#scripts/report/report-lint'
import { describe, expect, it } from 'vitest'

// The four fixed-shape artifacts a run writes by hand each have a single-source document, and a
// linter now enforces the mechanical half of each (joshuafolkken/kit#2123). This pins that the
// linters' constants still appear in their single source, so the two cannot drift apart — the same
// guarantee `ai-document-pointers.test.ts` gives the rule bodies.

function read_repo_file(relative_path: string): string {
	return readFileSync(fileURLToPath(new URL(`../../${relative_path}`, import.meta.url)), 'utf8')
}

const REPORT_FORMAT = 'prompts/collaboration-workflow/report-format.md'
const ISSUE_TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
const OBSERVATION_FILING = '.claude/skills/workflow-commands/observation-filing.md'

describe('report:lint agrees with report-format.md', () => {
	const document = read_repo_file(REPORT_FORMAT)

	it.each(report_lint.REQUIRED_LABELS)('the document defines the label %s', (label) => {
		expect(document).toContain(label)
	})

	it('routes the mechanical half to the command', () => {
		expect(document).toContain('josh report:lint')
	})

	it.each(report_lint.CASE_VOCABULARY)('defines the first-tier case %s', (token) => {
		expect(document).toContain(token)
	})

	it('defines the two case-tier markers and the never-breaks escape', () => {
		expect(document).toContain(report_lint.CASE_LABEL)
		expect(document).toContain(report_lint.BREAK_LABEL)
		expect(document).toContain(report_lint.NO_BREAK_ESCAPE)
	})

	it('requires the second tier to hold the declared number of conditions', () => {
		expect(document).toContain(String(report_lint.MIN_BREAK_CONDITIONS))
	})

	it('adds the execution-evidence line to the completion report', () => {
		expect(document).toContain('実行証跡')
	})

	it('routes the boundary cases to the cases command', () => {
		expect(document).toContain('josh cases')
	})
})

describe('issue:lint agrees with issue-template.md', () => {
	const document = read_repo_file(ISSUE_TEMPLATE)

	it.each(issue_lint.REQUIRED_HEADINGS)('the template defines the heading %s', (heading) => {
		expect(document).toContain(heading)
	})
})

describe('issue:backlinks agrees with issue-template.md', () => {
	const document = read_repo_file(ISSUE_TEMPLATE)

	it.each([
		issue_backlinks.ORIGIN_HEADING,
		issue_backlinks.UPSTREAM_ISSUES_HEADING,
		issue_backlinks.UPSTREAM_CANDIDATE_HEADING,
	])('the template defines the backlink heading %s', (heading) => {
		expect(document).toContain(heading)
	})

	it('keeps the backlink headings out of report-format.md — one single source', () => {
		expect(read_repo_file(REPORT_FORMAT)).not.toContain(issue_backlinks.UPSTREAM_ISSUES_HEADING)
	})
})

describe('the observation ledger grammar agrees with observation-filing.md', () => {
	it('the document defines the five-field line grammar', () => {
		expect(read_repo_file(OBSERVATION_FILING)).toContain(
			'- k:<slug> | d<n> | <YYYY-MM-DD> | <where> | <what>',
		)
	})

	it('carries the user-found bug entry, keyed by the kind of miss at depth 1', () => {
		const document = read_repo_file(OBSERVATION_FILING)

		expect(document).toContain('user-found')
		expect(document).toContain('k:missed-')
		expect(document).toContain('d1')
	})
})
