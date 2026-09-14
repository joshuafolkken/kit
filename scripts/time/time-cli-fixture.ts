import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { afterEach, beforeEach, vi } from 'vitest'

// The console capture and the temporary transcript home the `josh time` CLI suite reads
// (joshuafolkken/kit#1312). Held apart from the test so a suite that wants the capture asks for it in
// one line and the discovery path stays `cost_transcript`'s — a second copy of the slug rule would
// read the real transcripts rather than the temporary home.

const CWD = '/Users/someone/Development/kit'
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

function capture_console(): void {
	beforeEach(() => {
		state.home = mkdtempSync(path.join(tmpdir(), 'time-cli-'))
		state.printed = []
		state.errors = []
		vi.spyOn(console, 'info').mockImplementation(capture)
		vi.spyOn(console, 'error').mockImplementation(capture_error)
		vi.spyOn(cost_transcript, 'transcript_directories').mockImplementation((cwd: string) => [
			path.join(state.home, cost_transcript.project_slug(cwd)),
		])
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

const time_cli_fixture = {
	CWD,
	at,
	capture_console,
	home,
	output,
	errors,
}

export { time_cli_fixture }
