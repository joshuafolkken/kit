import { mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { capped_output } from '#scripts/document/capped-print'
import { capped_print_part } from '#scripts/document/capped-print-part'
import { document_section } from '#scripts/document/document-section'
import { document_section_cli } from '#scripts/document/document-section-cli'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_prep, type PrepParts } from '#scripts/run/run-prep'
import { run_step_section_once } from '#scripts/run/run-step-section-once'
import { run_step_section_table } from '#scripts/run/run-step-section-table'

// The `run:prep` bundle `run:entry` prints, kept under the Bash result cap (joshuafolkken/kit#5213).
// Past the cap the harness hands back a preview, and a lane child re-ran `run:entry` into a file to see
// the rest — two calls and two copies of the bundle in the context the implementation cut is measured on.
//
// **Over the budget, the issue section goes to one file and becomes its path.** The stage, the `entry`
// line, the `prep` summary and the short sections stay inline, so the run still branches on what it
// printed; the issue body and comments — the one unbounded section — are read from the file, and no
// inline section is in it a second time (joshuafolkken/kit#7111). A bundle still over the budget
// without them writes the whole bundle instead and keeps only the summary and the path.
//
// **The file has `capped_print`'s shape** — a fresh directory per call holding one part — so the
// investigation guard already reads it as a session artifact, not as the Issue's subject.
//
// **The budget is `capped_output`'s, less what shares the same Bash result**: the split assessment's
// section `run:entry` prints after the bundle (and the progress watcher's, outside a lane child), and a
// second headroom for the stage line and the stderr the hold forwards before it.

const FILE_MODE = 0o600
const SECTION_SEPARATOR = '\n\n'
const ISSUE_WHAT = 'the issue section (its body and comments)'
const WHOLE_WHAT = 'the whole bundle'

function byte_length(text: string): number {
	return Buffer.byteLength(text, 'utf8')
}

function section_length(key: string, root: string): number {
	const found = run_step_section_table.GOVERNING_SECTIONS.get(key)

	if (found === undefined) return 0

	const file = document_section_cli.resolve_document(found.document, root)
	const markdown = document_section.read_optional(file) ?? ''

	return byte_length(document_section.section(markdown, found.heading)?.text ?? '')
}

// The watcher's section counts only where `run:entry` prints it whole: outside a lane child, before
// this session printed it — after that it is one line the headroom covers.
function is_watcher_printed_whole(root: string): boolean {
	const watcher = run_step_section_table.GOVERNING_SECTIONS.get(run_step_section_table.PROGRESS)
	const is_printed = watcher === undefined || run_step_section_once.is_recorded(watcher)

	return !is_printed && !lane_child_marker.is_child_of(root)
}

function watcher_length(root: string): number {
	if (!is_watcher_printed_whole(root)) return 0

	return section_length(run_step_section_table.PROGRESS, root)
}

// The sections `run:entry` prints after the bundle.
function sections_length(root: string): number {
	return section_length(run_step_section_table.ENTRY, root) + watcher_length(root)
}

function report_budget(root: string): number {
	const shared = sections_length(root) + capped_output.HEADROOM_CHARS

	return capped_output.output_budget(root) - shared
}

function spill_file(): string {
	const directory = mkdtempSync(path.join(PLATFORM_TEMP_ROOT, capped_print_part.DIRECTORY_PREFIX))

	return path.join(directory, capped_print_part.part_name(0))
}

function spill_line(file: string, text: string, what: string): string {
	const size = byte_length(text).toLocaleString('en-US')

	return `Over the Bash cap — ${what} (${size} B) is written to ${file}; read it with the Read tool, once, not cat.`
}

function write(file: string, text: string): void {
	writeFileSync(file, text, { flag: 'wx', mode: FILE_MODE })
}

// The bundle past the budget: the issue section alone goes to the file while the short sections stay
// inline, or — when those alone still overflow — the whole bundle goes and only the summary stays.
function spill(parts: PrepParts, does_fit: (report: string) => boolean, whole: string): string {
	const file = spill_file()
	const issue = parts.content_body
	const trimmed = run_prep.format_report({
		...parts,
		content_body: spill_line(file, issue, ISSUE_WHAT),
	})
	const is_trimmed_fitting = does_fit(trimmed)

	write(file, is_trimmed_fitting ? issue : whole)
	if (is_trimmed_fitting) return trimmed

	return [run_prep.summary(parts), spill_line(file, whole, WHOLE_WHAT)].join(SECTION_SEPARATOR)
}

// `compose` turns a report into the text `run:entry` prints for it, so the measure is of what reaches
// the Bash result — the `entry` line and the cited links included — not of the report alone. The ship
// preconditions it carries are recorded, so `run:step` does not print the same list again.
function fit(
	parts: PrepParts,
	compose: (report: string) => string,
	root: string = process.cwd(),
): string {
	const budget = report_budget(root)
	const whole = run_prep.format_report(parts)

	run_step_section_once.record_text(run_prep.ship_body(parts.ship_problems))
	if (byte_length(compose(whole)) <= budget) return whole

	return spill(parts, (report) => byte_length(compose(report)) <= budget, whole)
}

const run_entry_spill = { fit, report_budget }

export { run_entry_spill }
