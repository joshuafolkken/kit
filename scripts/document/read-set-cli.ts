#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { entry_read_set, type ReadSetCost, type SectionCost } from './entry-read-set'

// `josh read:set` — what this entry point reads before it starts, and what that costs
// (joshuafolkken/kit#1776).
//
// **The entry cost had no reading of its own.** It could be inferred after the fact from
// `josh cost`, which measures a whole session and cannot say which part of it was the mandated read;
// so the baseline for joshuafolkken/kit#1776 could only be written by hand, once, from one
// transcript. This prints it per entry point, from the documents themselves, as often as anyone
// wants to ask.
//
// **Two figures under one definition, which is what makes a before and an after comparable.**
// `whole` is every file in the set read in full — what a run pays with no way to fetch a heading.
// `scoped` is the set's own files in full plus the cross-referenced *sections* alone — what the same
// run pays with `josh doc:section`. Neither figure drops a document and neither drops a rule: the
// difference is entirely the part of a referenced file that the reference never pointed at.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const FLAG_PREFIX = '-'
const JSON_FLAG = '--json'
const JSON_INDENT = 2
const NOTHING = 0
const PERCENT = 100
const LABEL_GUTTER = 4
const NUMBER_WIDTH = 9
const USAGE = 'Usage: josh read:set [<entry>] [--json]'
const WHOLE_LABEL = 'whole — every referenced file read in full'
const SCOPED_LABEL = 'scoped — referenced sections only'
const SECTION_LABEL = '-- sections referenced out of the set --'
const POINT_OF_USE_LABEL = '-- read at the point of use, not at the entry --'
const FETCH_RULE =
	'fetch: one `Read` call per file — never `cat`, and never two files in one command.'
const OVER_CAP_NOTE = '   Read (over the Bash cap)'
const UNDER_CAP_NOTE = '   Read'

function to_number(value: number): string {
	return value.toLocaleString('en-US').padStart(NUMBER_WIDTH)
}

// The column is sized from the longest label in this report rather than from a constant: the section
// labels carry a file name *and* a heading, so a fixed width pushed them past it and the `tok` / `B`
// columns stopped lining up with the file rows above (joshuafolkken/kit#1776 review round 1).
function row(
	label: string,
	cost: { tokens: number; bytes: number },
	width: number,
	note = '',
): string {
	return `  ${label.padEnd(width)}${to_number(cost.tokens)} tok ${to_number(cost.bytes)} B${note}`
}

// **The tool is printed per file rather than left to be judged, and it is `Read` on every row.** A
// file larger than the Bash output cap cannot be delivered by `cat` at all — what comes back is a
// middle-truncated preview, which is how one measured entry paid for the same five files twice
// (joshuafolkken/kit#1797) — and a file under the cap is still fetched with `Read`, because the rule
// beneath the report is one `Read` per file rather than a size judgement made row by row. Printing
// `cat` as an option for the small rows would have the report contradict its own closing line the
// first time anyone raised `BASH_MAX_OUTPUT_LENGTH` past the smallest document in the set.
function fetch_note(bytes: number, cap: number): string {
	return bytes > cap ? OVER_CAP_NOTE : UNDER_CAP_NOTE
}

function section_label(section: SectionCost): string {
	const mark = section.is_resolved ? '' : ' (unresolved — charged whole)'

	return `${section.file} → "${section.heading}"${mark}`
}

function saved_percent(report: ReadSetCost): number {
	if (report.whole.tokens === NOTHING) return NOTHING

	return Math.round(((report.whole.tokens - report.scoped.tokens) / report.whole.tokens) * PERCENT)
}

function labels_of(report: ReadSetCost): Array<string> {
	return [
		...report.files.map((entry) => entry.file),
		...report.sections.map((section) => section_label(section)),
		...report.point_of_use.map((entry) => entry.file),
		WHOLE_LABEL,
		SCOPED_LABEL,
	]
}

function label_width(report: ReadSetCost): number {
	return Math.max(...labels_of(report).map((label) => label.length)) + LABEL_GUTTER
}

function file_lines(report: ReadSetCost, width: number): Array<string> {
	return report.files.map((entry) =>
		row(entry.file, entry.cost, width, fetch_note(entry.cost.bytes, report.bash_output_cap)),
	)
}

// **What left the entry read is listed, never dropped.** A report that simply stopped naming these
// three would show a saving with nowhere for the cost to have gone; each is still fetched whole, by
// the command whose turn reaches it (joshuafolkken/kit#1797).
function point_of_use_lines(report: ReadSetCost, width: number): Array<string> {
	if (report.point_of_use.length === NOTHING) return []

	return [
		`  ${POINT_OF_USE_LABEL}`,
		...report.point_of_use.map((entry) => row(entry.file, entry.cost, width)),
	]
}

function fetch_lines(report: ReadSetCost): Array<string> {
	const cap = report.bash_output_cap.toLocaleString('en-US')

	return [
		`  ${FETCH_RULE}`,
		`  A Bash result is truncated past ${cap} characters, so a \`cat\` of any file marked \`Read\``,
		'  above returns a preview rather than the file, and it is then read a second time.',
		'',
	]
}

// **The per-reference rows can overlap, and the total below does not.** Two references into one file
// are charged once between them, so these rows are what each pointer names rather than addends of
// `scoped`.
function section_lines(report: ReadSetCost, width: number): Array<string> {
	if (report.sections.length === NOTHING) return []

	return [
		`  ${SECTION_LABEL}`,
		...report.sections.map((section) => row(section_label(section), section.cost, width)),
	]
}

function total_lines(report: ReadSetCost, width: number): Array<string> {
	const saved = report.whole.tokens - report.scoped.tokens

	return [
		'',
		row(WHOLE_LABEL, report.whole, width),
		row(SCOPED_LABEL, report.scoped, width),
		`  saved by reading sections: ${saved.toLocaleString('en-US')} tok (${String(saved_percent(report))}%)`,
		'',
	]
}

function report_lines(report: ReadSetCost): Array<string> {
	const width = label_width(report)

	return [
		`entry: ${report.entry}`,
		...file_lines(report, width),
		...section_lines(report, width),
		...point_of_use_lines(report, width),
		...total_lines(report, width),
		...fetch_lines(report),
	]
}

function wanted_entries(argv: ReadonlyArray<string>, root: string): Array<string> {
	const named = argv.filter((value) => !value.startsWith(FLAG_PREFIX))

	return named.length > NOTHING ? named : entry_read_set.entries(root)
}

// **An unrecognized keyword is refused, never reported on.** Left to fall through it produced a
// complete, plausible report — the skill file, the gate documents, `whole` equal to `scoped` and a
// saving of zero — and exited 0, answering "nothing to save" instead of
// "no such entry" for a mistyped keyword (joshuafolkken/kit#1776 review round 1). That is the silent wrong answer
// `doc:section` refuses for an unresolvable heading, and this is the same refusal.
function unknown_entries(wanted: ReadonlyArray<string>, root: string): Array<string> {
	const known = entry_read_set.entries(root)

	return wanted.filter((entry) => !known.includes(entry))
}

function printed(reports: ReadonlyArray<ReadSetCost>, is_json: boolean): string {
	if (is_json) return JSON.stringify(reports, undefined, JSON_INDENT)

	return reports.flatMap((report) => report_lines(report)).join('\n')
}

function run(argv: ReadonlyArray<string>, root: string = process.cwd()): number {
	const wanted = wanted_entries(argv, root)
	const unknown = unknown_entries(wanted, root)

	if (wanted.length === NOTHING || unknown.length > NOTHING) {
		console.error(`${USAGE}\nKnown entries: ${entry_read_set.entries(root).join(', ')}`)

		return FAILURE_EXIT_CODE
	}

	const reports = wanted.map((entry) => entry_read_set.costed(root, entry))

	console.info(printed(reports, argv.includes(JSON_FLAG)))

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const read_set_cli = {
	FETCH_RULE,
	JSON_FLAG,
	POINT_OF_USE_LABEL,
	SCOPED_LABEL,
	USAGE,
	WHOLE_LABEL,
	main,
	run,
	saved_percent,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { read_set_cli }
