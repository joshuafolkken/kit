import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it, vi } from 'vitest'
import { time_cli } from './time-cli'
import { time_cli_fixture } from './time-cli-fixture'
import { time_run } from './time-run'

// The console capture, the temporary transcript home and the one run report are
// `time-cli-fixture.ts`'s, shared with the suite that covers the two batch scopes
// (joshuafolkken/kit#1312).
const { CWD, MINUTE_MS, ISSUE, RUN_SCOPE, RUN_REPORT, at, output, errors } = time_cli_fixture

time_cli_fixture.capture_console()

const SESSION = 'session-one'

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
	const directory = path.join(time_cli_fixture.home(), cost_transcript.project_slug(CWD))

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

describe('time_cli.parse_options — the last-N scope', () => {
	it('reads --last as a number', () => {
		expect(time_cli.parse_options(['--last', '5'])).toMatchObject({ last: 5, is_json: false })
	})

	// The same rule every numeric flag follows. `--last 0` is refused rather than read as "every run":
	// a distribution over no run is not a smaller answer, it is none.
	it('refuses a --last that is not a positive whole number', () => {
		expect(time_cli.parse_options(['--last', 'abc'])).toBeUndefined()
		expect(time_cli.parse_options(['--last', '0'])).toBeUndefined()
	})

	it('refuses --last beside another scope', () => {
		expect(time_cli.parse_options(['--last', '5', '--epic', '1'])).toBeUndefined()
		expect(time_cli.parse_options(['--last', '5', '--issue', '2'])).toBeUndefined()
	})

	// The row cap narrows whichever scope was asked for, so it is read beside this one too.
	it('reads --top beside it rather than instead of it', () => {
		expect(time_cli.parse_options(['--last', '5', '--top', '5'])).toMatchObject({
			last: 5,
			top: 5,
		})
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
			by_tool: [
				{
					label: 'Read',
					duration_ms: 2 * MINUTE_MS,
					call_count: 1,
					// The two counts joshuafolkken/kit#1385 added, asserted here so `--json` is known to carry
					// them: `diag` reads the JSON and never the printed table.
					round_trip_count: 1,
					alone_in_turn_count: 1,
				},
			],
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
