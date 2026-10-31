import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { issue_lint_cli } from '#scripts/issue/issue-lint-cli'
import { describe, expect, it } from 'vitest'
import { disposition_batch, type BatchFinding } from './disposition-batch'
import { disposition_batch_filing } from './disposition-batch-filing'

// joshuafolkken/kit#5583: `disposition --batch` drafts each file-routed finding's body and prints the
// `issue:file` line that files it.

const ISSUE = 5583
const FINDING_LINE =
	'confirmed bug-risks:medium:scripts/foo.ts:12 — a null deref when the list is empty'

const SECURITY_LINE = 'confirmed security:medium:scripts/foo.ts:12 — a token reaches the log'
const DROPPED_LINE = 'comments:low:.editorconfig — a stale comment'
const FOUND_DURING_FLAG = '--found-during'

function finding(line: string = FINDING_LINE): BatchFinding {
	const result = disposition_batch.parse(line)
	const [first] = 'findings' in result ? result.findings : []

	if (first === undefined) throw new Error('fixture did not parse')

	return first
}

function temporary_directory(): string {
	return mkdtempSync(path.join(tmpdir(), 'disposition-filing-'))
}

function drafted(): { body_path: string; command: string } {
	const [filing] = disposition_batch_filing.write_filings([finding()], ISSUE, temporary_directory())

	if (filing === undefined) throw new Error('no filing written')

	return {
		body_path: filing.body_path,
		command: disposition_batch_filing.command_of(filing, ISSUE),
	}
}

describe('disposition_batch_filing.body_of', () => {
	it('passes issue:lint', () => {
		const body = disposition_batch_filing.body_of(finding(), ISSUE)

		expect(issue_lint_cli.problems(body)).toEqual([])
	})

	it('names the parent issue and the finding', () => {
		const body = disposition_batch_filing.body_of(finding(), ISSUE)

		expect(body.startsWith(`parent: #${String(ISSUE)}\n`)).toBe(true)
		expect(body).toContain('a null deref when the list is empty')
	})
})

describe('disposition_batch_filing.write_filings', () => {
	it('writes the lint-clean body to the path the command names', () => {
		const { body_path, command } = drafted()

		expect(issue_lint_cli.problems(readFileSync(body_path, 'utf8'))).toEqual([])
		expect(command).toContain(`--body-file '${body_path}'`)
	})

	it('prints the review-cap filing line citing the issue', () => {
		const { command } = drafted()

		expect(command).toContain('--route review-cap')
		expect(command).toContain(`--found-during ${String(ISSUE)}`)
		expect(command).toContain(disposition_batch_filing.title_of(finding(), ISSUE))
	})
})

describe('disposition_batch_filing.body_of for a security finding', () => {
	it('declares the bypass instead of the normal priority and passes issue:lint', () => {
		const body = disposition_batch_filing.body_of(finding(SECURITY_LINE), ISSUE)

		expect(body).toContain('- セキュリティ: a token reaches the log')
		expect(body).not.toContain('- 優先度: 通常')
		expect(issue_lint_cli.problems(body)).toEqual([])
	})
})

describe('disposition_batch_filing.command_of', () => {
	it('single-quotes a title carrying a quote and a substitution', () => {
		const command = disposition_batch_filing.command_of(
			{ title: "it's $(rm)", body_path: 'a.md' },
			ISSUE,
		)

		expect(command).toContain(String.raw`'it'\''s $(rm)'`)
	})
})

describe('disposition_batch_filing.filing_lines', () => {
	it('drafts only the file-routed findings', () => {
		const lines = disposition_batch_filing.filing_lines(
			[finding(), finding(DROPPED_LINE)],
			[FOUND_DURING_FLAG, String(ISSUE)],
			temporary_directory(),
		)

		expect(lines?.filter((line) => line.startsWith('pnpm josh issue:file'))).toHaveLength(1)
		expect(lines?.some((line) => line.startsWith('File commands'))).toBe(true)
	})

	it('returns no lines when no finding routes to file, even without the flag', () => {
		expect(disposition_batch_filing.filing_lines([finding(DROPPED_LINE)], [])).toEqual([])
	})

	it('returns undefined for a file-routed finding without the flag', () => {
		expect(disposition_batch_filing.filing_lines([finding()], [])).toBeUndefined()
	})
})
