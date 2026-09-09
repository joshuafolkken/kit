import { cost_blocks } from '#scripts/cost/cost-blocks'
import { time_transcript_line, type TranscriptLine } from '#scripts/time/time-transcript-line'
import { delivered_rules, type DeliveredRule } from './delivered-rules'

// What a rule is worth on the channel that carries it when its delivery has not fired
// (joshuafolkken/kit#1525).
//
// **It exists because the eviction order was decided by protection rather than by value.**
// `.claude/skills/workflow-commands/SKILL.md` → §3 recorded that when a rule is trimmed to keep a
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
// in.** Every signature exists verbatim in `scripts/rules/delivered-rules.ts`, so a session that
// merely opened that file carries the text too — and did so in a result whose `is_error` is false.
const ERRORED_RESULT = '"is_error":true'

interface RuleReading {
	id: string
	// Runs in which the rule's trigger occurred at all. The denominator: a run that never reaches the
	// trigger says nothing about whether the rule would have been kept.
	sessions: number
	// Of those, the runs that had already kept the rule at the moment the trigger fired — the
	// compliance the carried text earns with no help from the hook.
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
	is_triggered: boolean
	is_refused: boolean
}

function blank_states(): Map<string, RuleState> {
	const entries = delivered_rules.DELIVERED_RULES.map((rule): [string, RuleState] => [
		rule.id,
		{ is_kept: false, is_triggered: false, is_refused: false },
	])

	return new Map(entries)
}

// **Keeping only counts before the trigger.** After the refusal the run complies because it was made
// to, which is the delivery's contribution and not the carried text's.
function observe_call(rule: DeliveredRule, state: RuleState, call: IssuedCall): void {
	if (state.is_triggered) return

	if (rule.keeps?.(call) === true) state.is_kept = true
	if (rule.is_trigger(call)) state.is_triggered = true
}

// One transcript line, parsed once. The raw text is kept beside it because a refusal is identified
// by the reason the harness wrote back, which the parsed block deliberately discards.
interface DatedLine {
	line: string
	at_ms: number
	calls: Array<IssuedCall>
}

function calls_of(parsed: TranscriptLine): Array<IssuedCall> {
	return parsed.blocks
		.filter((block) => block.type === cost_blocks.TOOL_USE_TYPE)
		.map((block) => ({ name: block.name, input: block.input }))
}

function dated_line(line: string): DatedLine | undefined {
	const parsed = line === '' ? undefined : time_transcript_line.parse_line(line)

	if (parsed === undefined) return undefined

	return { line, at_ms: parsed.timestamp_ms, calls: calls_of(parsed) }
}

function observe_refusal(rule: DeliveredRule, state: RuleState, line: string): void {
	if (!line.includes(ERRORED_RESULT)) return

	if (line.includes(rule.reason.slice(0, REASON_SIGNATURE_LENGTH))) state.is_refused = true
}

function observe_for_rule(rule: DeliveredRule, state: RuleState, entry: DatedLine): void {
	for (const call of entry.calls) observe_call(rule, state, call)

	observe_refusal(rule, state, entry.line)
}

function observe_line(states: Map<string, RuleState>, entry: DatedLine): void {
	for (const rule of delivered_rules.DELIVERED_RULES) {
		const state = states.get(rule.id)

		if (state !== undefined) observe_for_rule(rule, state, entry)
	}
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

	return entries.toSorted((left, right) => left.at_ms - right.at_ms)
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
	return state.is_triggered ? readings.get(id) : undefined
}

function apply_run(readings: Map<string, RuleReading>, states: Map<string, RuleState>): void {
	for (const [id, state] of states) {
		const reading = reading_to_credit(readings, id, state)

		if (reading !== undefined) credit(reading, state)
	}
}

function blank_readings(): Map<string, RuleReading> {
	const entries = delivered_rules.DELIVERED_RULES.map((rule): [string, RuleReading] => [
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
	return delivered_rules.DELIVERED_RULES.map((rule) => readings.get(rule.id)).filter(
		(reading): reading is RuleReading => reading !== undefined,
	)
}

const rule_value = { ERRORED_RESULT, REASON_SIGNATURE_LENGTH, measure, unaided_rate }

export type { RuleReading }
export { rule_value }
