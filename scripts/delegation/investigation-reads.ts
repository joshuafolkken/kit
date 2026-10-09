import path from 'node:path'
import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { capped_print_part } from '#scripts/document/capped-print-part'
import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_bundle_call } from '#scripts/time-runtime/time-bundle-call'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import { delegation_policy } from './delegation-policy'

// How many files a run has read and not edited since its last delegated unit, counted off the
// transcript rather than left to the agent's memory, so the threshold fires again on a second
// accumulation. A delegation clears the set; a read adds to it; an edit exempts its file.

const READ_TOOLS: ReadonlySet<string> = new Set(['Read'])
// Both spellings of the subagent tool are in use: `Task` (published) and `Agent` (this harness).
const DELEGATION_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

// Narrower than `time-bundle-call.ts`'s `READ_COMMANDS`: only commands that print file text count.
const CONTENT_READ_COMMANDS: ReadonlyArray<string> = [
	'bat',
	'cat',
	'head',
	'less',
	'more',
	'nl',
	'sed',
	'tail',
]
const CONTENT_READ_LABELS: ReadonlySet<string> = new Set(
	CONTENT_READ_COMMANDS.map((command) => time_shell.bash_label(command)),
)

// A search carries no file text but costs a turn, so searches count in turns: parallel ones count once.
const SEARCH_COMMANDS: ReadonlyArray<string> = ['fd', 'find', 'grep', 'rg']
const SEARCH_LABELS: ReadonlySet<string> = new Set(
	SEARCH_COMMANDS.map((command) => time_shell.bash_label(command)),
)

// `.claude/agents/investigator.md`; a consumer receives it through the plugin as `kit:investigator`.
const INVESTIGATOR_AGENT = 'investigator'

// The deny reason is the only text that reaches the model, so it names the count, command and return shape.
const REASON = `⛔ investigation: ${String(delegation_policy.INVESTIGATION_FILE_THRESHOLD)} files read and not edited, or ${String(delegation_policy.INVESTIGATION_SEARCH_TURN_THRESHOLD)} search turns, since the last delegated unit, so the reading from here goes to a unit of its own (a successful write also starts the search count over). Ask \`pnpm josh delegate investigation\`, then dispatch the \`${INVESTIGATOR_AGENT}\` agent (\`kit:${INVESTIGATOR_AGENT}\` in a consumer) with a brief of what the main line has already concluded and what is left to find out; it returns the conclusion plus its \`file:line\` citations, never the file text. Keep a read in the main line only where this run will edit that file — an \`Edit\` cannot be issued against text you do not hold. This run's own instructions and the harness's own session files — a backgrounded call's output, a persisted tool result, this session's scratchpad — never count toward the files, so they are not what took the file count here; every read-only search turn counts, whatever it names. The rule is \`.claude/skills/workflow-commands/delegation.md\` → "The pre-implementation reading".`

interface ReadTally {
	// The files read and not since edited, resolved.
	pending: ReadonlyArray<string>
	// How many entered after the refusal's instant — a second accumulation re-arms the refusal.
	pending_since: number
	// When the last delegated unit closed, or `NEVER_MS` where the window holds none.
	reset_ms: number
	// A refusal older than this can no longer be checked against a delegation.
	window_start_ms: number
	// The search-side `pending` / `pending_since`, reset by a delegation or a successful write.
	searches: number
	searches_since: number
	// Files successfully edited in the window; a read of one stays in the main line, so it never counts.
	edited: ReadonlySet<string>
}

// The run's own instructions are not the Issue's subject and cannot be delegated, so they never count.
// Matched relative to the repository root, so `scripts/eval/prompts/x.ts` stays subject code.
const INSTRUCTION_PATHS: ReadonlyArray<string> = ['prompts', '.claude/skills']
const INSTRUCTION_FILES: ReadonlySet<string> = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'])
const REPOSITORY_ROOT = process.cwd()

// A tool call carries an absolute `file_path`, a shell line a relative word; resolve so both compare.
function resolved(target: string): string {
	return path.resolve(REPOSITORY_ROOT, target)
}

// Anchored at the repository root: a checkout under a `prompts` directory must not exempt everything.
function repository_relative(absolute: string): string {
	return path.relative(REPOSITORY_ROOT, absolute)
}

function is_instruction_document(target: string): boolean {
	const relative = repository_relative(resolved(target))
	const segments = relative.split(path.sep)

	return (
		INSTRUCTION_FILES.has(segments.at(-1) ?? '') ||
		INSTRUCTION_PATHS.some((prefix) => relative.startsWith(`${prefix}${path.sep}`))
	)
}

// The harness's own session files (backgrounded output, persisted results) cannot be delegated either.
// Only what the harness writes is exempt — the scratchpad holds real subject material and still counts.
const SESSION_TEMP_SEGMENT = /^claude-\d+$/u
const SESSION_STATE_SEGMENTS = cost_transcript.TRANSCRIPT_ROOT.split(path.sep)
// Both halves of `tasks/<id>.output` are required: `tasks/` alone is a common repository directory.
const HARNESS_OUTPUT_DIRECTORY = 'tasks'
const HARNESS_OUTPUT_EXTENSION = '.output'
const FILE_SEGMENT_INDEX = -1
const PARENT_SEGMENT_INDEX = -2

// The state root holds no subject code, so it is exempt whole.
function has_state_root(segments: ReadonlyArray<string>, index: number): boolean {
	return SESSION_STATE_SEGMENTS.every((segment, offset) => segments[index + offset] === segment)
}

function is_harness_output(segments: ReadonlyArray<string>): boolean {
	return (
		segments.some((segment) => SESSION_TEMP_SEGMENT.test(segment)) &&
		segments.at(PARENT_SEGMENT_INDEX) === HARNESS_OUTPUT_DIRECTORY &&
		(segments.at(FILE_SEGMENT_INDEX) ?? '').endsWith(HARNESS_OUTPUT_EXTENSION)
	)
}

// Leaving the checkout is a precondition, so no repository file is ever exempted as a session artifact.
function is_outside_repository(absolute: string): boolean {
	return repository_relative(absolute).startsWith('..')
}

function is_session_artifact(target: string): boolean {
	const absolute = resolved(target)
	const segments = absolute.split(path.sep)

	if (!is_outside_repository(absolute)) return false

	return (
		segments.some((_segment, index) => has_state_root(segments, index)) ||
		is_harness_output(segments) ||
		capped_print_part.is_part_file(absolute)
	)
}

function is_subject_file(target: string): boolean {
	return !is_instruction_document(target) && !is_session_artifact(target)
}

// A glob is a path no edit can name, so it would stay pending forever.
function is_nameable_file(target: string): boolean {
	return !target.includes('*') && !target.includes('?')
}

function is_content_read(label: string): boolean {
	return READ_TOOLS.has(label) || CONTENT_READ_LABELS.has(label)
}

function subject_targets(targets: ReadonlyArray<string>): ReadonlyArray<string> {
	return targets
		.filter((target) => is_nameable_file(target) && is_subject_file(target))
		.map((target) => resolved(target))
}

function call_targets(call: GuardedCall): ReadonlyArray<string> {
	return subject_targets(time_bundle_call.call_facts(call.name, call.input).targets)
}

// The closing instant: the refusal it re-arms predates the briefing, and it needs no duration arithmetic.
function delegation_instant(span: Span | undefined): number {
	return span === undefined ? hook_decision.NEVER_MS : span.ended_ms
}

// A failed span changed nothing — notably the guard's own denied read, which the transcript records as
// an errored call. An unknown outcome still counts.
function is_failed_outcome(span: Span): boolean {
	return span.outcome === time_spans.FAILED_OUTCOME
}

// The one source of "this run edited that file", bounded by the window the hook read.
function edited_files(spans: ReadonlyArray<Span>): Set<string> {
	const written = spans
		.filter((span) => !is_failed_outcome(span))
		.flatMap((span) => subject_targets(span.writes))

	return new Set(written)
}

// Records when each file entered, so a second accumulation after a refusal is countable; the first
// entry stands.
function add_all(
	pending: Map<string, number>,
	targets: ReadonlyArray<string>,
	at_ms: number,
): void {
	for (const target of targets) if (!pending.has(target)) pending.set(target, at_ms)
}

// An edited file is filtered before it is added, so a re-read after the edit never counts either.
interface Accumulation {
	// Read files, keyed by resolved path, valued by the instant each entered.
	pending: Map<string, number>
	// Search turns, keyed by message id so a turn's parallel searches count once, valued the same way.
	searches: Map<string, number>
}

function is_read_only_search(span: Span): boolean {
	return SEARCH_LABELS.has(span.label) && span.is_bundleable && !span.may_write
}

// A span with no message id is a turn of its own, as in every other turn counter.
function search_turn_key(searches: ReadonlyMap<string, number>, span: Span): string {
	if (span.message_id !== time_spans.NO_MESSAGE_ID) return span.message_id

	return `${time_spans.NO_MESSAGE_ID}#${String(searches.size)}`
}

// A successful write ends the streak: searches after it locate the next edit. Every read-only search
// counts whatever it names — its targets drop bare directories, so an exemption would leak sweeps.
function apply_search(searches: Map<string, number>, span: Span): void {
	if (span.is_writing) {
		searches.clear()

		return
	}

	const turn = search_turn_key(searches, span)

	if (is_read_only_search(span) && !searches.has(turn)) searches.set(turn, span.ended_ms)
}

function apply_span(accumulation: Accumulation, span: Span, edited: ReadonlySet<string>): void {
	if (DELEGATION_TOOLS.has(span.label)) {
		accumulation.pending.clear()
		accumulation.searches.clear()

		return
	}

	if (is_failed_outcome(span)) return

	apply_search(accumulation.searches, span)

	if (!is_content_read(span.label)) return

	const fresh = subject_targets(span.targets).filter((target) => !edited.has(target))

	add_all(accumulation.pending, fresh, span.ended_ms)
}

function last_delegation_ms(spans: ReadonlyArray<Span>): number {
	return delegation_instant(spans.findLast((span) => DELEGATION_TOOLS.has(span.label)))
}

// The window is the tail the hook read; the set clears at every delegation, so the tail suffices.
function pending_after(pending: ReadonlyMap<string, number>, since_ms: number): number {
	return [...pending.values()].filter((at_ms) => at_ms > since_ms).length
}

function tally_of(text: string, since_ms: number = hook_decision.NEVER_MS): ReadTally {
	const { spans, started_ms } = time_spans.parse_timeline(text)
	const edited = edited_files(spans)
	const accumulation: Accumulation = { pending: new Map(), searches: new Map() }

	for (const span of spans) apply_span(accumulation, span, edited)

	return {
		pending: [...accumulation.pending.keys()],
		pending_since: pending_after(accumulation.pending, since_ms),
		reset_ms: last_delegation_ms(spans),
		window_start_ms: started_ms,
		searches: accumulation.searches.size,
		searches_since: pending_after(accumulation.searches, since_ms),
		edited,
	}
}

// The call grows the count only by a file neither pending nor edited (the same exclusion `apply_span` makes).
function projected_count(
	pending: ReadonlyArray<string>,
	call: GuardedCall,
	edited: ReadonlySet<string> = new Set<string>(),
): number {
	return new Set([...pending, ...call_targets(call).filter((target) => !edited.has(target))]).size
}

// The accumulated count, never the projected one, must reach the boundary — otherwise one bundled
// multi-file read would be refused as a run's first call.
function is_at_threshold(pending_count: number): boolean {
	return pending_count + 1 >= delegation_policy.INVESTIGATION_FILE_THRESHOLD
}

// The search turn that takes the count up to its threshold is the boundary, as above.
function is_at_search_threshold(search_count: number): boolean {
	return search_count + 1 >= delegation_policy.INVESTIGATION_SEARCH_TURN_THRESHOLD
}

// One refusal per accumulation, so a false positive costs one round trip. It re-arms on a later
// delegation, on a refusal older than the window (else a long run falls silent), and on a further
// threshold's worth of reads after it.
function has_cleared_the_disarm(tally: ReadTally, refused_at_ms: number): boolean {
	return tally.reset_ms > refused_at_ms || refused_at_ms < tally.window_start_ms
}

function is_rearmed(tally: ReadTally, refused_at_ms: number): boolean {
	if (refused_at_ms === hook_decision.NEVER_MS || has_cleared_the_disarm(tally, refused_at_ms)) {
		return true
	}

	return is_at_threshold(tally.pending_since) || is_at_search_threshold(tally.searches_since)
}

// A transcript under a session's `subagents/` directory is a delegated unit's.
function is_unit_transcript(transcript: string): boolean {
	return transcript.split(path.sep).includes(cost_transcript.UNIT_DIRECTORY)
}

// `run` is absent in the pure-tally tests, which are the parent's context.
function is_unit_run(run: GuardRun | undefined): boolean {
	return run !== undefined && is_unit_transcript(run.transcript)
}

function is_read_only_command(call: GuardedCall, labels: ReadonlySet<string>): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	const label = time_shell.bash_label(time_shell.bash_command(call.input))

	return labels.has(label) && time_batch_guard.is_read_only_call(call)
}

// A search is refusable without a subject target: a bare-directory sweep is what this count is for.
function is_search_call(call: GuardedCall): boolean {
	return is_read_only_command(call, SEARCH_LABELS)
}

// This guard counts reading, so a `Bash` line that also writes is never refused, and neither is a call
// naming no subject file (e.g. only `CLAUDE.md`).
function is_refusable_call(call: GuardedCall): boolean {
	if (is_search_call(call)) return true
	if (call_targets(call).length === 0) return false
	if (READ_TOOLS.has(call.name)) return true

	return is_read_only_command(call, CONTENT_READ_LABELS)
}

// A search call grows the search count by its own turn; a read grows the file count only by a file the
// count does not already hold.
function is_growing_past_threshold(tally: ReadTally, call: GuardedCall): boolean {
	if (is_search_call(call)) return is_at_search_threshold(tally.searches)
	if (!is_at_threshold(tally.pending.length)) return false

	return projected_count(tally.pending, call, tally.edited) > tally.pending.length
}

function should_block(
	text: string,
	call: GuardedCall,
	refused_at_ms: number,
	run?: GuardRun,
): boolean {
	// A delegated unit is never refused: the remedy — send the reading to a unit — does not exist inside one.
	if (!is_refusable_call(call) || is_unit_run(run)) return false

	const tally = tally_of(text, refused_at_ms)

	return is_growing_past_threshold(tally, call) && is_rearmed(tally, refused_at_ms)
}

const investigation_reads = {
	DELEGATION_TOOLS,
	INVESTIGATOR_AGENT,
	READ_TOOLS,
	REASON,
	is_at_threshold,
	is_instruction_document,
	is_rearmed,
	is_refusable_call,
	is_session_artifact,
	is_subject_file,
	projected_count,
	repository_relative,
	resolved,
	should_block,
	tally_of,
}

export type { ReadTally }
export { investigation_reads }
