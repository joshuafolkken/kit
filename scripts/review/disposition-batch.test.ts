import { describe, expect, it } from 'vitest'
import { disposition_batch, type BatchFinding, type ParseResult } from './disposition-batch'
import { review_record_cli } from './review-record-cli'

// joshuafolkken/kit#5542: `disposition --batch` routes every finding left after the round cap in one
// table, and drafts the drop note the PR body carries for each finding it drops.

const RUNTIME_LINE = 'bug-risks:medium:scripts/foo.ts:42 — the loop skips the last entry'
const INERT_PATH = '.editorconfig'
const INERT_LINE = `comments:low:${INERT_PATH} — a design preference`
const FINDINGS_FILE = [
	`confirmed ${RUNTIME_LINE}`,
	'',
	RUNTIME_LINE.replace('medium', 'low'),
	`comments:low:${INERT_PATH}:3 — a design preference`,
].join('\n')

function findings_of(result: ParseResult): ReadonlyArray<BatchFinding> {
	if ('invalid' in result) throw new Error(`unparsed: ${result.invalid.join(', ')}`)

	return result.findings
}

function only_finding(line: string): BatchFinding {
	const [finding] = findings_of(disposition_batch.parse(line))

	if (finding === undefined) throw new Error(`no finding in: ${line}`)

	return finding
}

describe('disposition_batch.parse', () => {
	it('reads every non-blank line with its confirmation and runtime verdict', () => {
		const findings = findings_of(disposition_batch.parse(FINDINGS_FILE))

		expect(findings.map((finding) => [finding.is_confirmed, finding.disposition])).toEqual([
			[true, 'runtime'],
			[false, 'runtime'],
			[false, 'non-runtime'],
		])
	})

	it('names every line outside the review:record grammar', () => {
		expect(disposition_batch.parse(`${INERT_LINE}\nnot a finding`)).toEqual({
			invalid: ['not a finding'],
		})
	})

	it('classifies by the path with its line suffix stripped', () => {
		expect(disposition_batch.path_of('scripts/foo.ts:42-50')).toBe('scripts/foo.ts')
	})
})

describe('disposition_batch.branch_of', () => {
	it('files a confirmed runtime finding and drops the rest', () => {
		const findings = findings_of(disposition_batch.parse(FINDINGS_FILE))

		expect(findings.map((finding) => disposition_batch.branch_of(finding))).toEqual([
			'file',
			'drop',
			'drop',
		])
	})
})

describe('disposition_batch.drop_note', () => {
	it('is a review:record positional the record parser reads back to the same finding', () => {
		const note = disposition_batch.drop_note(only_finding(INERT_LINE))
		const parsed = review_record_cli.parse_positional(note.replace(/^- /u, ''))

		expect(parsed?.finding).toEqual({
			category: 'comments',
			severity: 'low',
			file: INERT_PATH,
		})
		expect(parsed?.description).toBe('dropped (non-runtime): a design preference')
	})

	it('names an unconfirmed runtime finding as unconfirmed', () => {
		expect(disposition_batch.drop_note(only_finding(RUNTIME_LINE))).toContain(
			'dropped (unconfirmed)',
		)
	})
})

describe('disposition_batch.render', () => {
	it('prints one table row per finding and a note per dropped one', () => {
		const output = disposition_batch.render(findings_of(disposition_batch.parse(FINDINGS_FILE)))

		expect(output).toContain('| bug-risks:medium:scripts/foo.ts:42 | runtime | yes | file |')
		expect(output).toContain('| comments:low:.editorconfig:3 | non-runtime | no | drop |')
		expect(output.match(/^- /gmu)).toHaveLength(2)
	})

	it('prints no drop-note block when nothing is dropped', () => {
		const output = disposition_batch.render(
			findings_of(disposition_batch.parse(`confirmed ${RUNTIME_LINE}`)),
		)

		expect(output).not.toContain('Drop notes')
	})
})
