import { readFileSync } from 'node:fs'
import { agent_exit_record } from '#scripts/agent/agent-exit-record'
import { api_outage } from '#scripts/agent/api-outage'
import type { ClaudeResultEvent } from '#scripts/agent/claude-result-event'
import { git_gh_issue_read } from '#scripts/git/git-gh-issue-read'
import { issue_state } from '#scripts/issue/issue-state'
import { run_cut } from './run-cut'
import { run_hold } from './run-hold'
import { run_issue_number } from './run-issue-number'
import { run_liveness } from './run-liveness'

// `josh run:ending <N>` — how a dispatched lane child *ended*, not whether it is still moving
// (joshuafolkken/kit#2139). `run:liveness` answers "still working, or stopped?"; a normally-exited
// child that stopped mid-implementation is invisible to it — the output freezes exactly as a
// completed child's does, and `is_error: false` looks like success. Measured on 2026-09-19: the child
// for joshuafolkken/kit#2118 ended `subtype: success`, left three uncommitted files, opened no PR, and
// `run:cut --resume` answered `fresh` — a mid-implementation exit that read as a clean finish, and the
// cause took a person opening 875KB of JSONL to find.
//
// **The verdict is read from three traces the child leaves behind, never from `is_error`.** A cut
// record for this issue means it handed off; a CLOSED Issue means it completed and merged; an OPEN
// Issue with no cut means it ended in the middle. The exit record's own `is_error: false` is *not* a
// completion — completion is the CLOSED Issue — which is the one distinction that was missing. The exit
// record is read for the *basis* the park comment carries: which fields said so, and how many tool
// calls the harness refused (`permission_denials`, the direct cause of the 2118 stop).
//
// **The words are a different question from `run:liveness`'s four**, deliberately non-overlapping:
// `merged` / `cut` / `outage` / `abandoned` / `unreadable` answer "how did it end", where `alive` /
// `stopped` / `settled` / `undetermined` answer "is it still going".
//
// **`outage` splits the mid-implementation ending in two** (joshuafolkken/kit#2240). A child that ended
// mid-implementation because it could not reach the API is not a child that stalled on its own: the
// exit record carries a transport-failure signature, read mechanically by `api-outage.ts`. The parent
// reads it to leave the outage child re-dispatchable rather than parking it and counting it against
// the consecutive-failure guard, which is meant to notice the environment — not to be tripped by it.

const MERGED_VERDICT = 'merged'
const CUT_VERDICT = 'cut'
const OUTAGE_VERDICT = 'outage'
const ABANDONED_VERDICT = 'abandoned'
const UNREADABLE_VERDICT = 'unreadable'

type EndingVerdict =
	| typeof MERGED_VERDICT
	| typeof CUT_VERDICT
	| typeof OUTAGE_VERDICT
	| typeof ABANDONED_VERDICT
	| typeof UNREADABLE_VERDICT

// `state` alone answers the merged-vs-open question; the labels a settled child carries are
// `run:liveness`'s concern, not this one. gh's `--json` casing is upper, so the compare is against
// `CLOSED`, the same spelling `run-liveness.ts` reads `OPEN` in.
const STATE_FIELD = 'state'
const CLOSED_STATE = 'CLOSED'

const EXIT_UNREADABLE = 'exit record unreadable'

interface EndingTraces {
	exit_record: ClaudeResultEvent | undefined
	is_child_closed: boolean | undefined
	is_cut_taken: boolean
	is_tree_dirty: boolean
}

interface EndingDecision {
	evidence: string
	reason: string
	verdict: EndingVerdict
}

interface EndingRequest {
	issue: string
	output_path: string
	repo?: string
}

const REASONS: Record<EndingVerdict, string> = {
	[MERGED_VERDICT]: 'The child ran to completion: its Issue is CLOSED.',
	[CUT_VERDICT]:
		'The child took a cut and handed the run to a successor: a cut record for this issue is carried.',
	[OUTAGE_VERDICT]:
		'The child could not reach the API: its exit record ended in error on a transport-failure signature. Do not count it against the consecutive-failure guard — the environment, not the child, is at fault.',
	[ABANDONED_VERDICT]:
		'The child ended mid-implementation without a cut: its Issue is OPEN and no cut was recorded. A normal exit code does not make this a completion.',
	[UNREADABLE_VERDICT]:
		'A trace could not be read — the Issue state or the exit record — so how the child ended cannot be told.',
}

// The mid-implementation ending, split by whether the exit record could not reach the API. A missing
// record is unreadable; an outage record is `outage`; anything else is `abandoned`.
function mid_implementation_verdict(record: ClaudeResultEvent | undefined): EndingVerdict {
	if (record === undefined) return UNREADABLE_VERDICT

	return api_outage.is_outage(record) ? OUTAGE_VERDICT : ABANDONED_VERDICT
}

// The verdict never consults `is_error` for completion: a child that exits `is_error: false` while its
// Issue is still OPEN and uncut is `abandoned`, not `merged` — the exact confusion this command
// removes. `is_error` is read only inside the outage split, where a transport failure ends in error.
function verdict_of(traces: EndingTraces): EndingVerdict {
	if (traces.is_cut_taken) return CUT_VERDICT
	if (traces.is_child_closed === undefined) return UNREADABLE_VERDICT
	if (traces.is_child_closed) return MERGED_VERDICT

	return mid_implementation_verdict(traces.exit_record)
}

function describe_exit(record: ClaudeResultEvent): string {
	const number_turns = record.num_turns === undefined ? 'unknown' : String(record.num_turns)

	return `exit record: subtype=${record.subtype ?? 'unknown'}, is_error=${String(record.is_error)}, num_turns=${number_turns}, permission_denials=${String(record.permission_denials)}`
}

// The refused interactive ask, as a clause the park comment can carry the question and options in — or
// empty when the child asked nothing (joshuafolkken/kit#2201). This is the backstop for a child that
// slipped past the `PreToolUse` refusal: the question is stranded in the exit record's
// `permission_denials`, and lifting it here spares the parent opening the JSONL by hand.
function refused_ask_clause(record: ClaudeResultEvent | undefined): string {
	const ask = record?.refused_ask

	return ask === undefined ? '' : ` the refused interactive ask was — ${ask};`
}

// The basis the park comment carries: which exit-record fields were read, the count of refused tool
// calls, any refused interactive ask, and whether uncommitted work is still on disk for the parent to
// stash.
function abandoned_evidence(traces: EndingTraces): string {
	const record =
		traces.exit_record === undefined ? EXIT_UNREADABLE : describe_exit(traces.exit_record)
	const ask = refused_ask_clause(traces.exit_record)
	const tree = traces.is_tree_dirty ? 'uncommitted work remains' : 'the tree is clean'

	return `${record};${ask} the Issue is OPEN and no cut was recorded (${tree}), so the child ended mid-implementation — include this basis in the park comment.`
}

// The basis an outage verdict carries: the exit-record fields, and the transport-failure signature the
// reason matched, so a person sees why it was read as the environment failing rather than the child.
function outage_evidence(record: ClaudeResultEvent | undefined): string {
	if (record === undefined) return EXIT_UNREADABLE

	const marker = api_outage.outage_marker(record)

	return `${describe_exit(record)}; the exit record ended in error on a transport-failure signature (${marker ?? 'unknown'}), so the child never reached the API.`
}

function evidence_of(verdict: EndingVerdict, traces: EndingTraces): string {
	if (verdict === ABANDONED_VERDICT) return abandoned_evidence(traces)
	if (verdict === OUTAGE_VERDICT) return outage_evidence(traces.exit_record)

	return traces.exit_record === undefined ? EXIT_UNREADABLE : describe_exit(traces.exit_record)
}

function decide(traces: EndingTraces): EndingDecision {
	const verdict = verdict_of(traces)

	return { evidence: evidence_of(verdict, traces), reason: REASONS[verdict], verdict }
}

// CLOSED is completion; anything else is OPEN as far as this command cares. A read that produced
// nothing — an unreachable API, a body that is not a state report — is `undefined`, which the verdict
// reads as unreadable rather than guessing OPEN and reporting a completed child as abandoned.
async function read_child_closed(issue: string, repo?: string): Promise<boolean | undefined> {
	const json = await git_gh_issue_read.issue_view_json(issue, STATE_FIELD, repo)

	if (json === undefined) return undefined

	const state = issue_state.parse_issue_state(json)

	return state === undefined ? undefined : state.state === CLOSED_STATE
}

// The non-mutating read behind `run:cut --resume`'s `fresh` / `resume` answer: a carried cut record
// naming this issue's invocation means the child handed off. `--resume` itself is not called — it
// adopts the cut and spends the hand-off, which a read-only classifier must not do. An expired record
// is a hand-off no successor took, so it is not read as a live cut and falls through to the OPEN case.
async function read_cut_taken(issue: string): Promise<boolean> {
	const directory = await run_cut.worktree_directory()

	if (directory === undefined) return false

	const read = run_cut.read_cut(run_cut.cut_path(directory))

	return read.kind === 'carried' && read.cut.invocation === run_cut.invocation_for(issue)
}

function read_exit(output_path: string): ClaudeResultEvent | undefined {
	const safe_path = run_liveness.to_safe_path(output_path)

	if (safe_path === undefined) return undefined

	try {
		// Validated by `run_liveness.to_safe_path` — normalized, required absolute, confined to the
		// allowed roots — the same check `josh lane:output` gates a transcript path with, reused rather
		// than re-spelled so the two cannot disagree.
		return agent_exit_record.read_exit_record(readFileSync(safe_path, 'utf8')) // NOSONAR
	} catch {
		return undefined
	}
}

async function read_traces(request: EndingRequest): Promise<EndingTraces> {
	const [is_child_closed, is_cut_taken, is_tree_dirty] = await Promise.all([
		read_child_closed(request.issue, request.repo),
		read_cut_taken(request.issue),
		run_hold.is_tree_dirty(),
	])

	return {
		exit_record: read_exit(request.output_path),
		is_child_closed,
		is_cut_taken,
		is_tree_dirty,
	}
}

async function check(request: EndingRequest): Promise<EndingDecision> {
	run_issue_number.require_issue_number(request.issue)

	return decide(await read_traces(request))
}

const run_ending = {
	check,
	decide,
	describe_exit,
	read_child_closed,
	read_cut_taken,
	read_exit,
}

export type { EndingDecision, EndingRequest, EndingTraces, EndingVerdict }
export {
	ABANDONED_VERDICT,
	CUT_VERDICT,
	MERGED_VERDICT,
	OUTAGE_VERDICT,
	run_ending,
	UNREADABLE_VERDICT,
}
