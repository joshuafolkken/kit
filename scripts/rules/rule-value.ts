import { cost_blocks } from '#scripts/cost/cost-blocks'
import { time_transcript_line, type TranscriptLine } from '#scripts/time/time-transcript-line'
import { delivered_rules, type MeasuredRule } from './delivered-rules'

// What a rule is worth on the channel that carries it when its delivery has not fired
// (joshuafolkken/kit#1525).
//
// **It exists because the eviction order was decided by protection rather than by value.**
// `.claude/skills/workflow-commands/rule-residency.md` recorded that when a rule is trimmed to keep a
// byte count, the sentence that goes is the one no marker pinned (joshuafolkken/kit#951) — so the
// least-defended text leaves, never the least-useful. Nothing in the repository could tell the two
// apart: `scripts/josh/hook-decision.ts` keeps a once-per-run stamp that answers "has this fired
// yet", never "how often", and no other counter exists.
//
// **The window before a delivery fires is the rule's absence, and it is already recorded.** A
// trigger-delivered rule refuses at most once per run, so every session holds a stretch in which the
// hook has said nothing and only the carried text — the resident copy, where there is one — is
// asking for compliance. Whether the run complied in that stretch is visible in the transcript.
//
// **The unit of observation is a run, not a file.** A session's delegated units are separate
// transcripts, and counting them as sessions would score a parent that counted open Issues and then
// delegated the filing as "trigger reached, not kept" on the unit while missing it on the parent. So
// a caller hands in every text belonging to one run together, and the reading is taken across them.
//
// **A rule with no `keeps` predicate is reported as unmeasured rather than as compliant.** Naming
// the act that counts as keeping a rule is the rule's own business, so it lives on the enumeration
// beside the trigger; a rule that has not declared one is a rule nothing here can score. Scoring it
// 0 would read as "never kept" and scoring it 1 as "always kept", and both are claims the data does
// not make.

// Enough of a refusal to identify which rule spoke. The reasons share a `⛔ ` prefix and diverge
// immediately after it, so the first clause separates them without pinning a whole paragraph that
// re-wraps whenever the text is edited.
const REASON_SIGNATURE_LENGTH = 48
const PERCENT = 100
// **A refusal is an errored result, which is what separates it from a read of the file it is written
// in.** Every signature exists verbatim in the module its rule is written in — the six delivered
// rules in `scripts/rules/delivered-rules.ts`, the batching row's in
// `scripts/time/time-batch-guard.ts` — so a session that
// merely opened that file carries the text too — and did so in a result whose `is_error` is false.
//
// **That fact is read off the parsed block, never off the raw line** (joshuafolkken/kit#1642). The
// test it replaced was `line.includes('"is_error":true')`, which is two mistakes at once: it is
// whitespace- and key-order-sensitive, so a serializer emitting `"is_error": true` would take every
// rule's `refused` column to zero — indistinguishable from a hook that never fired — and it is
// scoped to the *line* rather than to the block, so an errored result sitting beside a successful
// one lent the successful one's text its failure.

interface RuleReading {
	id: string
	// Runs that reached the situation the rule governs. The denominator: a run that never reaches it
	// says nothing about whether the rule would have been kept. **The trigger is that situation only
	// for a rule whose trigger is a neutral act** — filing an Issue, reading one — which a run keeping
	// the rule still performs. Where the trigger is the violation itself, a run that kept the rule
	// never trips it, so the row declares `reaches` and a run counts once it has reached *either* —
	// the union, which equals `reaches` for every row whose trigger it covers
	// (joshuafolkken/kit#1643).
	sessions: number
	// Of those, the runs that kept the rule unaided — before the trigger fired, or without it firing
	// at all, which is the ordinary case for a row that declares `reaches`. The compliance the carried
	// text earns with no help from the hook.
	unaided_kept: number
	// Of those, the runs in which a refusal was actually delivered.
	refusals: number
	// Whether the rule declares what keeping it looks like. False makes `unaided_kept` meaningless.
	is_measurable: boolean
}

interface IssuedCall {
	name: string
	input: unknown
}

interface RuleState {
	is_kept: boolean
	is_reached: boolean
	is_triggered: boolean
	is_refused: boolean
}

function blank_states(): Map<string, RuleState> {
	const entries = delivered_rules.MEASURED_RULES.map((rule): [string, RuleState] => [
		rule.id,
		{ is_kept: false, is_reached: false, is_triggered: false, is_refused: false },
	])

	return new Map(entries)
}

// **Keeping only counts before the trigger.** After the refusal the run complies because it was made
// to, which is the delivery's contribution and not the carried text's.
//
// **A row may declare no call-shaped trigger at all** (joshuafolkken/kit#1792). The batching guard
// decides on the turns *behind* a call, so no predicate given one call could say whether it was
// about to be refused; what the transcript records instead is the refusal, and `observe_error` below
// is what closes the window for such a row.
function keeps_the_rule(
	rule: MeasuredRule,
	call: IssuedCall,
	turn: ReadonlyArray<IssuedCall>,
): boolean {
	return rule.keeps?.(call, turn) === true
}

function is_the_trigger(rule: MeasuredRule, call: IssuedCall): boolean {
	return rule.is_trigger?.(call) === true
}

function observe_before_trigger(
	rule: MeasuredRule,
	state: RuleState,
	call: IssuedCall,
	turn: ReadonlyArray<IssuedCall>,
): void {
	if (state.is_triggered) return

	if (keeps_the_rule(rule, call, turn)) state.is_kept = true
	if (is_the_trigger(rule, call)) state.is_triggered = true
}

// **Reaching the situation is recorded whenever it happens, before the trigger or after.** It is the
// denominator, not the compliance: a run that pushed compliantly and then pushed again in the
// foreground still reached the situation exactly once as far as the reading is concerned.
function observe_call(
	rule: MeasuredRule,
	state: RuleState,
	call: IssuedCall,
	turn: ReadonlyArray<IssuedCall>,
): void {
	if (rule.reaches?.(call, turn) === true) state.is_reached = true

	observe_before_trigger(rule, state, call, turn)
}

// One transcript line, parsed once, as the two things a reading is taken from: the calls it issued
// and the bodies of the results the harness wrote back as failures.
interface DatedLine {
	at_ms: number
	message_id: string
	calls: Array<IssuedCall>
	errors: Array<string>
}

function calls_of(parsed: TranscriptLine): Array<IssuedCall> {
	return parsed.blocks
		.filter((block) => block.type === cost_blocks.TOOL_USE_TYPE)
		.map((block) => ({ name: block.name, input: block.input }))
}

// `is_error` is three-valued, so the comparison is against `true` rather than a truthiness test: a
// block that carried no such field is a tool that reports no outcome, not a call that failed.
function errors_of(parsed: TranscriptLine): Array<string> {
	return parsed.blocks
		.filter((block) => block.is_error === true)
		.map((block) => block.error_text)
		.filter((text) => text !== '')
}

function dated_line(line: string): DatedLine | undefined {
	const parsed = line === '' ? undefined : time_transcript_line.parse_line(line)

	if (parsed === undefined) return undefined

	return {
		at_ms: parsed.timestamp_ms,
		message_id: parsed.message_id,
		calls: calls_of(parsed),
		errors: errors_of(parsed),
	}
}

// **A turn is a message id, not a line** (joshuafolkken/kit#1792). Claude Code writes one line per
// content block and repeats the message id on each, so a turn that thought and then issued two calls
// is three lines carrying one id — the same reading `time-round-trips.ts` takes, for the same reason.
// Read per line, a batched turn is indistinguishable from two turns of one call, which is the whole
// subject of the batching rule scored exactly backwards: measured that way over 297 recorded runs it
// read 3 kept of 276, against 47 refusals.
//
// **An absent id joins nothing, and the fold is by id rather than by adjacency.** The empty string is
// shared by every line that carries none — a result, an attachment, a queue record — so folding on it
// would merge unrelated turns; and those same lines sit *between* the blocks of one message, so a
// fold that only compared each entry with the one before it would split most batched turns back into
// single-call ones. Read that way over this checkout's last 8 sessions, 520 messages issued more than
// one call and only 58 turns came back with more than one. `time-round-trips.ts` → `turn_key` takes
// the same reading, and this is that function's shape: an id keys a turn, and a line without one is
// its own.
function turn_key(entry: DatedLine, index: number): string {
	if (entry.message_id === time_transcript_line.NO_MESSAGE_ID) return `#${String(index)}`

	return entry.message_id
}

function merge_turn(turn: DatedLine, entry: DatedLine): void {
	turn.calls.push(...entry.calls)
	turn.errors.push(...entry.errors)
}

function place_turn(turns: Map<string, DatedLine>, entry: DatedLine, key: string): void {
	const opened = turns.get(key)

	if (opened === undefined) turns.set(key, entry)
	else merge_turn(opened, entry)
}

// A turn is placed where it opened, so the timeline order the reading depends on is the order the
// turns began in — a call hoisted to its own turn's first line was issued before whatever came back
// in between, which is exactly what "kept before the refusal" is asking. **Within one transcript.**
// Across the transcripts of one run, a background unit's call landing between two blocks of a parent
// message is reordered around the hoist; that is open as joshuafolkken/kit#1804, because which
// instant anchors a folded turn is a decision rather than a slip.
function fold_turns(entries: ReadonlyArray<DatedLine>): Array<DatedLine> {
	const turns = new Map<string, DatedLine>()

	for (const [index, entry] of entries.entries()) place_turn(turns, entry, turn_key(entry, index))

	return [...turns.values()]
}

// **A refusal's body is the reason and nothing else, from its first character.** The hook denies a
// call on behalf of the one row whose trigger fired and writes that row's reason back as the whole
// result, which is why the speaker is identified by what the body *opens* with rather than by what
// it carries somewhere inside.
//
// **That is what stops a dump of the enumeration being read as a refusal by every rule at once**
// (joshuafolkken/kit#1642). One `cat scripts/rules/delivered-rules.ts && false` writes a single
// errored result carrying all six reasons verbatim, and a containment test credited a refusal to
// each of them; the file opens with its imports, so under this test nothing claims it. Position is
// what separates the two, so no count of how many signatures appear is needed — and a body naming
// several can no longer be attributed to any of them.
function refused_id(text: string): string | undefined {
	const found = delivered_rules.MEASURED_RULES.find((rule) =>
		text.trimStart().startsWith(rule.reason.slice(0, REASON_SIGNATURE_LENGTH)),
	)

	return found?.id
}

function observe_error(states: Map<string, RuleState>, text: string): void {
	const id = refused_id(text)
	const state = id === undefined ? undefined : states.get(id)

	if (state === undefined) return

	state.is_refused = true
	// **A delivered refusal is the trigger, whatever a predicate said** (joshuafolkken/kit#1792). The
	// hook refuses only where the rule bound, so the window in which compliance is the carried text's
	// closes here — for the six rows this is already true by the time the result comes back, and for
	// a row declaring no call-shaped trigger it is the only thing that can close it.
	state.is_triggered = true
}

function observe_for_rule(
	rule: MeasuredRule,
	state: RuleState,
	calls: ReadonlyArray<IssuedCall>,
): void {
	// The folded turn's calls, not the line's: `fold_turns` has already gathered every block written
	// under one message id, so a call's siblings are the rest of the turn it went out in.
	for (const call of calls) observe_call(rule, state, call, calls)
}

function observe_calls(states: Map<string, RuleState>, calls: ReadonlyArray<IssuedCall>): void {
	for (const rule of delivered_rules.MEASURED_RULES) {
		const state = states.get(rule.id)

		if (state !== undefined) observe_for_rule(rule, state, calls)
	}
}

function observe_line(states: Map<string, RuleState>, entry: DatedLine): void {
	observe_calls(states, entry.calls)

	for (const text of entry.errors) observe_error(states, text)
}

// **One timeline, ordered by timestamp — not the files read back to back.** "Kept before the
// trigger" is a question about *when*, and a run's texts arrive newest-file-first from
// `list_sessions`. Concatenating them would let a filing in the parent precede the count made inside
// a unit that returned before it, scoring the run "trigger reached, not kept" — the same miscount
// the fold was introduced to remove, arrived at from the other side.
function dated_lines_of(text: string): Array<DatedLine> {
	return text
		.split('\n')
		.map((line) => dated_line(line))
		.filter((entry): entry is DatedLine => entry !== undefined)
}

function timeline_of(texts: ReadonlyArray<string>): Array<DatedLine> {
	const entries = texts.flatMap((text) => dated_lines_of(text))

	return fold_turns(entries.toSorted((left, right) => left.at_ms - right.at_ms))
}

// Every text belonging to one run — the session transcript and the transcripts of the units it
// delegated — read as one timeline.
function read_run(texts: ReadonlyArray<string>): Map<string, RuleState> {
	const states = blank_states()

	for (const entry of timeline_of(texts)) observe_line(states, entry)

	return states
}

function credit(reading: RuleReading, state: RuleState): void {
	reading.sessions += 1
	reading.unaided_kept += state.is_kept ? 1 : 0
	reading.refusals += state.is_refused ? 1 : 0
}

function reading_to_credit(
	readings: Map<string, RuleReading>,
	id: string,
	state: RuleState,
): RuleReading | undefined {
	return state.is_triggered || state.is_reached ? readings.get(id) : undefined
}

function apply_run(readings: Map<string, RuleReading>, states: Map<string, RuleState>): void {
	for (const [id, state] of states) {
		const reading = reading_to_credit(readings, id, state)

		if (reading !== undefined) credit(reading, state)
	}
}

function blank_readings(): Map<string, RuleReading> {
	const entries = delivered_rules.MEASURED_RULES.map((rule): [string, RuleReading] => [
		rule.id,
		{
			id: rule.id,
			sessions: 0,
			unaided_kept: 0,
			refusals: 0,
			is_measurable: rule.keeps !== undefined,
		},
	])

	return new Map(entries)
}

// The compliance the carried text earns on its own, as a percentage. `undefined` where the rule
// declares no `keeps` predicate; a rule no run reached is reported separately by `sessions`.
function unaided_rate(reading: RuleReading): number | undefined {
	if (!reading.is_measurable || reading.sessions === 0) return undefined

	return Math.round((reading.unaided_kept / reading.sessions) * PERCENT)
}

// **Runs, not files.** Each element is every transcript belonging to one run, so a caller may read
// one run at a time and never hold the corpus.
function measure(runs: Iterable<ReadonlyArray<string>>): ReadonlyArray<RuleReading> {
	const readings = blank_readings()

	for (const texts of runs) apply_run(readings, read_run(texts))

	// Enumeration order, so a caller's table matches the registry rather than insertion order.
	return delivered_rules.MEASURED_RULES.map((rule) => readings.get(rule.id)).filter(
		(reading): reading is RuleReading => reading !== undefined,
	)
}

const rule_value = { REASON_SIGNATURE_LENGTH, measure, unaided_rate }

export type { RuleReading }
export { rule_value }
