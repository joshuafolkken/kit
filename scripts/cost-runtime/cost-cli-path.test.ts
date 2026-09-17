import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { codex_usage } from './codex-usage'
import { cost_cli } from './cost-cli'
import { cost_cli_fixture } from './cost-cli-fixture'

// **`--path` says where to read, not which run** (joshuafolkken/kit#1987): from the kit checkout it
// aims the transcript read at another project rather than at the process cwd.
const { CWD, MAIN, SESSION_A } = cost_cli_fixture
const { usage_line, write_session, write_session_under, output } = cost_cli_fixture
// A project other than the process cwd, so `--path` is seen to read a directory it was not already in.
const TARGET = '/Users/someone/Development/other-project'
const FAILURE_EXIT_CODE = 1
const ANTHROPIC_ENV = { CLAUDE_CODE_SESSION_ID: 'session' }
const OPENAI_ENV = { CODEX_THREAD_ID: 'thread' }
const NO_TRANSCRIPTS = 'No transcripts found'
const PER_REQUEST = 'per request'
const WORKTREE_GIT_PATH = '.git/worktrees/2089'
const ISSUE = '2089'
const THREAD_ID = 'active-thread'

cost_cli_fixture.capture_console()

function write_active_rollout(codex_home: string, lane: string): void {
	const directory = path.join(codex_home, 'sessions/2026/09/17')

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `rollout-${THREAD_ID}.jsonl`),
		[
			JSON.stringify({ type: 'session_meta', payload: { id: THREAD_ID, cwd: lane } }),
			JSON.stringify({
				type: 'event_msg',
				payload: {
					type: 'token_count',
					info: {
						total_token_usage: { input_tokens: 1 },
						last_token_usage: { input_tokens: 1 },
					},
				},
			}),
		].join('\n'),
	)
}

function linked_rollout(): { main: string; lane: string; environment: Record<string, string> } {
	const main = mkdtempSync(path.join(os.tmpdir(), 'cost-openai-main-'))
	const lane_root = mkdtempSync(path.join(os.tmpdir(), 'cost-openai-lanes-'))
	const lane = path.join(lane_root, ISSUE)
	const codex_home = mkdtempSync(path.join(os.tmpdir(), 'cost-openai-home-'))

	mkdirSync(path.join(main, WORKTREE_GIT_PATH), { recursive: true })
	mkdirSync(lane, { recursive: true })
	writeFileSync(path.join(lane, '.git'), `gitdir: ${path.join(main, WORKTREE_GIT_PATH)}`)
	write_active_rollout(codex_home, lane)

	return {
		main,
		lane,
		environment: {
			CODEX_HOME: codex_home,
			CODEX_THREAD_ID: THREAD_ID,
			JOSH_LANE_ROOT: lane_root,
		},
	}
}

describe('cost_cli.parse_options — the target project path', () => {
	it('reads --path as the target project directory', () => {
		expect(cost_cli.parse_options(['--path', TARGET])?.path).toBe(TARGET)
	})

	it('reads --path beside the threshold rather than as a competing flag', () => {
		expect(cost_cli.parse_options(['--over', '1', '--path', TARGET])).toMatchObject({
			over: 1,
			path: TARGET,
		})
	})
})

describe('cost_cli.run — the target project path', () => {
	it('reads the transcripts of the project named by --path', () => {
		write_session_under(TARGET, SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '0', '--path', TARGET], CWD, ANTHROPIC_ENV)).toBe(0)
		expect(output()).toContain(PER_REQUEST)
	})

	// Given --path, the read does not fall back to the process cwd, even though it has a transcript.
	it('does not read the process cwd when --path names another project', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '0', '--path', TARGET], CWD, ANTHROPIC_ENV)).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(output()).toContain(NO_TRANSCRIPTS)
	})

	// Unspecified --path keeps the former behavior: this process's own working directory.
	it('reads the process cwd when --path is absent', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '0'], CWD, ANTHROPIC_ENV)).toBe(0)
		expect(output()).toContain(PER_REQUEST)
	})
})

describe('cost_cli.run — OpenAI path scope', () => {
	it('refuses an OpenAI path in another project without reading a thread', () => {
		const measurement = vi.spyOn(codex_usage, 'measurement')

		expect(cost_cli.run(['--over', '0', '--path', TARGET], CWD, OPENAI_ENV)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain('OpenAI --path cannot select a thread from another project')
		expect(measurement).not.toHaveBeenCalled()
	})

	it('reads the active lane rollout when --path names its linked main checkout', () => {
		const { main, lane, environment } = linked_rollout()

		expect(cost_cli.run(['--over', '0', '--path', main], lane, environment)).toBe(0)
		expect(output()).toContain('over')
	})
})
