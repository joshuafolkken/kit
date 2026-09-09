import { time_bundle_call } from './time-bundle-call'
import { time_markers } from './time-markers'
import { time_shell } from './time-shell'

// Which files one tool call **wrote** (joshuafolkken/kit#1472).
//
// **A span keeps no tool input**, so anything read off the input has to be read while the input is
// still in hand — the reason `marker`, `targets` and `check_key` are already carried on `ToolCall`
// rather than re-derived later. What was missing is the other half of that pair: a span said what a
// call *named*, and never what it *changed*.
//
// **Two writes were therefore invisible, and both made the unedited count too large.**
// `investigation-reads.ts` subtracts an edit from the set of files a run has read and not edited, and
// it could only subtract what a span could describe:
//
// - `sed -i` labels as `Bash: sed`, exactly as the `sed -n` that is this repository's main reading
//   command does, so a file written in place was counted as read and never taken back out.
//   `CLAUDE.md` allows a small `sed -i` explicitly, so this is daily rather than exceptional.
// - `MultiEdit` and `NotebookEdit` are edit tools for `time-markers.ts` but not bundleable ones for
//   `time-bundle-call.ts`, so their spans arrived carrying `EDIT_MARKER` and `targets: []` — a
//   subtraction with nothing to subtract.
//
// **This module is the one place that answers the question**, so the two callers cannot come to
// disagree about it, and it reuses the extraction `time-bundle-call.ts` already owns rather than
// writing a second one: `tool_targets` for a tool's own path fields, `targets_in` for a shell line.
// Nothing here widens `BUNDLEABLE_TOOLS` — that set is what the batching measurement of
// joshuafolkken/kit#1390 is defined over, and a call that writes is deliberately not bundleable.

const IN_PLACE_COMMAND = 'sed'

// The in-place flags, matched against one word at a time. `-i`, `-i.bak` and a bundled `-ni` all
// write; `-n`, `-E` and `--expression` do not. The long form is anchored on its own because the short
// alternative cannot match a second leading dash.
//
// **This is not `time-batch-guard.ts`'s `WRITING_WORDS`, which excludes `sed` outright rather than
// testing for `-i`** (that file states the choice at its own constant). The two answer different
// questions and must differ: refusing a call half-applies a turn, so that guard treats every `sed` as
// a write and errs toward allowing; this one subtracts from a count, so an over-claim would delete a
// genuine pending read — and it has to name *which* files, which a boolean could not.
const IN_PLACE_FLAG_PATTERN = /^--in-place\b|^-[A-Za-z]*i/u

// **The one segment that runs the command, with its quoted text removed first — never the whole
// line.** Each of the two closes an over-claim, and this set is subtracted, so an over-claim silently
// deletes a file the run really did read and never edit:
//
// - Scanned whole, `sed -n '1,200p' x.ts | grep -i handler` is an in-place write, because `grep`'s
//   `-i` is a word of the line. Any single-dash `i` downstream does it — `grep -i`, `find -iname`,
//   `diff -i`. `command_segment` is the same reader that decides what the span's own label is, so a
//   later segment cannot answer for the first one.
// - Unquoted, `sed -i '' 's|scripts/old.ts|scripts/new.ts|g' docs/index.md` claims both sides of the
//   substitution as files it wrote. Removing the quoted script first leaves only the operands, and it
//   also keeps the `|` inside that script from being read as a pipeline before the segment is picked.
//
// An **unquoted** script — `sed -i.bak s/old/new/ x.ts` — still contributes its own text as a target.
// That is left: it can only delete a pending path spelled exactly like a substitution, and quoting is
// how every example in `CLAUDE.md` writes one.
function write_segment(command: string): string {
	return time_shell.command_segment(time_shell.unquoted(command))
}

function is_in_place_sed(segment: string): boolean {
	if (time_shell.leading_word(segment) !== IN_PLACE_COMMAND) return false

	return time_bundle_call.words_of(segment).some((word) => IN_PLACE_FLAG_PATTERN.test(word))
}

// What a `Bash` line wrote. Only an in-place `sed` is claimed: a `>` redirection and a heredoc write
// too, but naming them here would also claim the file the same line *read*, and this set is
// subtracted rather than added — an over-claim silently removes a genuine pending read.
function bash_writes(command: string): ReadonlyArray<string> {
	const segment = write_segment(command)

	return is_in_place_sed(segment) ? time_bundle_call.targets_in(segment) : []
}

// What a non-`Bash` call wrote: its path fields, when the tool is one `time-markers.ts` already
// recognizes as opening implementation. Asking that module rather than keeping a second edit-tool set
// is what makes `MultiEdit` and `NotebookEdit` answer here without being added anywhere new.
function tool_writes(name: string, input: unknown): ReadonlyArray<string> {
	if (time_markers.tool_marker(name, input) !== time_markers.EDIT_MARKER) return []

	return time_bundle_call.tool_targets(input)
}

// **No `call_writes` beside these two.** `time-bundle-call.ts` has a `call_facts` because a
// `PreToolUse` payload asks it about a raw invocation; nothing asks this module that — the live guard
// never refuses an in-place `sed` or a `MultiEdit` in the first place — and an unwrapping entry point
// with no caller is a second place for `Bash` handling to drift.
const time_writes = {
	bash_writes,
	tool_writes,
}

export { time_writes }
