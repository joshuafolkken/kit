import { hook_decision } from '#scripts/josh/hook-decision'
import { error_text } from '#scripts/lib/error-message'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import { run_headless } from './run-headless'
import { run_watcher_hook } from './run-watcher-hook'

// The `backlogrun` parent's and the wake session's poll, refused at its first repeat.
//
// **The parent waits on a blocking command, never on a re-read.** `backlog:drive` and `lane:await` hold
// the turn until something the model has to read happens; a state read issued again with nothing
// decided in between is a poll, and each one is a model turn spent on an answer that has not changed.
//
// **"Nothing decided in between" is read off the transcript**: the last completed call before this one
// ran the same state read on the same operands, with no person's prompt after it. A different command, a person's prompt or
// any other tool call in between breaks the streak, so a progress question answered twice is not one.
//
// **The parent test is `run_headless.driving_carry`'s**, the one the parent hand-off guard reads, so a
// lane child, a person's session and a handed-off record are left alone. A wake session adopts the
// record, so it reads as the parent here.

const SWITCH_ENV_KEY = 'JOSH_POLL_GUARD'
const BASH_TOOL = 'Bash'
const STATE_READS: ReadonlySet<string> = new Set([
	'josh lane:list',
	'josh lane:output',
	'josh run:board',
	'josh run:carry',
	'josh run:liveness',
	'josh run:progress',
	'josh run:wake',
])

const POLL_REASON =
	'⛔ poll: this `backlogrun` session repeats a state read with nothing decided in between, on every ' +
	'occurrence. Wait on `pnpm josh backlog:drive`, or `pnpm josh lane:await <N...> --owner "$PPID"` in ' +
	'the background, and end the turn; its exit is the wake.'

// The flags that make a state-read command write: `run:carry --filed` twice is two filings, and
// `run:carry --cut` after `run:carry --json` is the hand-off, so neither is a re-read.
const WRITING_FLAGS: ReadonlySet<string> = new Set([
	'--begin',
	'--cut',
	'--done',
	'--end',
	'--every',
	'--filed',
	'--loop',
	'--mark',
	'--merged',
	'--resume',
	'--retrospective',
	'--start',
	'--stop',
	'--wait',
])

const FLAG_PREFIX = '-'
const NAME_WORDS = 2
const SIGNATURE_SEPARATOR = ' '

// A state read keyed by the command and its operands, or `undefined` for a call that is none.
// **Operands, not flags**: `lane:output 1 <path>` then `lane:output 2 <path>` read two children, while
// `run:board` and `run:board --chat` print one answer.
function read_key(signature: string): string | undefined {
	const words = signature.split(SIGNATURE_SEPARATOR)
	const name = words.slice(0, NAME_WORDS).join(SIGNATURE_SEPARATOR)

	if (!STATE_READS.has(name) || words.some((word) => WRITING_FLAGS.has(word))) return undefined

	return words.filter((word) => !word.startsWith(FLAG_PREFIX)).join(SIGNATURE_SEPARATOR)
}

function read_keys(signatures: ReadonlyArray<string>): Array<string> {
	return signatures.map((signature) => read_key(signature)).filter((key) => key !== undefined)
}

function state_reads_of(command: string): ReadonlyArray<string> {
	return read_keys(time_shell.josh_signatures_of(command))
}

function command_of(input: unknown): string {
	if (typeof input !== 'object' || input === null || !('command' in input)) return ''

	return typeof input.command === 'string' ? input.command : ''
}

// The state reads the call runs, or none for a call this guard never judges: not a shell call, or a
// delegated unit's (it names the parent's transcript, so only `agent_id` tells it apart).
function candidate_reads(raw_payload: string): ReadonlyArray<string> {
	const payload = hook_decision.parse_hook_payload(raw_payload)

	if (payload?.tool_name !== BASH_TOOL || (payload.agent_id ?? '') !== '') return []

	return state_reads_of(command_of(payload.tool_input))
}

// The last completed call or person's prompt; a model span is the turn itself, never a decision.
function last_step(tail: string): Span | undefined {
	return time_spans
		.parse_timeline(tail)
		.spans.findLast((span) => span.category !== time_spans.MODEL_CATEGORY)
}

function repeats_last_call(tail: string, reads: ReadonlyArray<string>): boolean {
	const last = last_step(tail)

	if (last?.category !== time_spans.TOOL_CATEGORY) return false

	const last_reads = read_keys(last.josh_signatures)

	return reads.some((key) => last_reads.includes(key))
}

// Every cheap test first: the carry record is read only for a call that already repeats a state read.
function is_repeat(raw_payload: string): boolean {
	const reads = hook_decision.is_switch_enabled(SWITCH_ENV_KEY) ? candidate_reads(raw_payload) : []
	const transcript = reads.length === 0 ? undefined : run_watcher_hook.transcript_of(raw_payload)

	if (transcript === undefined) return false

	return repeats_last_call(time_density_hook.read_tail(transcript), reads)
}

/**
 * The deny reason for a state read the driving `backlogrun` parent (or its wake session) issues again
 * with nothing decided since the last one, or `undefined` when the call proceeds.
 */
async function poll_reason(
	raw_payload: string,
	is_parent: () => Promise<boolean> = run_headless.is_backlog_parent,
): Promise<string | undefined> {
	if (!is_repeat(raw_payload)) return undefined

	return (await is_parent()) ? POLL_REASON : undefined
}

// It fails open: an unreadable transcript or carry record allows the call rather than wedging the run.
async function safe_poll_reason(raw_payload: string): Promise<string | undefined> {
	try {
		return await poll_reason(raw_payload)
	} catch (error) {
		error_text.trace_swallowed('run_poll_hook.poll_reason', error)

		return undefined
	}
}

const run_poll_hook = {
	POLL_REASON,
	SWITCH_ENV_KEY,
	poll_reason,
	safe_poll_reason,
}

export { run_poll_hook }
