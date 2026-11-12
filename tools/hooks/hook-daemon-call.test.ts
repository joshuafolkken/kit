import { closeSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_payload_capture } from '#scripts/josh/hook-payload-capture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hook_daemon_call, type CallAnswer, type DaemonCall } from './hook-daemon-call'

// The guards that read GitHub or run state are mocked as in `pretool-guard.test.ts`; the rule guard
// that refuses a shell-evaluated body runs for real, so a refusal is the one a fresh process gives.
vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

// The hand-off guard refuses a session whose ancestry holds this test's parent, as it refuses the
// session that owns a carry record, so a refusal shows which ancestry the call was judged under.
const { OWNER_REASON } = vi.hoisted(() => ({ OWNER_REASON: 'owner refused' }))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: {
		current_state: vi.fn((context: { ancestry: () => ReadonlySet<number> }) => ({
			ancestry: context.ancestry,
		})),
		parent_cut_reason: vi.fn(
			(_raw: string, _now: number, state: { ancestry: () => ReadonlySet<number> }) =>
				Promise.resolve(state.ancestry().has(process.ppid) ? OWNER_REASON : undefined),
		),
	},
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/lane/lane-phase', () => ({
	lane_phase: { mark_implement: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/josh/hook-payload-capture', () => ({
	hook_payload_capture: { capture: vi.fn() },
}))

const make_directory = temporary_directory()
const capture = vi.mocked(hook_payload_capture.capture)
const SHELL_BODY_COMMAND = 'pnpm josh notify --body="hi `date`"'
const SHELL_BODY_REASON = 'shell-evaluated body'
const CALLER_VARIABLE = 'HOOK_DAEMON_CALLER'
const STRAY_VARIABLE = 'HOOK_DAEMON_STRAY'
const LAUNCH_DIRECTORY = '/launched/here'
const ROOT_PREFIX = 'hook-daemon-root-'
// A launcher with no session above it: the root process.
const ROOT_LAUNCHER = 1
const original = { environment: { ...process.env }, cwd: process.cwd() }

function restore_test_process(): void {
	for (const key of Object.keys(process.env)) {
		if (!Object.hasOwn(original.environment, key)) Reflect.deleteProperty(process.env, key)
	}

	Object.assign(process.env, original.environment)
	process.chdir(original.cwd)
}

function bash_payload(command: string): string {
	const transcript_path = path.join(make_directory('hook-daemon-call-'), 'transcript.jsonl')

	writeFileSync(transcript_path, '{"type":"user"}\n')
	closeSync(openSync(transcript_path, 'r'))

	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path })
}

function call_of(command: string, launcher_pid = ROOT_LAUNCHER, caller = 'caller'): DaemonCall {
	const environment: Record<string, string> = {}

	for (const [key, value] of Object.entries(original.environment)) {
		if (value !== undefined) environment[key] = value
	}

	return {
		raw_payload: bash_payload(command),
		launch_directory: LAUNCH_DIRECTORY,
		launcher_pid,
		environment: { ...environment, [agent_session_role.KEY]: 'worker', [CALLER_VARIABLE]: caller },
	}
}

async function answer_from(launcher_pid: number): Promise<CallAnswer> {
	return await hook_daemon_call.answer(make_directory(ROOT_PREFIX), call_of('ls', launcher_pid))
}

beforeEach(() => {
	capture.mockClear()
})

afterEach(() => {
	restore_test_process()
})

describe('hook_daemon_call.answer', () => {
	it('puts the call environment and launch directory in place, under the start root', async () => {
		const root = realpathSync(make_directory(ROOT_PREFIX))

		process.env[STRAY_VARIABLE] = 'stray'
		await hook_daemon_call.answer(root, call_of('ls'))

		expect(process.env[STRAY_VARIABLE]).toBeUndefined()
		expect(process.env[CALLER_VARIABLE]).toBe('caller')
		expect(process.env[hook_daemon_call.LAUNCH_DIRECTORY_VARIABLE]).toBe(LAUNCH_DIRECTORY)
		expect(process.cwd()).toBe(root)
	})
})

describe('hook_daemon_call.answer — the environment', () => {
	it('answers each call under its own environment, keeping nothing of the call before', async () => {
		const root = make_directory(ROOT_PREFIX)
		const first = call_of('ls', ROOT_LAUNCHER, 'first')

		await hook_daemon_call.answer(root, {
			...first,
			environment: { ...first.environment, [STRAY_VARIABLE]: 'first only' },
		})
		await hook_daemon_call.answer(root, call_of('ls', ROOT_LAUNCHER, 'second'))

		expect(process.env[CALLER_VARIABLE]).toBe('second')
		expect(process.env[STRAY_VARIABLE]).toBeUndefined()
	})
})

describe('hook_daemon_call.answer — the guard', () => {
	it('captures the payload under the pretool guard command', async () => {
		await answer_from(ROOT_LAUNCHER)

		expect(capture).toHaveBeenCalledWith('pretool:guard', expect.stringContaining('"ls"'))
	})

	it('answers a refusal with the deny envelope a fresh guard process writes', async () => {
		const answer = await hook_daemon_call.answer(
			make_directory(ROOT_PREFIX),
			call_of(SHELL_BODY_COMMAND),
		)

		expect(answer.status).toBe(0)
		expect(answer.stdout).toContain(SHELL_BODY_REASON)
		expect(answer.stdout).toContain('"deny"')
	})
})

describe('hook_daemon_call.answer — the ancestry', () => {
	it('refuses the session above the launcher, as a fresh guard under that launcher does', async () => {
		const { stdout } = await answer_from(process.pid)

		expect(stdout).toContain(OWNER_REASON)
	})

	it('judges the ancestry from the launcher, not from the answering process', async () => {
		const { stdout } = await answer_from(ROOT_LAUNCHER)

		expect(stdout).not.toContain(OWNER_REASON)
	})
})

describe('hook_daemon_call.parse_environment', () => {
	it('reads one variable per line, with escaped percent signs and line breaks put back', () => {
		expect(hook_daemon_call.parse_environment('A=1%252\nB=x=y%0Az\n\n')).toStrictEqual({
			A: '1%2',
			B: 'x=y\nz',
		})
	})
})
