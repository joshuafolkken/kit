import { disposition, type Disposition } from './disposition-logic'
import { review_finding_text } from './review-finding-text'
import { review_record_cli } from './review-record-cli'

// `josh disposition --batch <findings-file>` — every finding the run did not fix in place after the
// review round cap, routed at once. A line is a `review:record` positional,
// `<category>:<severity>:<file>[:<line>] — <sentence>`, marked `confirmed ` first when the run has
// stated its failure scenario in concrete inputs and state — the one judgement `disposition` leaves to
// the run. Branch 1 (fix in place) is a size call this cannot see, so it is made before the file is
// written; the rest follows `prompts/review.md` → "Three-way disposition after the cap": a confirmed
// finding that reaches a runtime path is filed, anything else dropped with a note the PR body carries.

const CONFIRMED_MARK = 'confirmed '
const LINE_SUFFIX = /:\d+(?:-\d+)?$/u
const HEADER = ['| finding | disposition | confirmed | branch |', '| --- | --- | --- | --- |']
const LEGEND =
	'file: `pnpm josh issue:file … --route review-cap`; list only findings not fixed in place'
const DROP_HEADING = 'Drop notes for the PR body:'

type Branch = 'file' | 'drop'

interface BatchFinding {
	spec: string
	description: string
	is_confirmed: boolean
	disposition: Disposition
}

type ParseResult = { findings: ReadonlyArray<BatchFinding> } | { invalid: ReadonlyArray<string> }

function path_of(file: string): string {
	return file.replace(LINE_SUFFIX, '')
}

function unmarked(line: string): string {
	return line.startsWith(CONFIRMED_MARK) ? line.slice(CONFIRMED_MARK.length) : line
}

function parse_line(line: string): BatchFinding | undefined {
	const parsed = review_record_cli.parse_positional(unmarked(line))

	if (parsed === undefined) return undefined

	const { category, severity, file } = parsed.finding

	return {
		spec: `${category}:${severity}:${file}`,
		description: parsed.description,
		is_confirmed: line.startsWith(CONFIRMED_MARK),
		disposition: disposition.disposition_for([path_of(file)]),
	}
}

function parse(text: string): ParseResult {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
	const parsed = lines.map((line) => ({ line, finding: parse_line(line) }))
	const invalid = parsed.filter((entry) => entry.finding === undefined).map((entry) => entry.line)

	if (invalid.length > 0) return { invalid }

	return {
		findings: parsed.flatMap((entry) => (entry.finding === undefined ? [] : [entry.finding])),
	}
}

function branch_of(finding: BatchFinding): Branch {
	return finding.is_confirmed && finding.disposition === disposition.RUNTIME ? 'file' : 'drop'
}

function drop_reason(finding: BatchFinding): string {
	return finding.disposition === disposition.NON_RUNTIME ? 'non-runtime' : 'unconfirmed'
}

// A dropped finding's PR-body note, itself a `review:record` positional so one parser reads it back.
function drop_note(finding: BatchFinding): string {
	const reason = `dropped (${drop_reason(finding)}): ${finding.description}`.trim()

	return `- ${finding.spec}${review_finding_text.DESCRIPTION_SEPARATOR}${reason}`
}

function table_row(finding: BatchFinding): string {
	const confirmed = finding.is_confirmed ? 'yes' : 'no'

	return `| ${finding.spec} | ${finding.disposition} | ${confirmed} | ${branch_of(finding)} |`
}

function render(findings: ReadonlyArray<BatchFinding>): string {
	const rows = [...HEADER, ...findings.map((finding) => table_row(finding))]
	const dropped = findings.filter((finding) => branch_of(finding) === 'drop')
	const notes = dropped.map((finding) => drop_note(finding))

	if (notes.length === 0) return [...rows, '', LEGEND].join('\n')

	return [...rows, '', LEGEND, '', DROP_HEADING, ...notes].join('\n')
}

const disposition_batch = { branch_of, drop_note, parse, path_of, render }

export { disposition_batch }
export type { BatchFinding, Branch, ParseResult }
