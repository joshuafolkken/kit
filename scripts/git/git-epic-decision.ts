import { git_epic_parse, type DependencyLink } from './git-epic-parse'
import { format_replaced_relations } from './git-epic-reference'
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
// Editors count from one; `find_indices` answers a zero-based index.
const FIRST_LINE_NUMBER = 1

// A record that says nothing is worse than no record: it satisfies the "was it written" question
// while leaving the reasoning unrecoverable. Refused before anything is written.
const EMPTY_RECORD =
	'The decision record is empty; write the record before recording it, or leave `--decision-file` off.'

// **The offending line is named, never quoted.** The record is a file the caller handed over, and
// echoing a line of it into stderr puts arbitrary file content in the console — the leak SonarCloud's
// `tssecurity:S8689` reports for exactly this path on joshuafolkken/kit#1350. A line number is as
// actionable, since the author has the file open, and it carries nothing out of it.
function to_declaration_error(line_number: number): string {
	return `Line ${String(line_number)} of the decision record is nothing but a dependency chain, which \`epic:next\` would read as part of the epic's dependency order; wrap it in backticks, fence it, or reword it.`
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

	return found === undefined ? undefined : to_declaration_error(found + FIRST_LINE_NUMBER)
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

// The record as it will actually be written, with the relations this insertion replaced appended to
// it (joshuafolkken/kit#1711).
//
// **A positioned `--add` discards the `blocked-by` relation the child already had, and until now the
// record said nothing about it.** On joshuafolkken/kit#1703 that overwrote a decision whose reasoning
// was written down, twice in four minutes, leaving the body's declaration, the native relations and
// the recorded decision disagreeing with one another. The record is the artifact read months later, so
// it is where what was replaced has to survive — the console line scrolls away.
//
// **The policy is to report, not to refuse.** Re-pointing a position is what joshuafolkken/kit#1701
// deliberately added, so refusing an invocation that carries no `--decision-file` would close a
// working route to force a record; naming what was dropped costs the caller nothing and loses nothing.
//
// `undefined` stays `undefined`: an insertion that records no decision gains none here, and an
// insertion that replaced nothing gains no line.
function append_replacements(
	record: string | undefined,
	links: ReadonlyArray<DependencyLink>,
): string | undefined {
	if (record === undefined || links.length === 0) return record

	return [record.trimEnd(), BLANK_LINE, format_replaced_relations(links)].join('\n')
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

// The heading a creation writes its reasoning under. Beside a pattern exactly as `DECISIONS_HEADING`
// is, and tied to `git_epic_body`'s own literal by a test that reads a body the builder produced
// rather than by a string comparison (joshuafolkken/kit#1712).
const RATIONALE_HEADING_PATTERN = /^#{1,6}[ \t]+Split rationale\b/u

function read_section(body: string, heading: RegExp): string {
	const input = git_epic_sections.to_body_lines(body)
	const range = git_epic_sections.find_section_range(input, heading)
	if (range === undefined) return ''

	return input.lines.slice(range.start, range.end).join('\n')
}

// Every place the epic body itself records why something was decided: the `## Decisions` log an
// insertion or a removal appends to, **and** the `## Split rationale` a creation writes.
//
// Both, not just the first. `josh epic … --ordered` declares a whole chain and records its reasoning
// under `## Split rationale`, writing no `## Decisions` at all — so a reader that looked only at
// `## Decisions` would report every correctly-documented ordered epic as unjustified the moment it
// was created (joshuafolkken/kit#1712). It is this module's because the heading patterns are: a
// second reader with its own copies is one that comes to disagree with the writers about where a
// record goes.
function read_recorded_reasons(body: string | undefined): string {
	if (body === undefined) return ''

	return [
		read_section(body, DECISIONS_HEADING_PATTERN),
		read_section(body, RATIONALE_HEADING_PATTERN),
	].join('\n')
}

const git_epic_decision = {
	DECISIONS_HEADING,
	append_decision,
	append_replacements,
	read_recorded_reasons,
	find_decision_error,
	format_decision_report,
}

export { git_epic_decision }
