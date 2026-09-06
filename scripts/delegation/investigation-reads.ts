import path from 'node:path'
import { cost_blocks } from '#scripts/cost/cost-blocks'
import { hook_decision } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time/time-batch-guard'
import { time_bundle_call } from '#scripts/time/time-bundle-call'
import { time_markers } from '#scripts/time/time-markers'
import { time_shell } from '#scripts/time/time-shell'
import { time_spans, type Span } from '#scripts/time/time-spans'
import { delegation_policy } from './delegation-policy'

// How many files a run has read and not edited **since its last delegated unit**
// (joshuafolkken/kit#1460).
//
// **joshuafolkken/kit#1426 made the threshold a count rather than a forecast, and left the counting
// to the agent.** Measured on run #1441, that is a one-shot judgement: `josh delegate investigation`
// was called once at t+4.0 min, the unit returned at t+7.2, and the main line then read **8 more
// files it did not edit** — more than twice the threshold — without the question being asked a second
// time. The count is a memory, and after a delegation the run remembers the *step* as done rather
// than the *counter* as reset.
//
// **So the counting happens here, off the transcript, and not in the agent's head.** A delegation
// clears the set; a read adds to it; an edit takes its file back out of it. Nothing has to be
// remembered, which is why the threshold necessarily fires again — a second accumulation is
// indistinguishable from the first.
//
// **Why a mechanism and not wording.** joshuafolkken/kit#1344 measured three consecutive runs after
// the batching norm was distributed as prose and as a live notice: 1.10–1.12 calls per round trip
// against a 1.50 floor, unchanged. joshuafolkken/kit#1390 read that as the answer — intervene in the
// decision instead of describing it — and this is the same conclusion applied to the same class of
// rule. The wording is corrected too, but it is not what is expected to move the number.

const READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'NotebookRead'])
// The label a subagent call carries is the verbatim tool name (`time-spans.ts` → `to_tool_call`), and
// both spellings are in use: `Task` in the published tool set, `Agent` in this harness's transcripts.
// Neither has a constant anywhere, so the pair is named here rather than matched loosely.
const DELEGATION_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

// **Narrower than `time-bundle-call.ts`'s `READ_COMMANDS`, deliberately.** That list answers which
// calls are bundleable, and it holds `grep`, `ls` and `wc` — commands that report *about* a file
// without carrying its text. What this rule counts is text arriving in the prompt, so only the
// commands that print a file belong here.
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
// Built through `bash_label` so the `Bash: ` prefix is spelled in one place — the labels on a span
// come from that same function.
const CONTENT_READ_LABELS: ReadonlySet<string> = new Set(
	CONTENT_READ_COMMANDS.map((command) => time_shell.bash_label(command)),
)

// What the refusal tells the model. It has to name the count, the command and the return shape,
// because the deny reason is the only text that reaches the model — a run that is refused and told
// nothing reads it as a broken tool.
const REASON = `${String(delegation_policy.INVESTIGATION_FILE_THRESHOLD)} files read and not edited since the last delegated unit, so the reading from here goes to a unit of its own. Ask \`pnpm josh delegate investigation\`, then brief a unit with what the main line has already concluded and what is left to find out; it returns the conclusion plus its \`file:line\` citations, never the file text. Keep a read in the main line only where this run will edit that file — an \`Edit\` cannot be issued against text you do not hold. The rule is \`.claude/skills/workflow-commands/SKILL.md\` → §2b, "The pre-implementation reading".`

interface ReadTally {
	// The files read and not since edited, resolved so the two ways a target reaches here compare.
	pending: ReadonlyArray<string>
	// When the last delegated unit closed, or `NEVER_MS` where the window holds none. This is what
	// re-arms a refusal: a delegation after the recorded one is a new accumulation.
	reset_ms: number
	// The first instant the window covers. A refusal recorded before it cannot be checked against a
	// delegation any more, because the delegation that would re-arm it has scrolled out.
	window_start_ms: number
}

// **The run's own instructions are not the Issue's subject, so reading them is not what §2b delegates.**
// #1426's rule is about reading to find out how the subject works; `CLAUDE.md`, a `prompts/` topic and
// a skill file are read to find out what to *do*, they are read by nearly every run, and a unit cannot
// be sent to read them on the main line's behalf. #1441's own measurement excluded 5 of them by hand
// for exactly this reason, and a count that includes them trips on a run that has investigated nothing.
//
// **Anchored at a path segment rather than matched anywhere in the string**: `includes('prompts/')`
// also exempted `scripts/eval/prompts/x.ts`, which is subject code, and `endsWith('CLAUDE.md')` also
// exempted `MY_CLAUDE.md`.
const INSTRUCTION_PATHS: ReadonlyArray<string> = ['prompts', '.claude/skills']
const INSTRUCTION_FILES: ReadonlySet<string> = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'])
const REPOSITORY_ROOT = process.cwd()

// **The two ways a target reaches this file spell the same path differently.** A tool call carries
// `file_path`, which Claude Code requires to be absolute; a shell line carries the word as it was
// typed, normalized only for a leading `./`. Left as they are, `cat scripts/x.ts` followed by an
// `Edit` of `/…/scripts/x.ts` never cancels — the file stays pending for the rest of the run — and
// reading the same file once each way counts twice.
function resolved(target: string): string {
	return path.resolve(REPOSITORY_ROOT, target)
}

function is_instruction_document(target: string): boolean {
	const segments = resolved(target).split(path.sep)
	const name = segments.at(-1) ?? ''

	return (
		INSTRUCTION_FILES.has(name) ||
		INSTRUCTION_PATHS.some((prefix) => segments.join('/').includes(`/${prefix}/`))
	)
}

function is_content_read(label: string): boolean {
	return READ_TOOLS.has(label) || CONTENT_READ_LABELS.has(label)
}

function subject_targets(targets: ReadonlyArray<string>): ReadonlyArray<string> {
	return targets
		.filter((target) => !is_instruction_document(target))
		.map((target) => resolved(target))
}

function call_targets(call: GuardedCall): ReadonlyArray<string> {
	return subject_targets(time_bundle_call.call_facts(call.name, call.input).targets)
}

// **The instant a delegation closed, not the one it opened.** The refusal this re-arms was recorded
// before the unit was ever briefed, so either end of that span is after it — and the closing instant
// needs no duration arithmetic to derive, which keeps the one number this rule compares free of
// `to_spans`' own bookkeeping.
function delegation_instant(span: Span | undefined): number {
	return span === undefined ? hook_decision.NEVER_MS : span.ended_ms
}

function add_all(pending: Set<string>, targets: ReadonlyArray<string>): void {
	for (const target of targets) pending.add(target)
}

function delete_all(pending: Set<string>, targets: ReadonlyArray<string>): void {
	for (const target of targets) pending.delete(target)
}

// **An edit takes its file out of the set rather than never letting it in.** At read time nothing can
// say whether a file will be edited, and #1426 keeps an edit target's read in the main line on
// purpose. Subtracting afterwards is what makes the set mean "read and not edited" without asking the
// run to declare its intentions.
function apply_span(pending: Set<string>, span: Span): void {
	if (DELEGATION_TOOLS.has(span.label)) {
		pending.clear()

		return
	}

	if (is_content_read(span.label)) {
		add_all(pending, subject_targets(span.targets))

		return
	}

	if (span.marker === time_markers.EDIT_MARKER) delete_all(pending, subject_targets(span.targets))
}

function last_delegation_ms(spans: ReadonlyArray<Span>): number {
	return delegation_instant(spans.findLast((span) => DELEGATION_TOOLS.has(span.label)))
}

// **The window is the tail the hook read, not the whole run.** That is the same bound the batching
// guard works under, and it costs nothing here: the set is cleared at every delegation anyway, so a
// tail that reaches back past the last one already holds the whole accumulation.
function tally_of(text: string): ReadTally {
	const { spans, started_ms } = time_spans.parse_timeline(text)
	const pending = new Set<string>()

	for (const span of spans) apply_span(pending, span)

	return {
		pending: [...pending],
		reset_ms: last_delegation_ms(spans),
		window_start_ms: started_ms,
	}
}

// **The count includes the call in hand, which is why it is projected rather than incremented.** A
// blind `+ 1` refused a *re-read* of a file already pending — a second `sed -n` window of the same
// file, or a `Read` with a new `offset` — when the set would not have grown at all.
function projected_count(pending: ReadonlyArray<string>, call: GuardedCall): number {
	return new Set([...pending, ...call_targets(call)]).size
}

// **The read that takes the count *up to* the threshold is the boundary.** The ones below it stay in
// the main line, which is what keeps a small investigation from paying the two turns a brief and a
// result cost.
function is_at_threshold(count: number): boolean {
	return count >= delegation_policy.INVESTIGATION_FILE_THRESHOLD
}

// **One refusal per accumulation, re-armed by a delegation and by nothing else.** A run that reads on
// regardless is not refused again, so a false positive — three files the run was about to edit — costs
// one round trip rather than wedging the run. And a run that *does* delegate is refused again as soon
// as three more unedited files pile up, which is the whole of joshuafolkken/kit#1460.
//
// **A refusal older than the window re-arms too**, and without that arm the guard fell permanently
// silent on exactly the run lengths the Issue was filed about: once the last delegation scrolls out of
// the 256 KB tail there is no `reset_ms` left to beat, and one stale stamp disarmed the rest of the
// session. This is the bound `batch-guard.ts` already documents for its own window — one extra
// refusal per window rather than silence — and it errs toward delegating, which is the goal.
function is_rearmed(tally: ReadTally, refused_at_ms: number): boolean {
	if (refused_at_ms === hook_decision.NEVER_MS) return true

	return tally.reset_ms > refused_at_ms || refused_at_ms < tally.window_start_ms
}

function is_refusable_command(call: GuardedCall): boolean {
	const label = time_shell.bash_label(time_shell.bash_command(call.input))

	return CONTENT_READ_LABELS.has(label) && time_batch_guard.is_guarded_call(call)
}

// **A `Read` is always safe to refuse; a `Bash` line is refused only where the batching guard would
// also have been willing to.** Claude Code denies one call of a turn and runs the rest, so a refused
// write leaves its siblings applied and itself not — which is why `is_guarded_call` treats `sed`,
// `tee`, `dd` and any `>` as writing and this defers to it. A `sed -n` read is therefore **counted and
// never refused**; the refusal lands on the next call that is unambiguously a read.
//
// **A call naming no subject file is never refused either**, which covers two cases in one rule: a
// call that names only instruction documents — refusing `CLAUDE.md` would stop a run reading the very
// rule being enforced — and a call whose targets could not be read at all, which cannot move the count
// and so has nothing to be refused for.
function is_refusable_call(call: GuardedCall): boolean {
	if (call_targets(call).length === 0) return false
	if (READ_TOOLS.has(call.name)) return true

	return call.name === cost_blocks.BASH_TOOL && is_refusable_command(call)
}

function should_block(text: string, call: GuardedCall, refused_at_ms: number): boolean {
	if (!is_refusable_call(call)) return false

	const tally = tally_of(text)

	return is_at_threshold(projected_count(tally.pending, call)) && is_rearmed(tally, refused_at_ms)
}

const investigation_reads = {
	CONTENT_READ_COMMANDS,
	DELEGATION_TOOLS,
	READ_TOOLS,
	REASON,
	is_at_threshold,
	is_content_read,
	is_instruction_document,
	is_rearmed,
	is_refusable_call,
	projected_count,
	resolved,
	should_block,
	tally_of,
}

export type { ReadTally }
export { investigation_reads }
