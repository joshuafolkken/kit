import { closeSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_payload_capture } from '#scripts/josh/hook-payload-capture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hook_daemon_call, type CallAnswer, type DaemonOrigin } from './hook-daemon-call'

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
const ORIGIN_VARIABLE = 'HOOK_DAEMON_ORIGIN'
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

function origin_under(root: string): DaemonOrigin {
	return {
		root,
		environment: {
			...original.environment,
			[agent_session_role.KEY]: 'worker',
			[ORIGIN_VARIABLE]: 'origin',
		},
	}
}

async function answer_from(launcher_pid: number): Promise<CallAnswer> {
	return await hook_daemon_call.answer(
		origin_under(make_directory(ROOT_PREFIX)),
		bash_payload('ls'),
		LAUNCH_DIRECTORY,
		launcher_pid,
	)
}

beforeEach(() => {
	capture.mockClear()
})

afterEach(() => {
	restore_test_process()
})

describe('hook_daemon_call.answer', () => {
	it('puts back the start environment and root with only the launch directory changed', async () => {
		const root = realpathSync(make_directory(ROOT_PREFIX))

		process.env[STRAY_VARIABLE] = 'stray'
		await hook_daemon_call.answer(
			origin_under(root),
			bash_payload('ls'),
			LAUNCH_DIRECTORY,
			ROOT_LAUNCHER,
		)

		expect(process.env[STRAY_VARIABLE]).toBeUndefined()
		expect(process.env[ORIGIN_VARIABLE]).toBe('origin')
		expect(process.env[hook_daemon_call.LAUNCH_DIRECTORY_VARIABLE]).toBe(LAUNCH_DIRECTORY)
		expect(process.cwd()).toBe(root)
	})

	it('captures the payload under the pretool guard command', async () => {
		await answer_from(ROOT_LAUNCHER)

		expect(capture).toHaveBeenCalledWith('pretool:guard', expect.stringContaining('"ls"'))
	})

	it('answers a refusal with the deny envelope a fresh guard process writes', async () => {
		const root = make_directory(ROOT_PREFIX)
		const answer = await hook_daemon_call.answer(
			origin_under(root),
			bash_payload(SHELL_BODY_COMMAND),
			LAUNCH_DIRECTORY,
			ROOT_LAUNCHER,
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
