import path from 'node:path'
import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_bundle_call } from '#scripts/time-runtime/time-bundle-call'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
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

const READ_TOOLS: ReadonlySet<string> = new Set(['Read'])
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

// **The searches carry no file text, so they are counted in turns rather than files**
// (joshuafolkken/kit#3139). The file count above never saw a `grep`, yet searches were the commonest
// exploration turn a lane took — 457 of them in one day, each re-reading the main line's whole context.
// What a search costs is the turn, so a turn is the unit: parallel searches in one turn count once.
const SEARCH_COMMANDS: ReadonlyArray<string> = ['fd', 'find', 'grep', 'rg']
const SEARCH_LABELS: ReadonlySet<string> = new Set(
	SEARCH_COMMANDS.map((command) => time_shell.bash_label(command)),
)

// The unit the refusal sends the reading to (joshuafolkken/kit#3139): `.claude/agents/investigator.md`,
// the parent's model at a lowered effort. A consumer receives it through the plugin as `kit:investigator`.
const INVESTIGATOR_AGENT = 'investigator'

// What the refusal tells the model. It has to name the count, the command and the return shape,
// because the deny reason is the only text that reaches the model — a run that is refused and told
// nothing reads it as a broken tool.
const REASON = `⛔ investigation: ${String(delegation_policy.INVESTIGATION_FILE_THRESHOLD)} files read and not edited, or ${String(delegation_policy.INVESTIGATION_SEARCH_TURN_THRESHOLD)} search turns, since the last delegated unit, so the reading from here goes to a unit of its own. Ask \`pnpm josh delegate investigation\`, then dispatch the \`${INVESTIGATOR_AGENT}\` agent (\`kit:${INVESTIGATOR_AGENT}\` in a consumer) with a brief of what the main line has already concluded and what is left to find out; it returns the conclusion plus its \`file:line\` citations, never the file text. Keep a read in the main line only where this run will edit that file — an \`Edit\` cannot be issued against text you do not hold. This run's own instructions and the harness's own session files — a backgrounded call's output, a persisted tool result, this session's scratchpad — are never counted, so they are not what took the count here. The rule is \`.claude/skills/workflow-commands/SKILL.md\` → §2b, "The pre-implementation reading".`

interface ReadTally {
	// The files read and not since edited, resolved so the two ways a target reaches here compare.
	pending: ReadonlyArray<string>
	// How many of those entered the set **after** the instant the caller asked about — the refusal's,
	// in the one call that matters (joshuafolkken/kit#1764). It is the second way a refusal re-arms:
	// a run that ignores the one refusal it gets goes on accumulating, and a threshold's worth of new
	// unedited files is a second accumulation whatever the run did about the first.
	pending_since: number
	// When the last delegated unit closed, or `NEVER_MS` where the window holds none. This is what
	// re-arms a refusal: a delegation after the recorded one is a new accumulation.
	reset_ms: number
	// The first instant the window covers. A refusal recorded before it cannot be checked against a
	// delegation any more, because the delegation that would re-arm it has scrolled out.
	window_start_ms: number
	// The search turns since the last delegation or successful write, and how many of them came after
	// the instant asked about — the search-side `pending` / `pending_since` (joshuafolkken/kit#3139).
	searches: number
	searches_since: number
	// The files this run has successfully edited within the window, resolved (joshuafolkken/kit#1840).
	// A re-read of one of them is a read of a file the run edited, which §2b keeps in the main line — so
	// it is excluded from the count and from a call's projected growth rather than counted as fresh
	// investigation.
	edited: ReadonlySet<string>
}

// **The run's own instructions are not the Issue's subject, so reading them is not what §2b delegates.**
// #1426's rule is about reading to find out how the subject works; `CLAUDE.md`, a `prompts/` topic and
// a skill file are read to find out what to *do*, they are read by nearly every run, and a unit cannot
// be sent to read them on the main line's behalf. #1441's own measurement excluded 5 of them by hand
// for exactly this reason, and a count that includes them trips on a run that has investigated nothing.
//
// **Matched against the path relative to the repository root, so `prompts` means *this* repository's**:
// `includes('prompts/')` also exempted `scripts/eval/prompts/x.ts`, which is subject code, and
// `endsWith('CLAUDE.md')` also exempted `MY_CLAUDE.md`. A file outside the checkout is subject
// material like any other — only these paths inside it are the run's own instructions.
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

// **Anchored at the repository root, not matched anywhere in the absolute path.** Testing the
// absolute string made every file in the repository an instruction document for anyone whose checkout
// sits under a directory called `prompts` — which disarmed the guard entirely, in silence.
// Both path predicates below ask the same question of the repository root, so the expression is named
// once rather than written twice — they differ only in what they do with the answer.
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

// **The harness's own session files are not the subject either, and it is the same test that excludes
// them** (joshuafolkken/kit#1771): no unit can be sent to read one on the main line's behalf. A
// backgrounded call's result reaches its run *only* as `tasks/<id>.output` under this session's temp
// tree, and a tool result too large for the transcript reaches it *only* as a file the harness wrote
// under `.claude/projects/`. Refusing either refuses a run the answer to an instruction it issued
// itself — and the remedy the refusal names does not exist for a file that belongs to this session
// alone, so the round trip buys nothing and the read is simply reissued.
//
// **Anchored on a directory the harness *writes*, never on the session tree as a whole.** Exempting
// the whole tree would have disarmed the guard in silence for anything a run unpacks or clones into
// its scratchpad to investigate — real subject material, read to find out how something works, that
// would never have reached the count. That is the failure the instruction-document half's own anchor
// note describes, and it is why the scratchpad is deliberately **not** exempt: what stays exempt is
// what the harness itself wrote.
const SESSION_TEMP_SEGMENT = /^claude-\d+$/u
// **Single-sourced from `cost-transcript.ts`**, which already owns where the harness keeps a session's
// state and builds the transcript directory out of it — spelling `.claude/projects` a second time here
// is the clone `CLAUDE.md` prohibits. That module joins the value onto a home directory and this one
// matches it as a run of segments, so what the two share is the fact rather than the use.
//
// **The `tasks/<id>.output` spelling is deliberately *not* borrowed from `time-background.ts`.** This
// rule matches the session *tree*, which covers that file, the scratchpad and the transcript in one
// test; matching the file name would need a second rule for each of the others.
const SESSION_STATE_SEGMENTS = cost_transcript.TRANSCRIPT_ROOT.split(path.sep)
// What the harness writes into a session's temp tree has a fixed shape — `tasks/<id>.output`, a
// backgrounded call's result — and **both halves are required**. The directory name alone is not
// enough: `tasks/` is one of the commonest directory names a repository has, and a run may unpack or
// clone one into its scratchpad, where matching the name would re-open the silent false negative one
// level down. Persisted tool results and the transcript need no entry here at all — they live under
// the state root above, which is exempt whole.
const HARNESS_OUTPUT_DIRECTORY = 'tasks'
const HARNESS_OUTPUT_EXTENSION = '.output'
// `at()` counts from the end, so the file itself is -1 and the directory holding it is -2.
const FILE_SEGMENT_INDEX = -1
const PARENT_SEGMENT_INDEX = -2

// The state root holds transcripts and persisted results and no subject code, so it is exempt whole.
// It is not anchored to the home directory: `cost-transcript.ts` is this package's only file allowed
// to look that up at all (`scripts/hooks/no-global-shim-write.test.ts`), and two adjacent segments outside
// the checkout are specific enough without it.
function has_state_root(segments: ReadonlyArray<string>, index: number): boolean {
	return SESSION_STATE_SEGMENTS.every((segment, offset) => segments[index + offset] === segment)
}

// The file's **own parent** is tested rather than any directory above it, and the name has to match
// as well — see the shape note above for why one without the other is not enough.
function is_harness_output(segments: ReadonlyArray<string>): boolean {
	return (
		segments.some((segment) => SESSION_TEMP_SEGMENT.test(segment)) &&
		segments.at(PARENT_SEGMENT_INDEX) === HARNESS_OUTPUT_DIRECTORY &&
		(segments.at(FILE_SEGMENT_INDEX) ?? '').endsWith(HARNESS_OUTPUT_EXTENSION)
	)
}

// **A path inside the checkout is never one of these, whatever its directories are called.** The
// instruction-document test above is anchored at the repository root because matching the absolute
// string made every file an instruction document for a checkout sitting under a directory called
// `prompts`; this test cannot borrow that anchor, since the files it names live outside the checkout by
// construction. So the anchor is inverted — leaving the repository is a precondition — and a
// repository file can therefore never be exempted here, whatever it is named.
function is_outside_repository(absolute: string): boolean {
	return repository_relative(absolute).startsWith('..')
}

function is_session_artifact(target: string): boolean {
	const absolute = resolved(target)
	const segments = absolute.split(path.sep)

	if (!is_outside_repository(absolute)) return false

	return (
		segments.some((_segment, index) => has_state_root(segments, index)) ||
		is_harness_output(segments)
	)
}

// The two exclusions answer one question — could a unit be sent to read this instead? — so a target
// failing either is not the Issue's subject and never reaches the count.
function is_subject_file(target: string): boolean {
	return !is_instruction_document(target) && !is_session_artifact(target)
}

// A shell glob resolves to a literal path with a `*` in it, which no edit can ever name — so left in,
// it stays pending until the next delegation and keeps contributing to a count it does not belong in.
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

// **The instant a delegation closed, not the one it opened.** The refusal this re-arms was recorded
// before the unit was ever briefed, so either end of that span is after it — and the closing instant
// needs no duration arithmetic to derive, which keeps the one number this rule compares free of
// `to_spans`' own bookkeeping.
function delegation_instant(span: Span | undefined): number {
	return span === undefined ? hook_decision.NEVER_MS : span.ended_ms
}

// **A span whose outcome was failure changed nothing, so it is not what this rule acts on**
// (joshuafolkken/kit#1764, joshuafolkken/kit#1840). A failed **read** carried no text into the
// prompt — the case that matters is the guard's own refusal: Claude Code writes a denied call to the
// transcript as a `tool_use` block with an errored `tool_result`, and the stamp is written *before*
// the reason is returned, so counting the denied read's targets would pre-load `pending_since` with
// the very read the refusal stopped. A failed **edit** wrote nothing, so it does not exempt a later
// read of its target either — `edited_files` below asks the same question for that reason. An
// **unknown** outcome still counts, because a result nobody recorded is not a failure.
function is_failed_outcome(span: Span): boolean {
	return span.outcome === time_spans.FAILED_OUTCOME
}

// **Every file the run successfully wrote within the window, resolved** (joshuafolkken/kit#1840). It
// is the one source of "this run edited that file", shared by the live tally and the replay: a read of
// a file the run edits is reading §2b keeps in the main line, so it is never counted — whether the read
// came before the edit or after it. A failed edit wrote nothing and so exempts nothing, and a file
// edited outside the window is unknown rather than assumed: the set is only ever as wide as the tail
// the hook read, which is the bound joshuafolkken/kit#1764 already holds the accumulation to.
function edited_files(spans: ReadonlyArray<Span>): Set<string> {
	const written = spans
		.filter((span) => !is_failed_outcome(span))
		.flatMap((span) => subject_targets(span.writes))

	return new Set(written)
}

// **The set records *when* each file entered it, which is the whole of the second re-arm**
// (joshuafolkken/kit#1764). A plain set could say how many files were pending and never how many of
// them arrived after the refusal, so a run that ignored its one refusal was indistinguishable from
// one that had read nothing since. The first entry stands: a re-read of a file already pending is
// not a new accumulation, exactly as it is not a new count.
function add_all(
	pending: Map<string, number>,
	targets: ReadonlyArray<string>,
	at_ms: number,
): void {
	for (const target of targets) if (!pending.has(target)) pending.set(target, at_ms)
}

// **A file the run edited is never added to the set in the first place** (joshuafolkken/kit#1840).
// `edited_files` has already gathered every successful write in the window, so a read of one of them —
// before the edit or after it — is filtered here rather than added and then subtracted. This closes
// the re-read-after-edit gap the old subtract-on-the-edit-span could not: a subtraction runs only on
// the edit's own span, so a read issued *after* the edit was added and stayed. `sed -i`, `MultiEdit`
// and `NotebookEdit` need no special case any more — each is a write, so its target is in `edited` and
// never enters the read count.
interface Accumulation {
	// Read files, keyed by resolved path, valued by the instant each entered.
	pending: Map<string, number>
	// Search turns, keyed by message id so a turn's parallel searches count once, valued the same way.
	searches: Map<string, number>
}

function is_read_only_search(span: Span): boolean {
	return SEARCH_LABELS.has(span.label) && span.is_bundleable && !span.may_write
}

// **A successful write ends the streak.** The measurement behind the threshold counted searches since
// the last edit or delegation: a run that has started writing is implementing, and the searches that
// follow locate the next edit rather than continue an investigation.
//
// **Every read-only search counts, whatever it names** (joshuafolkken/kit#3139). The file count can
// exempt the run's own instructions because a read names each file it reads; a search does not — the
// targets drop a bare directory, so `grep -rn foo CLAUDE.md scripts` looked like a search of
// `CLAUDE.md` alone and an exemption let the whole sweep through. `is_bundleable` without `may_write`
// is the read-only test `is_search_call` asks at the call, so the transcript never counts a search the
// guard could not have refused.
function apply_search(searches: Map<string, number>, span: Span): void {
	if (span.is_writing) {
		searches.clear()

		return
	}

	if (is_read_only_search(span) && !searches.has(span.message_id)) {
		searches.set(span.message_id, span.ended_ms)
	}
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

// **The window is the tail the hook read, not the whole run.** That is the same bound the batching
// guard works under, and it costs nothing here: the set is cleared at every delegation anyway, so a
// tail that reaches back past the last one already holds the whole accumulation.
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

// **The call has to actually add a file the count does not already hold.** Its targets are filtered
// against `edited` first, so a re-read of a file the run edited is not the `+ 1` that trips the
// threshold — the same exclusion `apply_span` makes for the pending set this is compared against
// (joshuafolkken/kit#1840). The `Set` union still absorbs a re-read of something already pending — a
// second `sed -n` window of the same file, or a `Read` with a new `offset` — which would not have
// grown the count either. The default empty set is for the exported callers that ask about
// accumulation alone — a test, or any reader with no edited set in hand.
function projected_count(
	pending: ReadonlyArray<string>,
	call: GuardedCall,
	edited: ReadonlySet<string> = new Set<string>(),
): number {
	return new Set([...pending, ...call_targets(call).filter((target) => !edited.has(target))]).size
}

// **The read that takes the count *up to* the threshold is the boundary.** The ones below it stay in
// the main line, which is what keeps a small investigation from paying the two turns a brief and a
// result cost.
//
// **It is the *accumulated* count that has to reach the boundary, never the projected one.** Counting
// the call's own targets toward it let one bundled multi-file read — `cat a.ts b.ts c.ts`, exactly the
// batching `CLAUDE.md` mandates — be refused as the first call of a run, with a reason claiming three
// files had already been read. The boundary is crossed by a call, not jumped over by one.
function is_at_threshold(pending_count: number): boolean {
	return pending_count + 1 >= delegation_policy.INVESTIGATION_FILE_THRESHOLD
}

// The search turn that takes the count up to its threshold is the boundary, as above.
function is_at_search_threshold(search_count: number): boolean {
	return search_count + 1 >= delegation_policy.INVESTIGATION_SEARCH_TURN_THRESHOLD
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
//
// **And a further accumulation re-arms it, which is what "one refusal per accumulation" had always
// meant and never done** (joshuafolkken/kit#1764). A delegation was the only thing that could clear
// the disarm, so a run that *ignored* the refusal — read on without delegating — was never spoken to
// again however many unedited files it went on to open: the one case the threshold exists for was the
// one case it stopped covering. `docs/josh-commands.md` had already published the corrected
// behavior — "one per accumulation and re-arms after the next three unedited reads" — against code
// that did nothing of the kind, which is the shipped-mechanism-not-working defect
// joshuafolkken/kit#1262 declared highest priority.
//
// **It is not a refusal on the next call.** The count has to climb a whole threshold again, so a
// false positive still costs one round trip; what it cannot do any more is buy silence for the rest
// of the run.
//
// **A delegated unit is not re-armed here because it is not refused at all** (joshuafolkken/kit#1840).
// The hook counts a unit's reading against the unit (joshuafolkken/kit#1424), and the refusal asks for
// a dispatch — but a unit is already where §2b sends the reading, and a read-only one (`Explore`,
// `Plan`) has no `Agent` tool to dispatch with. It was formerly degraded to a single first refusal,
// which still asked for an action the unit could not take; now the unit short circuit in `should_block`
// turns it off entirely, so this function is the parent's alone and needs no delegation condition.
function has_cleared_the_disarm(tally: ReadTally, refused_at_ms: number): boolean {
	return tally.reset_ms > refused_at_ms || refused_at_ms < tally.window_start_ms
}

function is_rearmed(tally: ReadTally, refused_at_ms: number): boolean {
	if (refused_at_ms === hook_decision.NEVER_MS || has_cleared_the_disarm(tally, refused_at_ms)) {
		return true
	}

	return is_at_threshold(tally.pending_since) || is_at_search_threshold(tally.searches_since)
}

// A transcript under a session's `subagents/` directory is a delegated unit's. The segment is
// `cost-transcript.ts`'s, which owns the layout — spelling it a second time here is the clone
// `CLAUDE.md` prohibits, and the hook is handed the derived fork path rather than the parent's
// (`hook-decision.ts` → `guard_reason_for_payload`).
function is_unit_transcript(transcript: string): boolean {
	return transcript.split(path.sep).includes(cost_transcript.UNIT_DIRECTORY)
}

// The run-level question `should_block` asks of the payload: is this a delegated unit's transcript?
// `run` is absent in the pure-tally tests, which are the parent's context by construction.
function is_unit_run(run: GuardRun | undefined): boolean {
	return run !== undefined && is_unit_transcript(run.transcript)
}

function is_read_only_command(call: GuardedCall, labels: ReadonlySet<string>): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	const label = time_shell.bash_label(time_shell.bash_command(call.input))

	return labels.has(label) && time_batch_guard.is_read_only_call(call)
}

// **A search is refusable without a subject target**, unlike a read: `grep -rn foo scripts` names a
// bare directory, which `call_facts` deliberately does not take as a target, and such a sweep is exactly
// the search this count exists for.
function is_search_call(call: GuardedCall): boolean {
	return is_read_only_command(call, SEARCH_LABELS)
}

// **A `Read` is always safe to refuse; a `Bash` line is refused only where it writes nothing.** This
// guard counts *reading*, so a line that also writes is one it has no business stopping — a `sed -i`
// is work rather than investigation, and refusing one would leave the siblings of its turn applied and
// itself not for no gain in what this guard measures.
//
// **It asks `is_read_only_call`, which is what `is_guarded_call` used to mean**
// (joshuafolkken/kit#1762). The batching guard can now refuse a write, and the two guards ask
// different questions of the same call: that one asks whether the call could have gone out beside
// another, this one whether the call is reading. A single shared predicate would have moved this one
// silently when that one widened, so the read-only test kept its semantics under a name that states
// them. A `sed -n` read is therefore still **counted and never refused**; the refusal lands on the
// next call that is unambiguously a read.
//
// **A call naming no subject file is never refused either**, which covers two cases in one rule: a
// call that names only instruction documents — refusing `CLAUDE.md` would stop a run reading the very
// rule being enforced — and a call whose targets could not be read at all, which cannot move the count
// and so has nothing to be refused for.
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
	// A delegated unit is never refused (joshuafolkken/kit#1840): the remedy the refusal names — send
	// the reading to a unit — does not exist inside one. Asked before the tail is parsed, since the
	// answer needs none of it.
	if (!is_refusable_call(call) || is_unit_run(run)) return false

	const tally = tally_of(text, refused_at_ms)

	return is_growing_past_threshold(tally, call) && is_rearmed(tally, refused_at_ms)
}

const investigation_reads = {
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
