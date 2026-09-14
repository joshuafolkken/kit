import { describe, expect, it } from 'vitest'
import { cost_cli } from './cost-cli'
import { cost_cli_fixture } from './cost-cli-fixture'

// **`--path` says where to read, not which run** (joshuafolkken/kit#1987): from the kit checkout it
// aims the transcript read at another project rather than at the process cwd.
const { CWD, MAIN, SESSION_A } = cost_cli_fixture
const { usage_line, write_session, write_session_under, output } = cost_cli_fixture
// A project other than the process cwd, so `--path` is seen to read a directory it was not already in.
const TARGET = '/Users/someone/Development/other-project'
const FAILURE_EXIT_CODE = 1

cost_cli_fixture.capture_console()

describe('cost_cli.parse_options — the target project path', () => {
	it('reads --path as the target project directory', () => {
		expect(cost_cli.parse_options(['--path', TARGET])?.path).toBe(TARGET)
	})

	it('reads --path beside a scope rather than as a competing one', () => {
		expect(cost_cli.parse_options(['--session', SESSION_A, '--path', TARGET])).toMatchObject({
			session: SESSION_A,
			path: TARGET,
		})
	})
})

describe('cost_cli.run — the target project path', () => {
	it('reads the transcripts of the project named by --path', () => {
		write_session_under(TARGET, SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', SESSION_A, '--path', TARGET], CWD)).toBe(0)
		expect(output()).toContain(`session ${SESSION_A}`)
	})

	// Given --path, the read does not fall back to the process cwd, even though it has a transcript.
	it('does not read the process cwd when --path names another project', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', SESSION_A, '--path', TARGET], CWD)).toBe(FAILURE_EXIT_CODE)
	})

	// Unspecified --path keeps the former behavior: this process's own working directory.
	it('reads the process cwd when --path is absent', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', SESSION_A], CWD)).toBe(0)
		expect(output()).toContain(`session ${SESSION_A}`)
	})
})
