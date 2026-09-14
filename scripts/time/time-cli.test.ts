import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { time_cli } from './time-cli'
import { time_cli_fixture } from './time-cli-fixture'

// The only scope is the run tree (joshuafolkken/kit#2017): the additional report scopes and the
// `--instructions` / `--top` modifiers they carried were retired, so the suite covers parsing, the
// run-tree default, the retired flags reaching a refusal, and `--path`.
const { CWD, at, output, errors } = time_cli_fixture

time_cli_fixture.capture_console()

const SESSION = 'session-one'
// A project other than the process cwd, so `--path` is seen to read a directory it was not already in.
const TARGET = '/Users/someone/Development/other-project'

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

function write_session_under(cwd: string): void {
	const directory = path.join(time_cli_fixture.home(), cost_transcript.project_slug(cwd))

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `${SESSION}${cost_transcript.TRANSCRIPT_EXTENSION}`),
		[prompt_line(0), call_line(1), result_line(3)].join('\n'),
	)
}

describe('josh time registration', () => {
	it('is registered as a josh command', () => {
		const { time } = COMMAND_MAP

		expect(time?.script).toBe('scripts/time/time-cli.ts')
	})
})

const RETIRED_FLAGS = ['--issue', '--session', '--epic', '--last', '--period', '--top'] as const

describe('time_cli.parse_options', () => {
	it('defaults to the run tree and the text report', () => {
		expect(time_cli.parse_options([])).toEqual({ is_json: false, path: undefined })
	})

	it('reads --run and --json as the run-tree scope', () => {
		expect(time_cli.parse_options(['--run', '--json'])).toEqual({ is_json: true, path: undefined })
	})

	// A refusal, not a silent default: a mistyped flag must not report the run tree as though the
	// mistake had been understood.
	it('refuses a flag it does not know', () => {
		expect(time_cli.parse_options(['--nope'])).toBeUndefined()
	})

	// The five additional report scopes and the two modifiers they carried are gone, so every one of
	// them is now an unknown flag (joshuafolkken/kit#2017).
	it('refuses each retired scope and modifier flag', () => {
		for (const flag of RETIRED_FLAGS) expect(time_cli.parse_options([flag, '1'])).toBeUndefined()

		expect(time_cli.parse_options(['--instructions'])).toBeUndefined()
	})
})

describe('time_cli.parse_options — the target project path', () => {
	it('reads --path as the target project directory', () => {
		expect(time_cli.parse_options(['--path', TARGET])).toMatchObject({ path: TARGET })
	})

	it('leaves the path unset when it is not given', () => {
		expect(time_cli.parse_options([])?.path).toBeUndefined()
	})
})

describe('time_cli.run — the run tree', () => {
	// joshuafolkken/kit#1937: the bare default is the run tree, not the last merged run — which under a
	// batch is one lane child.
	it('reports the run tree when no flag was named', async () => {
		write_session_under(CWD)

		expect(await time_cli.run([], CWD)).toBe(0)
		expect(output()).toContain('run tree')
	})

	// An empty store is reported in words, never as a zero-cost run.
	it('reports the empty run tree in words when nothing was found', async () => {
		expect(await time_cli.run([], CWD)).toBe(1)
		expect(errors()).toContain('No transcripts found')
	})

	it('fails on an unknown flag', async () => {
		expect(await time_cli.run(['--nope'], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.USAGE)
	})

	// A retired scope flag reaches the same refusal (joshuafolkken/kit#2017).
	it('fails on a retired scope flag', async () => {
		expect(await time_cli.run(['--epic', '1272'], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.USAGE)
	})
})

describe('time_cli.run — the target project path', () => {
	// The point of joshuafolkken/kit#1987: from the kit checkout, `--path` aims the read at another
	// project rather than at the process cwd.
	it('reads the run tree of the project named by --path', async () => {
		write_session_under(TARGET)

		expect(await time_cli.run(['--path', TARGET], CWD)).toBe(0)
		expect(output()).toContain('run tree')
	})

	// Given --path, the read does not fall back to the process cwd — the target's absence is reported
	// even though the process cwd has a transcript of its own.
	it('does not read the process cwd when --path names another project', async () => {
		write_session_under(CWD)

		expect(await time_cli.run(['--path', TARGET], CWD)).toBe(1)
		expect(output()).toBe('')
	})
})
