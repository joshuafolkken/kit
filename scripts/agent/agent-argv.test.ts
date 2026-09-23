import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_argv } from './agent-argv'
import { agent_diagnostics } from './agent-diagnostics'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

// joshuafolkken/kit#2415: a lane created before the model migration keeps the model it recorded, and a
// CLI that cannot run the resolved model refuses the launch instead of falling back to another model.

const INVOCATION = 'fullrun #2415'
const LANE = '/lanes/2415'
const LEGACY_MODEL = 'opus'
const { PRE_GATE_PHASE, DEFAULT_PROFILES } = agent_role_profile
const LEGACY_WORKER: AgentProfile = { ...DEFAULT_PROFILES.worker, model: LEGACY_MODEL }
const OUTDATED = 'Claude Code 2.1.156 cannot run claude-opus-5-5'

const check = vi.spyOn(agent_diagnostics, 'check')

afterEach(() => {
	check.mockReset()
})

describe('a stored lane profile across a cut', () => {
	it('relaunches on the recorded model, taking only the phase effort', () => {
		check.mockReturnValue({ kind: 'ready' })
		const built = agent_argv.resume_argv(INVOCATION, LEGACY_WORKER, PRE_GATE_PHASE, LANE)

		expect(built).toMatchObject({ kind: 'argv', profile: { model: LEGACY_MODEL, effort: 'low' } })
		expect(built.kind === 'argv' && built.argv.args).toContain(LEGACY_MODEL)
	})

	it('resumes a session on the recorded model', () => {
		check.mockReturnValue({ kind: 'ready' })
		const built = agent_argv.with_resume_in(INVOCATION, LEGACY_WORKER, 'session', LANE)

		expect(built).toMatchObject({ kind: 'argv', profile: { model: LEGACY_MODEL } })
	})
})

describe('an unsupported CLI', () => {
	it('refuses with the diagnostic note and checks no other model', () => {
		check.mockReturnValue({ kind: 'rejected', note: OUTDATED })
		const profile = DEFAULT_PROFILES.worker

		expect(agent_argv.with_profile_in(INVOCATION, profile, LANE)).toStrictEqual({
			kind: 'rejected',
			note: OUTDATED,
		})
		expect(check).toHaveBeenCalledExactlyOnceWith(profile)
	})
})
