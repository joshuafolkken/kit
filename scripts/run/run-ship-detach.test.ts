import { randomUUID } from 'node:crypto'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launch_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('./detached-launch', () => ({ detached_launch: { launch: launch_mock } }))
vi.mock('./run-event-stream-emit', () => ({ run_event_stream_emit: { emit: emit_mock } }))

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

		stamp_file.write_text_stamp(pid_path(target.repository), String(process.pid))

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

		const result = await run_ship_detach.detach(request())

		expect(result).toEqual({ verdict: run_ship_detach.FAILED, note: START_NOTE })
		expect(emit_mock).not.toHaveBeenCalled()
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
