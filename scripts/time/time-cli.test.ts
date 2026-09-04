import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_cli } from './time-cli'
import { time_epic, type EpicTimeReport } from './time-epic'
import { time_failures } from './time-failures'
import type { TimeReport } from './time-report'
import { time_run } from './time-run'

const CWD = '/Users/someone/Development/kit'
const SESSION = 'session-one'
const MINUTE_MS = 60_000
const ISSUE = 1268

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
// points the command at a temporary home. That it works at all is the acceptance criterion the Issue
// states: a second copy of the slug rule would ignore this and read the real transcripts.
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

function at(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
}

function prompt_line(minute: number): string {
	return JSON.stringify({ type: 'user', timestamp: at(minute), message: { content: 'go' } })
}

function call_line(minute: number): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		message: { content: [{ type: 'tool_use', name: 'Read', id: 'a' }] },
	})
}

function result_line(minute: number): string {
	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),

		message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
	})
}

function write_session(): void {
	const directory = path.join(state.home, cost_transcript.project_slug(CWD))

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `${SESSION}${cost_transcript.TRANSCRIPT_EXTENSION}`),
		[prompt_line(0), call_line(1), result_line(3)].join('\n'),
	)
}

function output(): string {
	return state.printed.join('\n')
}

function errors(): string {
	return state.errors.join('\n')
}

describe('josh time registration', () => {
	it('is registered as a josh command', () => {
		const { time } = COMMAND_MAP

		expect(time?.script).toBe('scripts/time/time-cli.ts')
	})
})

describe('time_cli.parse_options', () => {
	it('defaults to the most recently merged run and the text report', () => {
		expect(time_cli.parse_options([])).toEqual({ is_json: false })
	})

	it('reads --session and --json', () => {
		expect(time_cli.parse_options(['--session', 'abc', '--json'])).toEqual({
			session: 'abc',
			is_json: true,
		})
	})

	it('reads --issue as a number', () => {
		expect(time_cli.parse_options(['--issue', '1268'])).toEqual({ issue: 1268, is_json: false })
	})

	// A refusal, not a silent default: a mistyped flag must not report some other scope's time as
	// though it were the one asked for.
	it('refuses a flag it does not know', () => {
		expect(time_cli.parse_options(['--nope'])).toBeUndefined()
	})

	// Non-positive values collide with `cost_attribute`'s unattributed sentinel, which would report
	// that bucket as though it were an issue's run.
	it('refuses an --issue that is not a positive whole number', () => {
		expect(time_cli.parse_options(['--issue', 'abc'])).toBeUndefined()
		expect(time_cli.parse_options(['--issue', '-1'])).toBeUndefined()
		expect(time_cli.parse_options(['--issue', '0'])).toBeUndefined()
	})

	it('refuses both scopes at once, which name different things', () => {
		expect(time_cli.parse_options(['--issue', '1', '--session', 'abc'])).toBeUndefined()
	})
})

// The row cap narrows whichever scope was asked for rather than naming one, so it is read beside a
// scope and never counted as a second one (joshuafolkken/kit#1301).
describe('time_cli.parse_options — the row cap', () => {
	it('reads --top as a number, beside a scope rather than instead of one', () => {
		expect(time_cli.parse_options(['--issue', '1268', '--top', '5'])).toEqual({
			issue: 1268,
			top: 5,
			is_json: false,
		})
	})

	// A cap that did not parse must not quietly become "carry every row", which is the opposite of
	// what was asked for.
	it('refuses a --top that is not a positive whole number', () => {
		expect(time_cli.parse_options(['--top', 'abc'])).toBeUndefined()
		expect(time_cli.parse_options(['--top', '0'])).toBeUndefined()
	})
})

describe('time_cli.parse_options — the epic scope', () => {
	it('reads --epic as a number', () => {
		expect(time_cli.parse_options(['--epic', '1272'])).toMatchObject({
			epic: 1272,
			is_json: false,
		})
	})

	// The same rule `--issue` follows: a flag that was given but did not parse is a refusal, never a
	// silent fall back to the most recent run.
	it('refuses an --epic that is not a positive whole number', () => {
		expect(time_cli.parse_options(['--epic', 'abc'])).toBeUndefined()
		expect(time_cli.parse_options(['--epic', '0'])).toBeUndefined()
	})

	it('refuses --epic beside another scope', () => {
		expect(time_cli.parse_options(['--epic', '1', '--issue', '2'])).toBeUndefined()
		expect(time_cli.parse_options(['--epic', '1', '--session', 'abc'])).toBeUndefined()
	})
})

describe('time_cli.pick_session', () => {
	it('finds a named session', () => {
		write_session()

		expect(time_cli.pick_session(CWD, SESSION)?.session_id).toBe(SESSION)
	})

	it('answers undefined for a session that is not there', () => {
		write_session()

		expect(time_cli.pick_session(CWD, 'missing')).toBeUndefined()
	})
})

const SESSION_SCOPE = `session ${SESSION}`

describe('time_cli.run — one session', () => {
	it('prints the three-way split for a named session', async () => {
		write_session()

		expect(await time_cli.run(['--session', SESSION], CWD)).toBe(0)
		expect(output()).toContain(SESSION_SCOPE)
		expect(output()).toContain('tool execution')
	})

	it('reports the same figures as JSON under --json', async () => {
		write_session()

		expect(await time_cli.run(['--session', SESSION, '--json'], CWD)).toBe(0)
		expect(JSON.parse(output())).toMatchObject({
			scope: SESSION_SCOPE,
			elapsed_ms: 3 * MINUTE_MS,
			categories: { model_ms: MINUTE_MS, tool_ms: 2 * MINUTE_MS, human_ms: 0, ci_ms: 0 },
		})
	})

	it('names the tool the time was spent in, under --json', async () => {
		write_session()
		await time_cli.run(['--session', SESSION, '--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			by_tool: [{ label: 'Read', duration_ms: 2 * MINUTE_MS, call_count: 1 }],
		})
	})
})

describe('time_cli.run — refusals', () => {
	// "No transcript was found" and "this run took no time" are different answers, and only one of
	// them is ever true — so an absent transcript exits non-zero rather than printing zeroes.
	it('fails rather than timing an absent transcript at zero', async () => {
		write_session()

		expect(await time_cli.run(['--session', 'missing'], CWD)).toBe(1)
		expect(output()).toBe('')
	})

	it('fails on an unknown flag', async () => {
		expect(await time_cli.run(['--nope'], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.USAGE)
	})

	it('names the mistake when both scopes were given', async () => {
		expect(await time_cli.run(['--issue', '1', '--session', 'a'], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.ONE_SCOPE)
	})
})

const RUN_SCOPE = `issue #${String(ISSUE)}`

const RUN_REPORT: TimeReport = {
	scope: RUN_SCOPE,
	started_at: at(0),
	ended_at: at(8),
	elapsed_ms: 8 * MINUTE_MS,
	span_count: 2,
	turn_count: 1,
	tool_call_count: 1,
	round_trip_count: 1,
	ms_per_round_trip: 3 * MINUTE_MS,
	model_ms_per_round_trip: MINUTE_MS,
	categories: { model_ms: MINUTE_MS, tool_ms: 2 * MINUTE_MS, human_ms: 0, ci_ms: 5 * MINUTE_MS },
	has_ci_data: true,
	notes: ['1 session(s)'],
	phases: [],
	by_tool: [],
	by_josh_command: [],
	by_check: [],
	failures: time_failures.NO_FAILURES,
}

describe('time_cli.run — one run', () => {
	it('reports the issue scope under --issue', async () => {
		vi.spyOn(time_run, 'build_run_report').mockResolvedValue(RUN_REPORT)

		expect(await time_cli.run(['--issue', String(ISSUE)], CWD)).toBe(0)
		expect(output()).toContain(RUN_SCOPE)
		expect(output()).toContain('CI wait')
	})

	it('resolves the most recently merged run when no scope was named', async () => {
		const build = vi.spyOn(time_run, 'build_latest_run_report').mockResolvedValue(RUN_REPORT)

		expect(await time_cli.run([], CWD)).toBe(0)
		expect(build).toHaveBeenCalledWith(CWD)
		expect(output()).toContain(RUN_SCOPE)
	})

	// Never silent: a repository with nothing merged is told so and pointed at the two flags that
	// name a scope explicitly.
	it('says so rather than reporting some other scope when nothing merged', async () => {
		vi.spyOn(time_run, 'build_latest_run_report').mockResolvedValue(undefined)

		expect(await time_cli.run([], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.NO_MERGED_RUN)
	})

	// `--issue=5 --session=abc` is the same mistake as the space-separated form, and naming the
	// grammar instead of the mistake helps nobody who wrote it that way.
	it('names the both-scopes mistake in the equals form too', async () => {
		expect(await time_cli.run(['--issue=1', '--session=abc'], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.ONE_SCOPE)
	})
})

const EPIC = 1272
const EPIC_SCOPE = `epic #${String(EPIC)}`

const EPIC_REPORT: EpicTimeReport = {
	scope: EPIC_SCOPE,
	epic_number: EPIC,
	children: [
		{ issue_number: ISSUE, status: 'measured', ms_per_turn: MINUTE_MS, report: RUN_REPORT },
	],
	total_ms: 8 * MINUTE_MS,
	categories: RUN_REPORT.categories,
	has_transcript_data: true,
	has_ci_data: true,
	timed_count: 1,
	measured_count: 1,
	unmeasured_count: 0,
	trend: { is_comparable: false, first_ms_per_turn: 0, last_ms_per_turn: 0, child_count: 1 },
	notes: [],
}

describe('time_cli.run — one epic', () => {
	it('reports the batch child by child under --epic', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(EPIC_REPORT)

		expect(await time_cli.run(['--epic', String(EPIC)], CWD)).toBe(0)
		expect(output()).toContain(EPIC_SCOPE)
		expect(output()).toContain(`#${String(ISSUE)}`)
	})

	// The acceptance criterion the whole scope exists for: `--json` carries per child what `--issue`
	// carries for one run, breakdown included, rather than only the batch's headline figures.
	it('carries each child’s own breakdown under --json', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(EPIC_REPORT)
		await time_cli.run(['--epic', String(EPIC), '--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			scope: EPIC_SCOPE,
			children: [
				{
					issue_number: ISSUE,
					status: 'measured',
					report: { categories: { ci_ms: 5 * MINUTE_MS }, phases: [] },
				},
			],
		})
	})

	// An unreadable epic is a failure, not an empty batch: reporting "0 children" would assert
	// something nobody established.
	it('fails rather than reporting an empty batch when the epic could not be read', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(undefined)

		expect(await time_cli.run(['--epic', String(EPIC)], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.NO_EPIC)
		expect(output()).toBe('')
	})
})
