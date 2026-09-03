import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_cli } from './time-cli'

const CWD = '/Users/someone/Development/kit'
const SESSION = 'session-one'
const MINUTE_MS = 60_000

// Mutated properties rather than reassigned bindings, so `beforeEach` never assigns to a top-level
// variable from inside a function — the idiom `cost-cli.test.ts` uses for the same reason.
const state = { home: '', printed: [] as Array<string> }

function capture(message: unknown): void {
	state.printed.push(String(message))
}

// The whole discovery path is `cost_transcript`'s, so redirecting its one directory function is what
// points the command at a temporary home. That it works at all is the acceptance criterion the Issue
// states: a second copy of the slug rule would ignore this and read the real transcripts.
beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'time-cli-'))
	state.printed = []
	vi.spyOn(console, 'info').mockImplementation(capture)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
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

describe('josh time registration', () => {
	it('is registered as a josh command', () => {
		const { time } = COMMAND_MAP

		expect(time?.script).toBe('scripts/time/time-cli.ts')
	})
})

describe('time_cli.parse_options', () => {
	it('defaults to the newest session and the text report', () => {
		expect(time_cli.parse_options([])).toEqual({ is_json: false })
	})

	it('reads --session and --json', () => {
		expect(time_cli.parse_options(['--session', 'abc', '--json'])).toEqual({
			session: 'abc',
			is_json: true,
		})
	})

	// A refusal, not a silent default: a mistyped flag must not report some other session's time as
	// though it were the one asked for.
	it('refuses a flag it does not know', () => {
		expect(time_cli.parse_options(['--nope'])).toBeUndefined()
	})
})

describe('time_cli.pick_session', () => {
	it('finds a named session, and the newest one with no name', () => {
		write_session()

		expect(time_cli.pick_session(CWD, SESSION)?.session_id).toBe(SESSION)
		expect(time_cli.pick_session(CWD, undefined)?.session_id).toBe(SESSION)
	})

	it('answers undefined for a session that is not there', () => {
		write_session()

		expect(time_cli.pick_session(CWD, 'missing')).toBeUndefined()
	})
})

describe('time_cli.run', () => {
	it('prints the three-way split for the newest session', () => {
		write_session()

		expect(time_cli.run([], CWD)).toBe(0)
		expect(output()).toContain(`session ${SESSION}`)
		expect(output()).toContain('tool execution')
	})

	it('reports the same figures as JSON under --json', () => {
		write_session()

		expect(time_cli.run(['--json'], CWD)).toBe(0)
		expect(JSON.parse(output())).toMatchObject({
			session_id: SESSION,
			elapsed_ms: 3 * MINUTE_MS,
			categories: { model_ms: MINUTE_MS, tool_ms: 2 * MINUTE_MS, human_ms: 0 },
		})
	})

	it('names the tool the time was spent in, under --json', () => {
		write_session()
		time_cli.run(['--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			by_tool: [{ label: 'Read', duration_ms: 2 * MINUTE_MS, call_count: 1 }],
		})
	})

	// "No transcript was found" and "this run took no time" are different answers, and only one of
	// them is ever true — so an absent transcript exits non-zero rather than printing zeroes.
	it('fails rather than timing an absent transcript at zero', () => {
		write_session()

		expect(time_cli.run(['--session', 'missing'], CWD)).toBe(1)
		expect(output()).toBe('')
	})

	it('fails when there is no transcript directory at all', () => {
		expect(time_cli.run([], CWD)).toBe(1)
	})

	it('fails on an unknown flag', () => {
		expect(time_cli.run(['--nope'], CWD)).toBe(1)
	})
})
