import type { OrderExpectation, Scenario, ToolExpectation, ToolMatcher } from './eval-scenario'
import { eval_transcript, type ToolCall } from './eval-transcript'

// The verdict is computed from the tool calls alone. Every failure carries the scenario's own
// `because`, so a red run reads as "the rule that broke" rather than "Edit was called" — which is
// what makes the suite usable for deciding whether a document change worked (joshuafolkken/kit#855).

// `missing` is the only kind a cut-short session can produce spuriously: the agent may have been
// about to make the call when the API dropped. A forbidden call is conclusive however the session
// ended — it already happened — and an ordering failure needs both calls present to fire at all.
type FailureKind = 'forbidden' | 'missing' | 'order'

interface Failure {
	kind: FailureKind
	expectation: string
	because: string
}

interface Verdict {
	name: string
	rule: string
	is_pass: boolean
	// The run says nothing about the rule — it made no tool calls, or it did not finish. Distinct from
	// a failure: nothing was violated, and distinct from a pass: nothing was demonstrated.
	is_inconclusive: boolean
	// The narrower half of `is_inconclusive`: the session never reached the API at all, so nothing
	// about the rule was even attempted. Always implies `is_inconclusive`, and carried separately
	// because the two cost different things to learn and want different answers — a session that ran
	// and settled nothing is worth retrying, one that could not connect is worth stopping the suite
	// for (joshuafolkken/kit#1197).
	is_unreachable: boolean
	// Why, when there is a why. Printed instead of a rule name, because the thing to fix is the
	// harness or the prompt rather than the prose.
	note: string | undefined
	failures: ReadonlyArray<Failure>
	calls: ReadonlyArray<ToolCall>
}

function matches(call: ToolCall, expectation: ToolMatcher): boolean {
	if (call.name !== expectation.tool) return false
	if (expectation.input_matches === undefined) return true

	return new RegExp(expectation.input_matches, 'u').test(call.input)
}

function describe_tool(expectation: ToolMatcher): string {
	const suffix =
		expectation.input_matches === undefined ? '' : ` matching /${expectation.input_matches}/`

	return `${expectation.tool}${suffix}`
}

function index_of_call(
	calls: ReadonlyArray<ToolCall>,
	expectation: ToolExpectation | undefined,
): number {
	if (expectation === undefined) return -1

	return calls.findIndex((call) => matches(call, expectation))
}

function missing_calls(scenario: Scenario, calls: ReadonlyArray<ToolCall>): ReadonlyArray<Failure> {
	return scenario.should_call
		.filter((expectation) => index_of_call(calls, expectation) === -1)
		.map((expectation) => ({
			kind: 'missing' as const,
			expectation: `never called ${describe_tool(expectation)}`,
			because: expectation.because,
		}))
}

function forbidden_calls(
	scenario: Scenario,
	calls: ReadonlyArray<ToolCall>,
): ReadonlyArray<Failure> {
	return scenario.should_not_call
		.filter((expectation) => index_of_call(calls, expectation) !== -1)
		.map((expectation) => ({
			kind: 'forbidden' as const,
			expectation: `called ${describe_tool(expectation)}`,
			because: expectation.because,
		}))
}

// Both sides must be present: a run that skipped one has already failed its own `should_call`, and
// reporting the same gap twice buries the message that names the rule.
function order_failure(
	order: OrderExpectation,
	calls: ReadonlyArray<ToolCall>,
): Failure | undefined {
	const before = calls.findIndex((call) => matches(call, order.before))
	const after = calls.findIndex((call) => matches(call, order.after))

	if (before === -1 || after === -1 || before < after) return undefined

	return {
		kind: 'order',
		expectation: `called ${describe_tool(order.after)} before ${describe_tool(order.before)}`,
		because: order.because,
	}
}

function order_failures(
	scenario: Scenario,
	calls: ReadonlyArray<ToolCall>,
): ReadonlyArray<Failure> {
	return scenario.should_call_in_order
		.map((order) => order_failure(order, calls))
		.filter((failure) => failure !== undefined)
}

// A session that called nothing is not a result in either direction: it satisfies every prohibition
// for free and fails every requirement for a reason that has nothing to do with the rule. The suite
// hit exactly this while it was being built — a stdin pipe nobody closed made the CLI stall, every
// run came back empty, and three prohibition scenarios reported green while measuring nothing. So an
// empty run is inconclusive, which is neither a pass nor a silent one; and a session that exited
// non-zero is inconclusive whatever it managed to emit first, because the run did not finish.
function is_inconclusive(
	calls: ReadonlyArray<ToolCall>,
	session: SessionOutcome,
	failures: ReadonlyArray<Failure>,
): boolean {
	if (calls.length === 0) return true
	if (session.exit_code === 0) return false

	// The session ran and then died — an API drop mid-scenario is the common one, and it leaves a
	// transcript full of real calls. Exactly one thing survives that: a forbidden call it actually
	// made, which happened whatever came after. Everything else is thrown out, a clean run included —
	// a prohibition the session died before reaching reads as the rule holding, which is the false
	// green this module exists to prevent.
	return failures.every((failure) => failure.kind !== 'forbidden')
}

interface SessionOutcome {
	exit_code: number
	stderr: string
	// The stream the session wrote. **Required, not optional**: `has_started` reads it to say whether
	// the session announced itself, and a caller that omitted it would get the confident answer
	// `without starting` from an absence — the conflation this whole change removes
	// (joshuafolkken/kit#1001).
	transcript: string
	is_timed_out?: boolean
	// The signal that killed it, when one did. A timeout and an OOM kill both arrive with no exit
	// code, so without this they print the same sentence as a `claude` that never started.
	signal?: string | undefined
}

// The reason, from whichever source has one. stderr first because it is the process's own last word;
// the stream's `result` event second, because **every** non-measurement observed across
// joshuafolkken/kit#908 had an empty stderr, which is what made four failed scenarios in a row
// indistinguishable from each other.
function session_reason(session: SessionOutcome): string | undefined {
	const last_line = session.stderr.trim().split('\n').at(-1) ?? ''

	if (last_line !== '') return last_line

	return eval_transcript.read_error_reason(session.transcript)
}

function failure_detail(session: SessionOutcome): string {
	const reason = session_reason(session)

	return reason === undefined ? '' : `: ${reason}`
}

// **Both sources, not whichever one `session_reason` picked.** That function returns the stderr line
// when there is one and the transcript's reason only when stderr is empty — the right order for the
// single line a note prints, and the wrong one for this question: a `claude` CLI that writes any
// unrelated line to stderr (a deprecation warning, an update notice) and then dies with
// `Unable to connect to API` in the stream's `result` event would be judged on the warning, come back
// as an ordinary `unmeasured`, and take with it both the `⚠` line and the abort. The observation
// behind `session_reason`'s ordering is that stderr was empty on every occurrence measured under
// joshuafolkken/kit#908 — an observation, not a guarantee, and the transcript fallback exists because
// of that.
//
// A session that reached the API and then failed a prohibition is not unreachable however it ended:
// the flag is deliberately a subset of `is_inconclusive`, and `judge` is what enforces that.
function is_unreachable_session(session: SessionOutcome): boolean {
	const sources = [session.stderr, eval_transcript.read_error_reason(session.transcript)]

	return sources.some((source) => eval_transcript.is_unreachable_reason(source))
}

// Whether the session got far enough to announce itself, which is what separates "never started"
// from "started and then died". The two used to print the same sentence, so a run could not tell an
// expired login from an API drop mid-scenario.
function reached_note(session: SessionOutcome, calls: ReadonlyArray<ToolCall>): string {
	if (calls.length > 0) return 'part way'

	return eval_transcript.has_started(session.transcript)
		? 'after starting, before calling any tool'
		: 'without starting'
}

// How the session ended, in its own terms. The exit code cannot carry this: execa reports none at all
// for a signal-terminated process, so a timeout, an OOM kill and a `claude` that never started all
// arrive alike and used to print the same sentence (joshuafolkken/kit#1001).
function ended_note(session: SessionOutcome): string {
	if (session.is_timed_out === true) return 'session timed out'
	if (session.signal !== undefined) return `session was killed by ${session.signal}`

	return `session exited ${String(session.exit_code)}`
}

// What went wrong at the session level, for the report to print instead of a rule name. A dead
// session has no verdict about the rule, and saying so points at the harness rather than the prose.
// The exit code is read before the call count: a session that never started — an expired login, an
// unknown model — produces an empty transcript too, and calling that "no tool calls" throws away the
// stderr that says why, which is the whole reason the session carries it out.
function session_note(session: SessionOutcome, calls: ReadonlyArray<ToolCall>): string | undefined {
	if (session.exit_code === 0) {
		return calls.length === 0 ? 'no tool calls, so nothing was measured' : undefined
	}

	return `${ended_note(session)} ${reached_note(session, calls)}${failure_detail(session)}`
}

function judge(
	scenario: Scenario,
	calls: ReadonlyArray<ToolCall>,
	session: SessionOutcome,
): Verdict {
	const failures = [
		...missing_calls(scenario, calls),
		...forbidden_calls(scenario, calls),
		...order_failures(scenario, calls),
	]
	const is_cut_short = is_inconclusive(calls, session, failures)

	return {
		name: scenario.name,
		rule: scenario.rule,
		is_pass: failures.length === 0 && !is_cut_short,
		is_inconclusive: is_cut_short,
		is_unreachable: is_cut_short && is_unreachable_session(session),
		note: session_note(session, calls),
		failures,
		calls,
	}
}

const eval_judge = { judge }

export { eval_judge }
export type { Failure, SessionOutcome, Verdict }
