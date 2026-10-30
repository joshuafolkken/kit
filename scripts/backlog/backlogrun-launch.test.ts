import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlogrun_launch } from './backlogrun-launch'

// joshuafolkken/kit#3437: how `josh backlogrun` tells a run is already going, and the agent it starts.

const GIT_DIRECTORY = '/repo/.git'
const WORKTREE = '/repo'
const SESSION = '00000000-0000-4000-8000-000000000000'
const LAUNCHED_PID = 42
const LAUNCH_RECORD = JSON.stringify({ pid: LAUNCHED_PID, start: 'Thu Oct  9 00:00:00 2026' })
const INVOCATION = 'backlogrun'
const TARGET = { worktree: WORKTREE, git_directory: GIT_DIRECTORY }
const STARTED_AT = '2026-10-12T09:00:00.000Z'
const STARTED_RECORD = { pid: LAUNCHED_PID, invocation: INVOCATION, started_at: STARTED_AT }
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-10-09T00:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

afterEach(() => {
	vi.restoreAllMocks()
})

function stage(is_carried: boolean, is_owner_live: boolean, launch: string | undefined): void {
	const read = is_carried ? { kind: 'carried' as const, carry: CARRY } : { kind: 'none' as const }

	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	vi.spyOn(run_carry, 'is_owner_live').mockReturnValue(is_owner_live)
	vi.spyOn(stamp_file, 'read_stamp_text').mockReturnValue(launch)
}

describe('backlogrun_launch.chosen_environment', () => {
	it('clears every agent-session key and hands the chosen provider', () => {
		const environment = backlogrun_launch.chosen_environment('openai', {
			CLAUDE_CODE_SESSION_ID: 'claude-session',
			CODEX_THREAD_ID: 'codex-thread',
			HOME: '/home',
		})

		expect(environment).toMatchObject({
			CLAUDE_CODE_SESSION_ID: undefined,
			CODEX_THREAD_ID: undefined,
			HOME: '/home',
			JOSH_AGENT_PROVIDER: 'openai',
		})
	})
})

describe('backlogrun_launch.argv_of', () => {
	it('builds a Claude parent with its forced session id', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
		const built = backlogrun_launch.argv_of('backlogrun', 'anthropic', WORKTREE, SESSION)

		expect(built).toMatchObject({ kind: 'argv', argv: { command: 'claude' } })
		expect(built.kind === 'argv' && built.argv.args).toEqual(
			expect.arrayContaining(['--session-id', SESSION, 'backlogrun']),
		)
	})

	it('builds a Codex parent with codex exec', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
		const built = backlogrun_launch.argv_of('backlogrun', 'openai', WORKTREE, undefined)

		expect(built).toMatchObject({
			kind: 'argv',
			argv: { command: 'codex' },
			profile: { provider: 'openai' },
		})
		expect(built.kind === 'argv' && built.argv.args[0]).toBe('exec')
		expect(built.kind === 'argv' && built.argv.args).toContain(
			'default_permissions=":danger-full-access"',
		)
		expect(built.kind === 'argv' && built.argv.args).toContain('approval_policy="never"')
	})

	it('refuses with the diagnostic note of a CLI that cannot run', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'rejected', note: 'no codex' })

		expect(backlogrun_launch.argv_of('backlogrun', 'openai', WORKTREE, undefined)).toStrictEqual({
			kind: 'rejected',
			note: 'no codex',
		})
	})
})

describe('backlogrun_launch.is_running', () => {
	it('answers yes for a carry record whose owner is live', () => {
		stage(true, true, undefined)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(true)
	})

	it('answers yes between the launch and the claim while the launched pid is the same process', () => {
		stage(false, false, LAUNCH_RECORD)
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(true)
	})

	it('answers no once the launched pid is another process and no owner is live', () => {
		stage(true, false, LAUNCH_RECORD)
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(false)
	})

	it('answers no with neither record', () => {
		stage(false, false, undefined)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(false)
	})
})

// A started parent, with every write it makes — the record and the stage — held by a spy.
function stage_start(): void {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(process_identity, 'read_start').mockReturnValue(undefined)
	vi.spyOn(stamp_file, 'replace_stamp').mockReturnValue('')
	vi.spyOn(run_event_setup, 'emit_in').mockReturnValue()
	vi.spyOn(detached_launch, 'launch').mockReturnValue({ kind: 'launched', pid: LAUNCHED_PID })
}

describe('backlogrun_launch.start', () => {
	it.each(['anthropic', 'openai'] as const)(
		'persists the launched scheduler provider %s',
		(provider) => {
			stage_start()
			backlogrun_launch.start(INVOCATION, provider, TARGET)

			expect(vi.mocked(stamp_file.replace_stamp).mock.calls[0]?.[1]).toMatchObject({
				scheduler_provider: provider,
			})
		},
	)

	it('starts the parent with no Codex session key inherited from the shell it was typed in', () => {
		stage_start()

		expect(backlogrun_launch.start(INVOCATION, 'anthropic', TARGET).kind).toBe('launched')

		const { env } = vi.mocked(detached_launch.launch).mock.calls[0]?.[0] ?? {}

		expect(env).toHaveProperty('CODEX_THREAD_ID', undefined)
		expect(env).toHaveProperty('JOSH_AGENT_PROVIDER', 'anthropic')
	})

	// joshuafolkken/kit#3696: the record says what was started and when, and the run's first stage is
	// dated that same moment.
	it('records what it started and when, and says the session is starting at that moment', () => {
		stage_start()
		backlogrun_launch.start(INVOCATION, 'anthropic', TARGET)

		const record = vi.mocked(stamp_file.replace_stamp).mock.calls[0]?.[1]
		const [repository, text, at] = vi.mocked(run_event_setup.emit_in).mock.calls[0] ?? []

		expect(record).toMatchObject({ pid: LAUNCHED_PID, invocation: INVOCATION })
		expect(record).toHaveProperty('started_at', at?.toISOString())
		expect([repository, text]).toStrictEqual([GIT_DIRECTORY, 'starting session'])
	})

	it('records nothing and says nothing for a parent that did not start', () => {
		stage_start()
		vi.mocked(detached_launch.launch).mockReturnValue({ kind: 'failed', note: 'no agent' })

		expect(backlogrun_launch.start(INVOCATION, 'anthropic', TARGET).kind).toBe('failed')
		expect(stamp_file.replace_stamp).not.toHaveBeenCalled()
		expect(run_event_setup.emit_in).not.toHaveBeenCalled()
	})
})

// A launch record on disk, its launched pid live or gone.
function stage_launch(record: object, is_live = true): void {
	stage(false, false, JSON.stringify(record))
	vi.spyOn(process_identity, 'is_same_process').mockReturnValue(is_live)
}

describe('backlogrun_launch.pending_launch', () => {
	it.each(['anthropic', 'openai'] as const)(
		'reads the recorded scheduler provider %s',
		(scheduler_provider) => {
			stage_launch({ ...STARTED_RECORD, scheduler_provider })

			expect(backlogrun_launch.pending_launch(GIT_DIRECTORY)?.scheduler_provider).toBe(
				scheduler_provider,
			)
		},
	)

	it('reads what a live launch started and when', () => {
		stage_launch(STARTED_RECORD)

		expect(backlogrun_launch.pending_launch(GIT_DIRECTORY)).toStrictEqual({
			invocation: INVOCATION,
			started_at: STARTED_AT,
		})
	})

	it('reads nothing once the launched parent is gone, or where there is no record', () => {
		stage_launch(STARTED_RECORD, false)

		expect(backlogrun_launch.pending_launch(GIT_DIRECTORY)).toBeUndefined()

		stage(false, false, undefined)

		expect(backlogrun_launch.pending_launch(GIT_DIRECTORY)).toBeUndefined()
	})

	it('reads nothing from a record an earlier version wrote, which names no start', () => {
		stage_launch({ pid: LAUNCHED_PID })

		expect(backlogrun_launch.pending_launch(GIT_DIRECTORY)).toBeUndefined()
	})
})

describe('backlogrun_launch.started_for', () => {
	it('hands the launch’s start to the parent it started', () => {
		stage_launch(STARTED_RECORD)

		expect(backlogrun_launch.started_for(GIT_DIRECTORY, LAUNCHED_PID)).toStrictEqual(
			new Date(STARTED_AT),
		)
	})

	it('hands nothing to another owner, or to a run that names none', () => {
		stage_launch(STARTED_RECORD)

		expect(backlogrun_launch.started_for(GIT_DIRECTORY, LAUNCHED_PID + 1)).toBeUndefined()
		expect(backlogrun_launch.started_for(GIT_DIRECTORY, undefined)).toBeUndefined()
	})

	it('hands nothing where no launch is live, or its start is not a time', () => {
		stage_launch(STARTED_RECORD, false)

		expect(backlogrun_launch.started_for(GIT_DIRECTORY, LAUNCHED_PID)).toBeUndefined()

		stage_launch({ ...STARTED_RECORD, started_at: 'soon' })

		expect(backlogrun_launch.started_for(GIT_DIRECTORY, LAUNCHED_PID)).toBeUndefined()
	})
})

// A launch record whose removal and whose parent's signal are both held by a spy.
function stage_stop(is_live: boolean): void {
	stage_launch(STARTED_RECORD, is_live)
	vi.spyOn(process, 'kill').mockReturnValue(true)
	vi.spyOn(stamp_file, 'remove_stamp').mockReturnValue()
}

// joshuafolkken/kit#3708: `josh backlogrun --stop` stops the parent this launcher started, and only it.
describe('backlogrun_launch.stop_parent', () => {
	it('signals the launched parent while it is still that process, and forgets the launch', () => {
		stage_stop(true)

		expect(backlogrun_launch.stop_parent(GIT_DIRECTORY)).toBe(LAUNCHED_PID)
		expect(process.kill).toHaveBeenCalledExactlyOnceWith(LAUNCHED_PID, 'SIGTERM')
		expect(stamp_file.remove_stamp).toHaveBeenCalledOnce()
	})

	it('signals nobody once the launched pid is another process, and still forgets the launch', () => {
		stage_stop(false)

		expect(backlogrun_launch.stop_parent(GIT_DIRECTORY)).toBeUndefined()
		expect(process.kill).not.toHaveBeenCalled()
		expect(stamp_file.remove_stamp).toHaveBeenCalledOnce()
	})

	it('forgets the launch of a parent that cannot be signalled', () => {
		stage_stop(true)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		vi.mocked(process.kill).mockImplementation(() => {
			throw new Error('EPERM')
		})

		expect(backlogrun_launch.stop_parent(GIT_DIRECTORY)).toBe(LAUNCHED_PID)
		expect(stamp_file.remove_stamp).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#4154: `--restart` reads the launched parent before it stops anything.
describe('backlogrun_launch.running_parent', () => {
	it('names the live launched parent without signalling it or forgetting the launch', () => {
		stage_stop(true)

		expect(backlogrun_launch.running_parent(GIT_DIRECTORY)).toBe(LAUNCHED_PID)
		expect(process.kill).not.toHaveBeenCalled()
		expect(stamp_file.remove_stamp).not.toHaveBeenCalled()
	})

	it('names nobody once the launched pid is another process', () => {
		stage_stop(false)

		expect(backlogrun_launch.running_parent(GIT_DIRECTORY)).toBeUndefined()
	})
})
