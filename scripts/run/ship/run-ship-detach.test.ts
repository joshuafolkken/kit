import { randomUUID } from 'node:crypto'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launch_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch: launch_mock } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))

const { run_ship_detach } = await import('./run-ship-detach')

// joshuafolkken/kit#2428: the agent hands the post-implementation region to a detached supervisor and
// ends. What these pin is what the parent and the next session rely on — the supervisor's command line
// ends with its `#<N>` title (the liveness anchor), one supervisor runs per issue, and the launch is on
// the stream as a position.

const TITLE = 'Hand the region to a supervisor #2428'
const NUMBER = '2428'
const DEAD_PID = 2_147_483_646
const CHILD_PID = 4242
const INLINE_FLAG = '--notify-message'
const FILE_FLAG = '--notify-message-file'
const BODY = 'Cause: x\nFix: y'
const START_NOTE = 'pnpm not found'
const GATE_HEADER = '=== gate ==='
const NEWEST_HEADER = '=== 2026-09-23T02:00:00Z · started by process 2 · pnpm ==='

function request(
	overrides: Partial<Parameters<typeof run_ship_detach.detach>[0]> = {},
): Parameters<typeof run_ship_detach.detach>[0] {
	return {
		title: TITLE,
		number: NUMBER,
		notify: [],
		body: [],
		cites: [],
		is_review: true,
		repository: `/tmp/josh-ship-detach-test-${randomUUID()}`,
		cwd: '/tmp',
		...overrides,
	}
}

function pid_path(repository: string): string {
	return stamp_file.stamp_path(`josh-ship-pid-${NUMBER}-`, repository)
}

function result_path(repository: string): string {
	return stamp_file.stamp_path(`josh-ship-result-${NUMBER}-`, repository)
}

beforeEach(() => {
	launch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: CHILD_PID })
	emit_mock.mockReset()
})

describe('run_ship_detach.supervisor_argv', () => {
	it('ends the supervisor command line with the title the liveness pattern anchors on', () => {
		const argv = run_ship_detach.supervisor_argv(request({ cites: ['2500'] }))

		expect(argv.command).toBe('pnpm')
		expect(argv.args).toEqual(['josh', 'ship', '--review', '--cite', '2500', TITLE])
	})

	it('moves an inline notify body into a file, since no argv element may carry its newlines', () => {
		const argv = run_ship_detach.supervisor_argv(request({ notify: [INLINE_FLAG, BODY] }))
		const body_path = argv.args[argv.args.indexOf(FILE_FLAG) + 1] ?? ''

		expect(argv.args).not.toContain(INLINE_FLAG)
		expect(stamp_file.read_stamp_text(body_path)).toBe(BODY)
		expect(argv.args.at(-1)).toBe(TITLE)
	})

	it('passes the PR body file through, ahead of the title', () => {
		const body = ['--body-file', 'pr.md']
		const argv = run_ship_detach.supervisor_argv(request({ body }))

		expect(argv.args).toEqual(['josh', 'ship', '--review', ...body, TITLE])
	})

	it('passes a notify file through unchanged', () => {
		const argv = run_ship_detach.supervisor_argv(request({ notify: [FILE_FLAG, 'body.txt'] }))

		expect(argv.args).toContain('body.txt')
	})
})

describe('run_ship_detach.detach', () => {
	it('launches the supervisor marked as supervised and records the launch on the stream', async () => {
		const result = await run_ship_detach.detach(request())
		const launched = launch_mock.mock.calls[0]?.[0] as { env: Record<string, string> }

		expect(result.verdict).toBe(run_ship_detach.LAUNCHED)
		expect(launched.env[run_ship_detach.SUPERVISED_KEY]).toBe('1')
		expect(emit_mock).toHaveBeenCalledWith('ship-launch', `#${NUMBER} ship supervisor launched`)
	})

	it('refuses a second supervisor while the recorded one is alive', async () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), {
			pid: process.pid,
			process_start: process_identity.own_start(),
			launch_id: 'running',
		})

		const result = await run_ship_detach.detach(target)

		expect(result.verdict).toBe(run_ship_detach.BUSY)
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('launches over a recorded supervisor that has already exited', async () => {
		const target = request()

		stamp_file.write_text_stamp(pid_path(target.repository), String(DEAD_PID))

		const result = await run_ship_detach.detach(target)

		expect(result.verdict).toBe(run_ship_detach.LAUNCHED)
	})

	it('answers failed and records no launch when the process could not start', async () => {
		launch_mock.mockReturnValue({ kind: 'failed', note: START_NOTE })
		const target = request()

		const result = await run_ship_detach.detach(target)

		expect(result).toEqual({ verdict: run_ship_detach.FAILED, note: START_NOTE })
		expect(emit_mock).not.toHaveBeenCalled()
		expect(run_ship_detach.read_result(target.repository, NUMBER)).toBeUndefined()
	})
})

describe('detached ship result', () => {
	it('treats a pending launch from a dead parent as abnormal', () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), {
			launcher_pid: DEAD_PID,
			launch_id: 'pending',
		})

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('abnormal')
	})
})

describe('detached ship supervisor identity', () => {
	afterEach(() => vi.restoreAllMocks())

	it('does not mistake a reused pid for the original supervisor', () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), {
			pid: process.pid,
			process_start: 'stale-start',
			launch_id: 'stopped',
		})
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('abnormal')
	})

	it('keeps a live supervisor running even after its gate reports failure', () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), {
			pid: process.pid,
			process_start: process_identity.own_start(),
			launch_id: 'live',
			result: 'failed',
		})

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('running')
	})

	it.each(['success', 'failed', 'abnormal'] as const)(
		'distinguishes a stopped supervisor: %s',
		(result) => {
			const target = request()

			stamp_file.replace_stamp(result_path(target.repository), {
				pid: DEAD_PID,
				launch_id: result,
				...(result !== 'abnormal' && { result }),
			})

			expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe(result)
		},
	)
})

const CLAIM_WINDOW_MS = 120_000
const EXPIRED_OFFSET_MS = CLAIM_WINDOW_MS + 1

function write_bare_pid(repository: string, launched_at: number): void {
	stamp_file.replace_stamp(result_path(repository), {
		pid: process.pid,
		launch_id: 'bare',
		launched_at,
	})
}

function restore_identity_stubs(): void {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
}

// joshuafolkken/kit#2642: a start time the launcher could not read, and one the probe cannot read for a
// moment, are neither a stopped supervisor nor a confirmed one.
describe('detached ship identity that cannot be verified', () => {
	afterEach(restore_identity_stubs)

	it('stops believing a bare pid once the claim window has passed', () => {
		const target = request()

		write_bare_pid(target.repository, Date.now() - EXPIRED_OFFSET_MS)

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('abnormal')
	})

	it('believes a live bare pid inside the claim window', () => {
		const target = request()

		write_bare_pid(target.repository, Date.now())

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('running')
	})

	it('does not believe a bare pid recorded with no launch time', () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), { pid: process.pid, launch_id: 'old' })

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('abnormal')
	})

	it('keeps a supervisor running and refuses a second one while its start cannot be read', async () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), {
			pid: process.pid,
			process_start: 'proc:1',
			launch_id: 'live',
		})
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('running')
		const detached = await run_ship_detach.detach(target)

		expect(detached.verdict).toBe(run_ship_detach.BUSY)
		expect(launch_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_detach.claim_identity', () => {
	afterEach(restore_identity_stubs)

	it('lets the supervisor claim a bare pid record with its own identity', async () => {
		const target = request()

		write_bare_pid(target.repository, Date.now() - EXPIRED_OFFSET_MS)
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, 'bare')
		await run_ship_detach.claim_identity(target.repository, NUMBER)

		expect(run_ship_detach.read_result(target.repository, NUMBER)).toEqual({
			launch_id: 'bare',
			result: 'running',
		})
	})

	it('leaves a record from another launch unclaimed', async () => {
		const target = request()

		write_bare_pid(target.repository, Date.now() - EXPIRED_OFFSET_MS)
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, 'another')
		await run_ship_detach.claim_identity(target.repository, NUMBER)

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('abnormal')
	})

	it('keeps the launcher identity when the supervisor cannot name its own start', async () => {
		const target = request()

		write_bare_pid(target.repository, Date.now())
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, 'bare')
		vi.spyOn(process_identity, 'own_fields').mockReturnValue({ pid: DEAD_PID })
		await run_ship_detach.claim_identity(target.repository, NUMBER)

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('running')
	})
})

describe('detached ship result ownership', () => {
	it('records the result only for the supervisor holding the launch identity', async () => {
		const target = request()

		stamp_file.replace_stamp(result_path(target.repository), {
			pid: DEAD_PID,
			launch_id: 'current',
		})
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, 'older')
		await run_ship_detach.mark_result(target.repository, NUMBER, 1)
		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('abnormal')
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, 'current')
		await run_ship_detach.mark_result(target.repository, NUMBER, 1)
		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('failed')
		vi.unstubAllEnvs()
	})

	it('keeps an immediate supervisor result after the launch record receives its pid', async () => {
		const target = request()
		let result_written: Promise<void> | undefined

		launch_mock.mockImplementation((launch_request: { env: Record<string, string> }) => {
			vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, launch_request.env[run_ship_detach.LAUNCH_ID_KEY])
			result_written = run_ship_detach.mark_result(target.repository, NUMBER, 1)

			return { kind: 'launched', pid: DEAD_PID }
		})

		await run_ship_detach.detach(target)
		await result_written

		expect(run_ship_detach.read_result(target.repository, NUMBER)?.result).toBe('failed')

		vi.unstubAllEnvs()
	})
})

// joshuafolkken/kit#2456: the launch strips the session keys `ship --review` detects the provider by.
describe('run_ship_detach.detach provider hand-off', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('hands the supervisor the resolved provider without the parent-session keys', async () => {
		vi.stubEnv('CODEX_THREAD_ID', '')
		vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'claude-session')
		await run_ship_detach.detach(request())
		const launched = launch_mock.mock.calls[0]?.[0] as { env: Record<string, string> }

		expect(launched.env[agent_role_profile.HANDED_PROVIDER_KEY]).toBe('anthropic')
		expect(launched.env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
	})

	// joshuafolkken/kit#3651: a plain terminal's ship reviews on the default, and stderr says so.
	it('says the provider was defaulted when nothing named one', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.stubEnv('CODEX_THREAD_ID', '')
		for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
		vi.stubEnv(agent_role_profile.HANDED_PROVIDER_KEY, '')
		await run_ship_detach.detach(request())

		expect(error).toHaveBeenCalledWith(expect.stringContaining('defaulted to anthropic'))
		error.mockRestore()
	})
})

describe('run_ship_detach.last_launch', () => {
	it('keeps only the report of the newest launch into the log', () => {
		const log = [
			'',
			'=== 2026-09-23T01:00:00Z · started by process 1 · pnpm ===',
			GATE_HEADER,
			'old',
			'',
			NEWEST_HEADER,
			GATE_HEADER,
			'red',
		].join('\n')

		expect(run_ship_detach.last_launch(log)).toBe(`${NEWEST_HEADER}\n${GATE_HEADER}\nred`)
	})

	it('returns a log with no launch header whole', () => {
		expect(run_ship_detach.last_launch('plain')).toBe('plain')
	})
})

describe('run_ship_detach.is_supervised', () => {
	it('reads the mark the detach sets on the supervisor', () => {
		expect(run_ship_detach.is_supervised({ [run_ship_detach.SUPERVISED_KEY]: '1' })).toBe(true)
		expect(run_ship_detach.is_supervised({})).toBe(false)
	})
})
