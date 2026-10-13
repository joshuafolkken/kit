import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake_cli } from './run-wake-cli'
import type { WakeContext } from './run-wake-describe'
import { run_wake_session, type LaunchResult } from './run-wake-session'

// joshuafolkken/kit#3738: the supervisor says on the run's stream that the judgment session it woke is
// running, so the board tells a session at work from a driver still waiting for one. Only a session
// that started is said: a launch that failed leaves the stage where the driver put it.

const INVOCATION = 'backlogrun --max 5 --idle 30'
const PROFILE = agent_role_profile.DEFAULT_PROFILES.scheduler
const SID = '11111111-1111-4111-8111-111111111111'
const MATERIAL = 'judgment: #278 is untriaged'
const SESSION_PID = 4242
const scratch = { directory: '' }

function context(): WakeContext {
	return {
		carry_target: path.join(scratch.directory, 'carry.json'),
		ended_target: path.join(scratch.directory, 'ended.json'),
		wake_target: path.join(scratch.directory, 'wake.json'),
		log_target: path.join(scratch.directory, 'wake.log'),
		event_target: path.join(scratch.directory, 'events.jsonl'),
		worktree: scratch.directory,
	}
}

// Wake a session through the supervisor's real port, with the launch itself answering `result`.
function wake(invocation: string, result: LaunchResult): LaunchResult {
	vi.spyOn(run_wake_session, 'launch').mockReturnValue(result)

	return run_wake_cli.ports_for(context(), PROFILE).wake(invocation, SID, MATERIAL)
}

function stages(): Array<string> {
	return run_event_stream
		.read_events(context().event_target)
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.SETUP)
		.map((event) => event.text)
}

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-wake-cli-stage-'))
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

describe('the supervisor waking a judgment session', () => {
	it('says the session is running on the run’s stream once it launched', () => {
		const result = wake(INVOCATION, { kind: 'launched', pid: SESSION_PID })

		expect(result).toStrictEqual({ kind: 'launched', pid: SESSION_PID })
		expect(stages()).toStrictEqual([run_event_setup.STAGE.SESSION])
	})

	it('says nothing when the launch failed', () => {
		const result = wake(INVOCATION, { kind: 'failed', note: 'claude is not on PATH' })

		expect(result.kind).toBe('failed')
		expect(stages()).toStrictEqual([])
	})

	it('says nothing for an invocation it refuses to launch', () => {
		const result = wake('backlogrun --lanes 3', { kind: 'launched', pid: SESSION_PID })

		expect(result.kind).toBe('failed')
		expect(run_wake_session.launch).not.toHaveBeenCalled()
		expect(stages()).toStrictEqual([])
	})
})
