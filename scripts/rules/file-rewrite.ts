import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { run_cut_handoff } from '#scripts/run/cut/run-cut-handoff'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { edit_tool } from './edit-tool'

// The trigger and the delivered text behind the `file-rewrite` row of `delivered-rules.ts`: a `Write`
// over an existing file whose new body keeps most of the old one (joshuafolkken/kit#5284).
//
// **`file-edits.md`'s whole-rewrite conditions are countable, so the guard counts them.** A whole
// rewrite is allowed for a new file and for a rebuild that shares almost nothing with the original;
// a `Write` whose new body repeats most of the old lines is a region edit carried as a whole file, and
// its diff cannot be read. The share is the new body's non-blank lines found in the old body, each old
// line matched once.
//
// **The run's handoff is never refused**: `.josh/tmp/handoff-<N>.json` is rewritten whole by design,
// the way `implementation-cut.ts` lets it through.
//
// It fires on every occurrence, for the reason `file-body.ts` does.

const { WRITE, EDIT, is_edit_tool, string_field } = edit_tool

// Above this share of the new body's lines kept from the old body, the `Write` is a region edit.
// "Most" is the line `file-edits.md` draws: strictly more than half.
const MAX_SHARED_RATIO = 0.5
const PERCENT = 100
const LINE_BREAK = '\n'

const ISSUE_PLACEHOLDER = '<N>'
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/gu
const ISSUE_DIGITS = String.raw`\d+`

// The handoff path as a pattern, built from `run-cut-handoff.ts`'s single spelling of it.
const HANDOFF_PATTERN = run_cut_handoff.HANDOFF_PATH.replaceAll(
	REGEX_SPECIALS,
	(special) => `\\${special}`,
).replace(ISSUE_PLACEHOLDER, () => ISSUE_DIGITS)
const HANDOFF = new RegExp(`(?:^|/)${HANDOFF_PATTERN}$`, 'u')

function body_lines(text: string): Array<string> {
	return text
		.split(LINE_BREAK)
		.map((line) => line.trim())
		.filter((line) => line !== '')
}

function count_lines(lines: ReadonlyArray<string>): Map<string, number> {
	const counts = new Map<string, number>()

	for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)

	return counts
}

function take_line(counts: Map<string, number>, line: string): boolean {
	const left = counts.get(line) ?? 0

	if (left === 0) return false
	counts.set(line, left - 1)

	return true
}

// The share of the new body's non-blank lines that the old body already carries, each old line
// matched at most once; `0` for an empty new body.
function shared_ratio(old_text: string, new_text: string): number {
	const new_lines = body_lines(new_text)

	if (new_lines.length === 0) return 0

	const old_counts = count_lines(body_lines(old_text))
	const shared = new_lines.filter((line) => take_line(old_counts, line)).length

	return shared / new_lines.length
}

// The `Write` input over a path that is not the run's handoff; `undefined` for any other call.
function write_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (call.name !== WRITE || !json_value.is_record(call.input)) return undefined

	return HANDOFF.test(string_field(call.input, 'file_path')) ? undefined : call.input
}

// The file's current text, `undefined` for a new file. Injected so the suite controls it without
// touching the real filesystem, the way `file-body.ts` injects its existence check.
type ReadExisting = (file_path: string) => string | undefined

function rewrite_ratio(call: GuardedCall, read: ReadExisting): number | undefined {
	const input = write_input(call)
	const old_text = input === undefined ? undefined : read(string_field(input, 'file_path'))

	if (input === undefined || old_text === undefined) return undefined

	return shared_ratio(old_text, string_field(input, 'content'))
}

// The trigger: a `Write` over an existing file keeping more than `MAX_SHARED_RATIO` of its lines.
function rewrites_kept_body(
	call: GuardedCall,
	read: ReadExisting = file_reader.read_optional,
): boolean {
	return (rewrite_ratio(call, read) ?? 0) > MAX_SHARED_RATIO
}

// The occasion the rule governs: any `Edit` or `Write`. Read off the call alone, so a transcript is
// measured without the file as it stood then.
function reaches_file_change(call: GuardedCall): boolean {
	return is_edit_tool(call.name)
}

// Keeping the rule: the region changed with `Edit`.
function keeps_region_edit(call: GuardedCall): boolean {
	return call.name === EDIT
}

const FILE_REWRITE_REASON =
	`⛔ whole-file Write of an existing file: the new body keeps more than ${String(MAX_SHARED_RATIO * PERCENT)}% ` +
	'of the old lines, so it is a region edit carried as a whole file and its diff cannot be read. ' +
	'Change the region with the Edit tool; a Write stays for a new file or a rebuild sharing almost ' +
	'nothing. This rule fires on every occurrence (`prompts/collaboration-workflow/file-edits.md`).'

const ROW = {
	id: 'file-rewrite',
	is_trigger: (call: GuardedCall): boolean => rewrites_kept_body(call),
	reason: FILE_REWRITE_REASON,
	decide: (): boolean => true,
	keeps: keeps_region_edit,
	reaches: reaches_file_change,
	about: {
		title: 'No whole-file Write that keeps most of the old body',
		topic: '`file-edits.md`',
		fires:
			'a `Write` over an existing file whose new body shares more than half its non-blank lines with the old one. Every occurrence',
		quiet: "a new file, the run's handoff, a rebuild sharing half or less, or an `Edit`",
	},
}

const file_rewrite = {
	FILE_REWRITE_REASON,
	MAX_SHARED_RATIO,
	ROW,
	rewrites_kept_body,
	shared_ratio,
}

export { file_rewrite }
