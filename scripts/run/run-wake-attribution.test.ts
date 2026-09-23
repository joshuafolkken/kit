import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_session } from './run-wake-session'

// joshuafolkken/kit#2407. The supervisor forces each woken session's transcript id with `--session-id`
// and records it, so `josh time --run` can attribute a whiff to a session it actually started rather
// than to any transcript that moved while it was alive. These pin the two ends of that thread — the id
// reaching the launched argv, and the id being recorded on the wake record.

// The CLI version probe is the diagnostics' own test; here it would depend on the machine's CLI.
vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })

const NOW = new Date('2026-09-10T12:00:00.000Z')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const SID = '11111111-1111-4111-8111-111111111111'
const SID_RETRY = '22222222-2222-4222-8222-222222222222'
const SESSION_ID_FLAG = '--session-id'

describe('run_wake.count_wake — the forced session id is recorded', () => {
	it('records the forced session id, and appends a retry rather than replacing it', () => {
		const first = run_wake.count_wake(run_wake.fresh_wake(INVOCATION, NOW), NOW, 99, SID)
		const retry = run_wake.count_wake(first, NOW, 100, SID_RETRY)

		expect(first.spawned).toEqual([SID])
		expect(retry.spawned).toEqual([SID, SID_RETRY])
	})
})

describe('run_wake_session.wake_argv — the forced session id reaches the argv', () => {
	// A forced id flows through the profiled path, so the woken session writes the transcript the
	// supervisor recorded. The invocation stays last, so the liveness poll keeps matching.
	it('forces the woken session’s transcript id when one is given', () => {
		const profile = agent_role_profile.DEFAULT_PROFILES.scheduler
		const built = run_wake_session.wake_argv(INVOCATION, profile, '/repo', SID)
		const argv = built?.kind === 'argv' ? built.argv : undefined

		expect(argv?.args[argv.args.indexOf(SESSION_ID_FLAG) + 1]).toBe(SID)
		expect(argv?.args.at(-1)).toBe(INVOCATION)
	})
})
