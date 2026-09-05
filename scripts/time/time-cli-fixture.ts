import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { afterEach, beforeEach, vi } from 'vitest'
import { time_bundles } from './time-bundles'
import { time_failures } from './time-failures'
import { time_gaps } from './time-gaps'
import type { TimeReport } from './time-report'
import { time_rework } from './time-rework'
import { time_tool_turns } from './time-tool-turns'

// What the `josh time` CLI suites read (joshuafolkken/kit#1312).
//
// It was `time-cli.test.ts`'s own preamble until the batch scopes needed a file of their own — the
// suite had reached its line ceiling, the same seam `time-epic-children.test.ts` was cut along. The
// console capture, the temporary transcript home and the one run report both suites assert against
// live here so the two cannot come to disagree about what the command was handed.

const CWD = '/Users/someone/Development/kit'
const MINUTE_MS = 60_000
const ISSUE = 1268
const RUN_SCOPE = `issue #${String(ISSUE)}`
const FIXTURE_YEAR = 2026

// Mutated properties rather than reassigned bindings, so `beforeEach` never assigns to a top-level
// variable from inside a function — the idiom `cost-cli.test.ts` uses for the same reason.
const state = { home: '', printed: [] as Array<string>, errors: [] as Array<string> }

function capture(message: unknown): void {
	state.printed.push(String(message))
}

function capture_error(message: unknown): void {
	state.errors.push(String(message))
}

// The whole discovery path is `cost_transcript`'s, so redirecting its one directory function is what
// points the command at a temporary home. That it works at all is the acceptance criterion #1267
// states: a second copy of the slug rule would ignore this and read the real transcripts.
//
// **The hooks are registered by calling this, not by importing it**, so a suite that wants the
// capture asks for it in one line and one that does not is untouched.
function capture_console(): void {
	beforeEach(() => {
		state.home = mkdtempSync(path.join(tmpdir(), 'time-cli-'))
		state.printed = []
		state.errors = []
		vi.spyOn(console, 'info').mockImplementation(capture)
		vi.spyOn(console, 'error').mockImplementation(capture_error)
		vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
			path.join(state.home, cost_transcript.project_slug(cwd)),
		)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})
}

function home(): string {
	return state.home
}

function output(): string {
	return state.printed.join('\n')
}

function errors(): string {
	return state.errors.join('\n')
}

function at(minute: number): string {
	return new Date(Date.UTC(FIXTURE_YEAR, 0, 1, 0, minute)).toISOString()
}

// The lengths `RUN_REPORT` is made of, named because a fixture is not a test file and the
// magic-number rule applies to it — the same reason `time-report-fixture.ts` names its own.
const RUN_MINUTES = 8
const SPAN_COUNT = 2
const TRIP_MINUTES = 3
const TOOL_MINUTES = 2
const CI_MINUTES = 5

// One measured run, which is what every batch scope's rows are made of. Held here rather than in each
// suite so a batch's assertions are about the batch rather than about a second idea of a run.
const RUN_REPORT: TimeReport = {
	scope: RUN_SCOPE,
	started_at: at(0),
	ended_at: at(RUN_MINUTES),
	elapsed_ms: RUN_MINUTES * MINUTE_MS,
	span_count: SPAN_COUNT,
	turn_count: 1,
	tool_call_count: 1,
	round_trip_count: 1,
	...time_tool_turns.NO_TURN_SPLIT,
	ms_per_round_trip: TRIP_MINUTES * MINUTE_MS,
	model_ms_per_round_trip: MINUTE_MS,
	categories: {
		model_ms: MINUTE_MS,
		tool_ms: TOOL_MINUTES * MINUTE_MS,
		human_ms: 0,
		ci_ms: CI_MINUTES * MINUTE_MS,
	},
	has_ci_data: true,
	notes: ['1 session(s)'],
	phases: [],
	segments: [],
	by_tool: [],
	by_josh_command: [],
	by_invocation: [],
	by_check: [],
	gaps: { ...time_gaps.NO_GAPS },
	bundles: { ...time_bundles.NO_BUNDLES },
	rework: { ...time_rework.NO_REWORK },
	failures: { ...time_failures.NO_FAILURES },
}

const time_cli_fixture = {
	CWD,
	MINUTE_MS,
	RUN_MINUTES,
	CI_MINUTES,
	ISSUE,
	RUN_SCOPE,
	RUN_REPORT,
	at,
	capture_console,
	home,
	output,
	errors,
}

export { time_cli_fixture }
