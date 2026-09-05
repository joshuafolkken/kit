import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { time_markers } from './time-markers'
import { time_spans, type Span } from './time-spans'

// The transcript files the timing tests measure, written once rather than in each test file
// (joshuafolkken/kit#1284).
//
// `time-corpus.ts` walks the directory and `time-run.ts` reports on what the walk found, so both
// suites need the same fixtures: a session, a delegated unit under it, and the three line shapes a
// span is derived from. Restating them beside each suite would be the clone `CLAUDE.md` prohibits,
// in the one place where a drift would make the two suites disagree about what a transcript is.

const CWD = '/Users/someone/Development/kit'
const MINUTE_MS = 60_000
const ISSUE = 1268
const BRANCH = '1268-measure-a-run'
const CALL_ID = 'a'
const AGENT_CALL_ID = 'g'
// The skill whose load `time-markers.ts` reads as the instant a run opens.
const WORKFLOW_SKILL = 'workflow-commands'

// The day every fixture minute is an offset into. Fixed rather than `Date.now()`, so a failure reads
// the same on the day it is written and a year later.
const FIXTURE_YEAR = 2026
const FIXTURE_MONTH = 0
const FIXTURE_DAY = 1
const FIXTURE_HOUR = 0

// The shape one measured stretch has: a prompt, a call one minute later, its result two minutes
// after that. Named because three files assert against the totals they produce.
const CALL_MINUTE = 1
const RESULT_MINUTE = 3
// The minute grid one `turn_lines` group occupies: the calls on the first, their results on the
// second.
const TURN_MINUTES = 2
// How many turns a density fixture holds — comfortably past `time_density.MIN_ROUND_TRIPS`, so a case
// about the density is never answered by the sample-size guard instead. Named here rather than in
// each suite because three of them assert against the round-trip count it produces.
const DENSITY_TURNS = 12
// The `}` a serialized payload ends in, dropped so another field can be appended after the last one.
const CLOSING_BRACE = -1
// The minute a concurrent session's call lands on — inside the same window, on an instant the
// delegated unit's spans do not share, so the cross-session dedupe cannot collapse the two.
const CONCURRENT_CALL_MINUTE = 2
// What `issue_lines` spends, and so what the same three minutes must still total once the parent's
// wait for the unit that spent them is folded in.
const THREE_MINUTES_MS = RESULT_MINUTE * MINUTE_MS

function at(minute: number): string {
	return new Date(
		Date.UTC(FIXTURE_YEAR, FIXTURE_MONTH, FIXTURE_DAY, FIXTURE_HOUR, minute),
	).toISOString()
}

function ms(minute: number): number {
	return Date.parse(at(minute))
}

function prompt_line(minute: number, branch: string): string {
	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: 'go' },
	})
}

function call_line(minute: number, branch: string, name = 'Read', id = CALL_ID): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_use', name, id }] },
	})
}

function result_line(minute: number, branch: string, id = CALL_ID): string {
	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
	})
}

// Minutes 0→1 model wait, 1→3 tool execution, all on the given branch.
function issue_lines(offset: number, branch: string = BRANCH): Array<string> {
	return [
		prompt_line(offset, branch),
		call_line(offset + CALL_MINUTE, branch),
		result_line(offset + RESULT_MINUTE, branch),
	]
}

// The parent's whole view of a delegated child: one `Agent` span covering minutes 0→3, which is the
// same wall clock the unit's transcript records as the work it did.
function delegating_lines(branch: string = BRANCH): Array<string> {
	return [
		call_line(0, branch, 'Agent', AGENT_CALL_ID),
		result_line(RESULT_MINUTE, branch, AGENT_CALL_ID),
	]
}

// A `pnpm josh <cmd>` call, which is what a phase is read off (joshuafolkken/kit#1384). `call_line`
// above carries no tool input, so every span it writes belongs to no command phase at all — and a
// suite measuring where the merge command sat cannot express its subject without one.
function josh_call_line(minute: number, branch: string, command: string, id = CALL_ID): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command } }] },
	})
}

// An `Edit` call naming the file it edits (joshuafolkken/kit#1387). `call_line` above carries no tool
// input, so every span it writes names no target at all — and a suite measuring which edits reached the
// merged diff cannot express its subject without one.
function edit_call_line(minute: number, branch: string, file_path: string, id = CALL_ID): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_use', name: 'Edit', id, input: { file_path } }] },
	})
}

// A `Skill` call, which is what the `workflow` boundary is read off (joshuafolkken/kit#1428). The
// skill name rides in the tool input, exactly as `time-markers.ts` reads it — so a suite about which
// session actually ran a run cannot express its subject without one.
function skill_call_line(minute: number, branch: string, skill: string, id = CALL_ID): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		gitBranch: branch,
		message: { content: [{ type: 'tool_use', name: 'Skill', id, input: { skill } }] },
	})
}

// The same three minutes as `issue_lines`, opened by the workflow marker every entry point writes —
// which is what says this session is the one that ran the issue rather than one that merely had its
// branch checked out.
function run_lines(offset: number, branch: string = BRANCH): Array<string> {
	return [
		prompt_line(offset, branch),
		skill_call_line(offset + CALL_MINUTE, branch, WORKFLOW_SKILL),
		result_line(offset + RESULT_MINUTE, branch),
	]
}

// A second session working the same issue over the same three minutes, with span instants the unit's
// do not share — otherwise the cross-session dedupe collapses the two and the case says nothing.
function concurrent_lines(branch: string = BRANCH): Array<string> {
	return [
		prompt_line(0, branch),
		call_line(CONCURRENT_CALL_MINUTE, branch),
		result_line(RESULT_MINUTE, branch),
	]
}

// The same assistant line, tagged with the message it belongs to (joshuafolkken/kit#1329). Claude
// Code writes one line per content block and repeats the message id on each, which is what lets a
// turn's calls be counted exactly. `call_line` above stays untagged: every existing caller measures
// spans, where the id plays no part, and giving each of them a distinct one would say nothing.
// `input` rides along for the suites that need a call to name something (joshuafolkken/kit#1390): the
// batching guard reads the target off the input, so a case about a call that depends on an earlier one
// cannot be expressed without it. Defaulted, so every caller predating it writes exactly the line it
// always did.
function turn_call_line(
	minute: number,
	message_id: string,
	id: string,
	input: unknown = {},
): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		gitBranch: BRANCH,
		message: { id: message_id, content: [{ type: 'tool_use', name: 'Read', id, input }] },
	})
}

// The two pieces every turn builder below is assembled from, so the minute grid and the id scheme are
// written once. A drift between them would put a turn's results on a minute its calls do not precede.
function turn_minute(turn: number): number {
	return turn * TURN_MINUTES + 1
}

function call_ids(turn: number, count: number): Array<string> {
	return Array.from({ length: count }, (_unused, index) => `t${String(turn)}-c${String(index)}`)
}

// One turn: `calls` tool calls issued together under one message id, then their results.
function turn_lines(turn: number, calls: number): Array<string> {
	const ids = call_ids(turn, calls)

	return [
		...ids.map((id) => turn_call_line(turn_minute(turn), `msg-${String(turn)}`, id)),
		...ids.map((id) => result_line(turn_minute(turn) + 1, BRANCH, id)),
	]
}

// A turn whose calls have gone out and none has come back — the shape a transcript has at the instant
// a `PreToolUse` hook reads it (joshuafolkken/kit#1390). One call per target, so a case can say which
// of them a later call would depend on.
function open_turn_lines(turn: number, targets: ReadonlyArray<string>): Array<string> {
	return call_ids(turn, targets.length).map((id, index) =>
		turn_call_line(turn_minute(turn), `msg-${String(turn)}`, id, { file_path: targets[index] }),
	)
}

// The same turn, closed by the results that give its calls spans. A span exists only once its result
// has come back, which is exactly why the open half above is a builder of its own.
function target_turn_lines(turn: number, targets: ReadonlyArray<string>): Array<string> {
	const results = call_ids(turn, targets.length).map((id) =>
		result_line(turn_minute(turn) + 1, BRANCH, id),
	)

	return [...open_turn_lines(turn, targets), ...results]
}

// A whole stretch of identical turns, which is what the live-density reading is measured against: at
// `calls` of 1 the density is 1.00 and every turn is its own round trip, at 3 it is 3.00 over a third
// as many.
function density_text(turns: number, calls: number): string {
	const groups = Array.from({ length: turns }, (_unused, turn) => turn_lines(turn, calls))

	return [prompt_line(0, BRANCH), ...groups.flat()].join('\n')
}

// A hook payload whose `agent_id` is the JSON literal `null` (joshuafolkken/kit#1424).
//
// **Spliced in as text rather than set as a value**, for two reasons that point the same way: it is
// what the harness sends, and a `null` written in TypeScript source is what `unicorn/no-null` forbids.
// What the cases built on it assert is that a hook's schema reads that spelling as "no fork" instead of
// rejecting the whole payload — which would take the hook off every call of the main line, in silence.
//
// **Shared rather than restated in each suite**: both hook suites need it, and the guard and the
// density line must not come to disagree about what an absent agent looks like.
function with_null_agent(payload_json: string): string {
	return `${payload_json.slice(0, CLOSING_BRACE)},"agent_id":null}`
}

function project_directory(home: string): string {
	return path.join(home, cost_transcript.project_slug(CWD))
}

function write_transcript(directory: string, name: string, lines: ReadonlyArray<string>): void {
	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `${name}${cost_transcript.TRANSCRIPT_EXTENSION}`),
		lines.join('\n'),
	)
}

function write_session(home: string, name: string, lines: ReadonlyArray<string>): void {
	write_transcript(project_directory(home), name, lines)
}

// A delegated unit's transcript, which Claude Code writes to a subdirectory of the session that
// delegated it rather than beside that session's own file.
function write_unit(
	home: string,
	session_name: string,
	agent_name: string,
	lines: ReadonlyArray<string>,
): void {
	write_transcript(
		cost_transcript.unit_directory(project_directory(home), session_name),
		agent_name,
		lines,
	)
}

function total_span_ms(spans: ReadonlyArray<{ duration_ms: number }>): number {
	return spans.reduce((sum, one) => sum + one.duration_ms, 0)
}

// One tool span, named and placed on the minute grid, for the suites that test the arithmetic rather
// than the reading. Here rather than beside each of them because two suites now assert against spans
// built exactly this way, and a builder that drifted would let them disagree about what a span is.
function span(label: string, ended_minute: number, duration_minutes: number): Span {
	return {
		category: time_spans.TOOL_CATEGORY,
		label,
		josh_command: '',
		check_key: '',
		marker: time_markers.NO_MARKER,
		is_bundleable: false,
		targets: [],
		message_id: time_spans.NO_MESSAGE_ID,
		branch: 'main',
		call_id: '',
		outcome: time_spans.UNKNOWN_OUTCOME,
		is_continuation: false,
		ended_ms: ended_minute * MINUTE_MS,
		duration_ms: duration_minutes * MINUTE_MS,
	}
}

const time_transcript_fixture = {
	CWD,
	MINUTE_MS,
	ISSUE,
	BRANCH,
	DENSITY_TURNS,
	THREE_MINUTES_MS,
	at,
	ms,
	prompt_line,
	call_line,
	edit_call_line,
	josh_call_line,
	result_line,
	skill_call_line,
	turn_call_line,
	turn_lines,
	open_turn_lines,
	target_turn_lines,
	density_text,
	issue_lines,
	run_lines,
	delegating_lines,
	concurrent_lines,
	with_null_agent,
	project_directory,
	write_session,
	write_unit,
	total_span_ms,
	span,
}

export { time_transcript_fixture }
