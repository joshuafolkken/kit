import { time_bundle_call } from './time-bundle-call'
import { time_markers } from './time-markers'

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

// **Whether a line is an in-place `sed` is `time-bundle-call.ts`'s answer, not a second one here**
// (joshuafolkken/kit#1509). That module needs the same test as a boolean for the batching sequences,
// and while the two were written separately they disagreed in both directions at once — one read the
// whole line, so a piped `grep -i` made a read into a write; the other missed a bundled `sed -ni`, so
// one span could carry `writes: ['x.ts']` beside `is_writing: false`. The segment scoping and the
// quote removal that keep both honest are stated at `write_segment` there.
//
// **This is still not `time-batch-guard.ts`'s `WRITING_WORDS`, which excludes `sed` outright rather
// than testing for `-i`** (that file states the choice at its own constant). Those answer different
// questions and must differ: refusing a call half-applies a turn, so that guard treats every `sed` as
// a write and errs toward allowing. What this module adds is *which* files, which a boolean could
// not — and this set is subtracted, so an over-claim would delete a genuine pending read.

// What a `Bash` line wrote. Only an in-place `sed` is claimed: a `>` redirection and a heredoc write
// too, but naming them here would also claim the file the same line *read*, and this set is
// subtracted rather than added — an over-claim silently removes a genuine pending read.
//
// The targets are read from the same segment the predicate answered about, so a file named in a later
// pipeline stage cannot be claimed as written by the first one.
function bash_writes(command: string): ReadonlyArray<string> {
	const segment = time_bundle_call.write_segment(command)

	return time_bundle_call.is_in_place_sed(segment) ? time_bundle_call.targets_in(segment) : []
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
