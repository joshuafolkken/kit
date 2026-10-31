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

function finding(): BatchFinding {
	const result = disposition_batch.parse(FINDING_LINE)
	const [first] = 'findings' in result ? result.findings : []

	if (first === undefined) throw new Error('fixture did not parse')

	return first
}

function drafted(): { body_path: string; command: string } {
	const directory = mkdtempSync(path.join(tmpdir(), 'disposition-filing-'))
	const [filing] = disposition_batch_filing.write_filings([finding()], ISSUE, directory)

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
		expect(command).toContain(`--body-file ${body_path}`)
	})

	it('prints the review-cap filing line citing the issue', () => {
		const { command } = drafted()

		expect(command).toContain('--route review-cap')
		expect(command).toContain(`--found-during ${String(ISSUE)}`)
		expect(command).toContain(disposition_batch_filing.title_of(finding(), ISSUE))
	})
})
