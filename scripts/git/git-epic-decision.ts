import { git_epic_parse } from './git-epic-parse'
import { git_epic_sections, type BodyLines, type SectionRange } from './git-epic-sections'

// Placing a decision record inside an epic body's `## Decisions` section.
//
// `epic-commands` requires an auto-decision to be written in **both** the epic's `## Decisions` and a
// comment on each child it applies to, and until now no command wrote the epic half — so a run had to
// read the body, edit it and `PATCH` it back by hand, which is the one operation `CLAUDE.md` forbids.
// Measured on runs #1333 and #1349, that repair-shaped detour is where the post-merge bookkeeping
// spends its round trips, and the two most recent filings skipped the epic half entirely rather than
// pay for it (joshuafolkken/kit#1350).
//
// So the record rides on the body edit `--add` already makes: no extra round trip, and the half that
// was being dropped is written by the command instead of by hand.

const DECISIONS_HEADING = '## Decisions'
const DECISIONS_HEADING_PATTERN = /^#{1,6}[ \t]+Decisions\b/u
const BLANK_LINE = ''

// A record that says nothing is worse than no record: it satisfies the "was it written" question
// while leaving the reasoning unrecoverable. Refused before anything is written.
const EMPTY_RECORD =
	'The decision record is empty; write the record before recording it, or leave `--decision-file` off.'

function to_declaration_error(line: string): string {
	return `The decision record declares \`${line}\` on a line of its own, which \`epic:next\` would read as part of the epic's dependency order; wrap it in backticks or reword it.`
}

// Whether the record can be written at all. The declaration check is the load-bearing one: a bare
// `#A -> #B` line anywhere in the body is parsed as a declaration, so a record quoting an order as a
// standalone line would silently add a dependency nobody declared — the failure mode
// joshuafolkken/kit#1253 documents, arriving by a second route.
//
// **It is judged exactly the way the merged body will be judged**: the predicate is the parser's own,
// and the lines are read through the same fence mask, so a record whose chain sits inside a fenced
// block — which the parser ignores once merged — is accepted rather than refused with advice to wrap in
// backticks that the fence has already given it.
function find_decision_error(record: string): string | undefined {
	if (record.trim().length === 0) return EMPTY_RECORD

	const input = git_epic_sections.to_body_lines(record)
	const [found] = git_epic_sections.find_indices(input, (line) =>
		git_epic_parse.is_declaration_line(line),
	)

	return found === undefined ? undefined : to_declaration_error((input.lines[found] ?? '').trim())
}

// The record as the lines it contributes, with a blank line in front so it never runs into whatever
// it is appended after. Trailing blanks are dropped rather than preserved: the record's own file
// almost always ends with a newline, and keeping it would grow the section by a blank line per entry.
function to_record_lines(record: string): Array<string> {
	return [BLANK_LINE, ...record.trimEnd().split('\n')]
}

// A body with no `## Decisions` section at all: the section is created at the end, which is where
// every epic that has one carries it (`epic:plan` writes it there, after `## Progress`).
function to_new_section(lines: ReadonlyArray<string>, record: string): Array<string> {
	return [...lines, BLANK_LINE, DECISIONS_HEADING, ...to_record_lines(record)]
}

// The last line of the section that is not blank, as an offset into the whole body. Appending after
// it rather than at `range.end` keeps the blank line that separates the section from the next heading
// where it was, instead of pushing the record below it and outside the section.
function last_content_index(input: BodyLines, range: SectionRange): number {
	const inside = input.lines.slice(range.start, range.end)
	const offset = inside.findLastIndex((line) => line.trim().length > 0)

	return offset === -1 ? range.start : range.start + offset + 1
}

// Append the record to the epic's `## Decisions` section, creating the section when there is none.
//
// The section's *end* rather than its start: the entries are a log, and a reader looking for the most
// recent decision reads down. Nothing else in the body moves.
function append_decision(body: string, record: string): string {
	const input = git_epic_sections.to_body_lines(body)
	const range = git_epic_sections.find_section_range(input, DECISIONS_HEADING_PATTERN)
	if (range === undefined) return to_new_section(input.lines, record).join('\n')

	const at = last_content_index(input, range)

	return [...input.lines.slice(0, at), ...to_record_lines(record), ...input.lines.slice(at)].join(
		'\n',
	)
}

// What happened to the child half of the record, phrased as a count for the reason the relation report
// is: the useful signal is whether every child now carries the reasoning, not which comment was
// refused. The epic half is never reported here — it rode on the body edit, so it landed or the
// insertion did not.
function format_decision_report(input: { total: number; failures: number }): string {
	if (input.failures === 0) {
		return `📝 Decision recorded on the epic and ${String(input.total)} child issue(s).`
	}

	return `⚠️  ${String(input.failures)} of ${String(input.total)} child comment(s) could not be posted; the epic's \`${DECISIONS_HEADING}\` entry is intact.`
}

const git_epic_decision = {
	DECISIONS_HEADING,
	append_decision,
	find_decision_error,
	format_decision_report,
}

export { git_epic_decision }
