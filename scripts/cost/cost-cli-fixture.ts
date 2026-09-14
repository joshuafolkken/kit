import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { cost_transcript } from './cost-transcript'

// What the `josh cost` CLI suites read, shared so the split-out `--path` suite and the main suite
// cannot come to disagree about what the command was handed (joshuafolkken/kit#1987) — the same seam
// `time-cli-fixture.ts` was cut along. Redirecting `transcript_directories` to a temporary home is
// the acceptance criterion #1267 states: a second copy of the slug rule would read the real
// transcripts instead.

const CWD = '/Users/someone/Development/kit'
const MAIN = 'main'
const SESSION_A = 'session-a'
const ISSUE_BRANCH = '962-report-the-token-and-credit-cost-of-a-run'
const MODEL = 'claude-opus-5'
const THINKING_TOKENS = 7
// The output-token count the populated session bills — named because a fixture is not a test file
// and the magic-number rule applies to it, the same reason `time-cli-fixture.ts` names its own.
const POPULATED_OUTPUT_TOKENS = 10

function usage_line(request_id: string, branch: string, output_tokens: number): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: request_id,
		gitBranch: branch,
		message: { model: MODEL, usage: { input_tokens: 1, output_tokens } },
	})
}

// A line carrying both a usage block and content, which is what the two decompositions read
// (joshuafolkken/kit#1151). `usage_line` deliberately carries no content, so the older suites keep
// exercising the usage reader on its own.
function content_line(command: string): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: 'r2',
		gitBranch: ISSUE_BRANCH,
		message: {
			model: MODEL,
			usage: {
				input_tokens: 1,
				output_tokens: 5,
				output_tokens_details: { thinking_tokens: THINKING_TOKENS },
			},
			content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
		},
	})
}

// Mutated properties rather than reassigned bindings, so `beforeEach` never assigns to a top-level
// variable from inside a function.
const state = { home: '', printed: [] as Array<string>, out: [] as Array<string> }

function capture(message: unknown): void {
	state.printed.push(String(message))
}

// stdout only. The `--over` verdict goes to stdout and its explanation to stderr, and the explanation
// contains the word "over" whatever the verdict is — so a test reading both streams together passes
// on an inverted verdict.
function capture_out(message: unknown): void {
	state.out.push(String(message))
	state.printed.push(String(message))
}

// **The hooks are registered by calling this, not by importing it**, so a suite that wants the
// capture asks for it in one line and one that does not is untouched.
function capture_console(): void {
	beforeEach(() => {
		state.home = mkdtempSync(path.join(tmpdir(), 'cost-cli-'))
		state.printed = []
		state.out = []
		vi.spyOn(console, 'info').mockImplementation(capture_out)
		vi.spyOn(console, 'error').mockImplementation(capture)
		vi.spyOn(cost_transcript, 'transcript_directories').mockImplementation((cwd: string) => [
			path.join(state.home, cost_transcript.project_slug(cwd)),
		])
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})
}

function write_session_under(cwd: string, session_id: string, lines: ReadonlyArray<string>): void {
	const directory = path.join(state.home, cost_transcript.project_slug(cwd))

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${session_id}.jsonl`), lines.join('\n'))
}

function write_session(session_id: string, lines: ReadonlyArray<string>): void {
	write_session_under(CWD, session_id, lines)
}

function write_populated(): void {
	write_session(SESSION_A, [
		usage_line('r1', MAIN, POPULATED_OUTPUT_TOKENS),
		content_line('git status --short'),
	])
}

function output(): string {
	return state.printed.join('\n')
}

function stdout(): string {
	return state.out.join('\n')
}

const cost_cli_fixture = {
	CWD,
	MAIN,
	SESSION_A,
	ISSUE_BRANCH,
	MODEL,
	THINKING_TOKENS,
	usage_line,
	content_line,
	write_session,
	write_session_under,
	write_populated,
	output,
	stdout,
	capture_console,
}

export { cost_cli_fixture }
