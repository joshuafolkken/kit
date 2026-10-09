import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { time_background } from './time-background'
import { time_bundle_call } from './time-bundle-call'
import { time_markers, type PhaseMarker } from './time-markers'
import { time_shell } from './time-shell'
import { time_single_check } from './time-single-check'
import { time_transcript_line } from './time-transcript-line'
import { time_writes } from './time-writes'

// Reading a `tool_use` block into the label a span carries — split out of `time-spans.ts` when it
// reached its line limit. `time_spans` re-exports `UNKNOWN_TOOL` and
// `to_tool_call` under the names they always had, so the move changed no call site.

const { NO_MESSAGE_ID } = time_transcript_line

const UNKNOWN_TOOL = 'unknown'

// What a tool span is labelled with. `josh_command` is empty for everything that is not a
// `pnpm josh <cmd>` invocation, and the report drops empty labels rather than printing a bucket.
//
// `marker` names the workflow boundary the call is, for the phase breakdown that slices the same
// spans by stage. It is carried here rather than re-derived later because
// the tool's *input* is what decides it, and a span keeps no input — only the label read off it.
//
// `is_bundleable` and `targets` are carried for exactly that reason too.
// Whether a call could have gone out beside another, and what it names, are both read off the input —
// so a module asking about them after the fact would have nothing to read. `time-bundle-call.ts`
// decides both; the rule each one follows is stated there.
//
// `check_key` is the fourth, and the third time this reason has applied. Two
// runs of one verification check are the same call only if they named the same files, and the files
// are in the input — so `josh_command` alone cannot say, and nothing downstream could recover it.
// `time-single-check.ts` decides it.
//
// `message_id` is the fifth, and it is the one that says which *turn* a call belongs to.
// It is read off the line the `tool_use` block sat on rather than off the
// result that closes the span, because a `tool_result` line carries no message id at all — so a span
// that did not keep it here could never be attributed to the turn that issued it.
//
// `writes` is the sixth, and it is what `targets` could not say. `targets`
// names what a call mentioned; `marker` says a call was *an* edit but not of what, and for a tool
// outside `BUNDLEABLE_TOOLS` it arrived with no target at all. So a consumer subtracting edits from
// reads — `investigation-reads.ts` — had nothing to subtract for `MultiEdit` / `NotebookEdit`, and
// nothing at all to tell an in-place `sed -i` from the `sed -n` it shares a label with.
// `time-writes.ts` decides it, from the input this span is about to discard.
// `issue` is the seventh, and it is the one `branch` could not carry. Under
// lanes the session writing the transcript stays on the default branch while the work runs in a linked
// work tree, so `branch` names no issue on any line of the run; the `in-progress` label call does, and
// like every field above it that answer is read off the *input* a span is about to discard.
// `time_markers.NO_ISSUE` for every call that declares nothing, which is all but one call per run.
interface ToolCall {
	label: string
	josh_command: string
	// Every josh subcommand the call ran, where `josh_command` is only the first.
	// A chained `pnpm josh lint:related && pnpm josh test:related` carries both; the count tables expand
	// it so the ones `josh_command` drops are still counted.
	josh_commands: ReadonlyArray<string>
	check_key: string
	marker: PhaseMarker
	is_bundleable: boolean
	targets: ReadonlyArray<string>
	// Carried beside `targets` because sharing a target means something different depending on it: a
	// second write to one file is independent work, a read of a file just written is not.
	is_writing: boolean
	// The conservative write answer `is_read_only_call` asks of a live call, carried so a reader of the
	// transcript asks the same read-only question as the guard.
	may_write: boolean
	// Whether this is a subagent launch whose prompt builds on an earlier launch's finding.
	// Carried for the reason every field here is — the prompt it is read from
	// is the input, and a span keeps none. `time-agent-bundles.ts` reads it.
	has_prior_reference: boolean
	writes: ReadonlyArray<string>
	message_id: string
	issue: number
	// The background run this call reads the output of, and `''` for every other call.
	// It is the eighth field carried for the reason the seven above are:
	// the id sits in the command string, which a span does not keep, and it is the only thing that
	// says a `tail` two turns later is the join of a command started minutes ago.
	reads_background: string
}

const NO_CALL: ToolCall = {
	label: '',
	josh_command: '',
	josh_commands: [],
	check_key: time_single_check.NO_CHECK,
	marker: time_markers.NO_MARKER,
	message_id: NO_MESSAGE_ID,
	writes: [],
	issue: time_markers.NO_ISSUE,
	reads_background: time_background.NO_BACKGROUND,
	...time_bundle_call.not_bundleable(),
}
const UNKNOWN_CALL: ToolCall = {
	label: UNKNOWN_TOOL,
	josh_command: '',
	josh_commands: [],
	check_key: time_single_check.NO_CHECK,
	marker: time_markers.NO_MARKER,
	message_id: NO_MESSAGE_ID,
	writes: [],
	issue: time_markers.NO_ISSUE,
	reads_background: time_background.NO_BACKGROUND,
	...time_bundle_call.not_bundleable(),
}

// Everything but Bash: the tool's own name is the label, and nothing it runs is a shell command to
// read a check key, a josh command or a declared issue off.
function non_bash_call(name: string, input: unknown, message_id: string): ToolCall {
	return {
		label: name,
		josh_command: '',
		josh_commands: [],
		check_key: time_single_check.NO_CHECK,
		marker: time_markers.tool_marker(name, input),
		message_id,
		writes: time_writes.tool_writes(name, input),
		issue: time_markers.NO_ISSUE,
		// A non-Bash tool joins a backgrounded command too — `BashOutput` carries the shell id in a
		// field of its own, `Monitor` names the same `…/tasks/<id>.output` path in a command — so the
		// same reader is asked here rather than the field being left empty for every tool but `Bash`.
		reads_background: time_background.read_id_of(input),
		...time_bundle_call.tool_facts(name, input),
	}
}

function bash_call(input: unknown, message_id: string): ToolCall {
	const command = time_shell.bash_command(input)
	const josh_command = time_shell.josh_command_of(command)

	return {
		label: time_shell.bash_label(command),
		josh_command,
		josh_commands: time_shell.josh_commands_of(command),
		check_key: time_single_check.check_key(josh_command, command),
		marker: time_markers.bash_marker(command),
		message_id,
		writes: time_writes.bash_writes(command),
		issue: time_markers.bash_issue(command),
		reads_background: time_background.read_id_of(input),
		...time_bundle_call.bash_facts(command),
	}
}

function to_tool_call(name: string, input: unknown, message_id: string): ToolCall {
	if (name !== cost_blocks.BASH_TOOL) return non_bash_call(name, input, message_id)

	return bash_call(input, message_id)
}

const time_tool_call = {
	UNKNOWN_TOOL,
	NO_CALL,
	UNKNOWN_CALL,
	to_tool_call,
}

export type { ToolCall }
export { time_tool_call }
