import { describe, expect, it, vi } from 'vitest'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

const { REVIEWER, SCHEDULER, WORKER } = agent_role_profile
const OPENAI_MODEL = 'gpt-6.1-sol'
const ANTHROPIC_MODEL = 'claude-opus-5-5'
const ANTHROPIC_ENV = { CLAUDE_CODE_SESSION_ID: 'claude-session' }
const OPENAI_ENV = { CODEX_THREAD_ID: 'codex-thread' }

function profile(
	role: typeof SCHEDULER | typeof WORKER | typeof REVIEWER,
	environment = {},
): AgentProfile {
	const result = agent_role_profile.resolve(role, environment)

	if (result.kind === 'rejected') throw new Error(result.note)

	return result.profile
}

describe('the role policy defaults', () => {
	it('assigns the Anthropic profile to each role in a Claude Code session', () => {
		expect(profile(SCHEDULER, ANTHROPIC_ENV)).toStrictEqual({
			provider: 'anthropic',
			role: SCHEDULER,
			model: ANTHROPIC_MODEL,
			effort: 'medium',
		})
		expect(profile(WORKER, ANTHROPIC_ENV)).toMatchObject({
			provider: 'anthropic',
			model: ANTHROPIC_MODEL,
			effort: 'medium',
		})
		expect(profile(REVIEWER, ANTHROPIC_ENV)).toMatchObject({
			provider: 'anthropic',
			model: ANTHROPIC_MODEL,
			effort: 'high',
		})
	})

	it('assigns the OpenAI profile to each role in a Codex session', () => {
		expect(profile(SCHEDULER, OPENAI_ENV)).toStrictEqual({
			provider: 'openai',
			role: SCHEDULER,
			model: OPENAI_MODEL,
			effort: 'medium',
		})
		expect(profile(WORKER, OPENAI_ENV)).toMatchObject({ model: OPENAI_MODEL, effort: 'medium' })
		expect(profile(REVIEWER, OPENAI_ENV)).toMatchObject({ model: OPENAI_MODEL, effort: 'high' })
	})

	// joshuafolkken/kit#2415: a floating alias cannot say which model a logged run used.
	it('pins every Anthropic default to a model id rather than the opus alias', () => {
		const models = Object.values(agent_role_profile.DEFAULT_PROFILES).map((entry) => entry.model)

		expect(models).toStrictEqual([ANTHROPIC_MODEL, ANTHROPIC_MODEL, ANTHROPIC_MODEL])
	})
})

describe('invoking session detection', () => {
	// joshuafolkken/kit#3651: a plain terminal names no provider, so the launch defaults to Claude Code.
	it('defaults to Anthropic when no session and no mark names a provider', () => {
		expect(agent_role_profile.resolve_provider({})).toStrictEqual({
			kind: 'provider',
			provider: 'anthropic',
			is_default: true,
		})
		expect(profile(WORKER, {})).toStrictEqual(agent_role_profile.DEFAULT_PROFILES.worker)
	})

	it('marks only the defaulted provider as a default', () => {
		const handed = { [agent_role_profile.HANDED_PROVIDER_KEY]: 'anthropic' }

		expect(agent_role_profile.resolve_provider(ANTHROPIC_ENV)).not.toHaveProperty('is_default')
		expect(agent_role_profile.resolve_provider(handed)).not.toHaveProperty('is_default')
	})

	it('says so when the provider was defaulted, and nothing when it was named', () => {
		expect(agent_role_profile.default_notice({})).toContain('defaulted to anthropic')
		expect(agent_role_profile.default_notice(ANTHROPIC_ENV)).toBe('')
		expect(agent_role_profile.default_notice({ ...ANTHROPIC_ENV, ...OPENAI_ENV })).toBe('')
	})

	it('writes the default notice to stderr only when the provider was defaulted', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		agent_role_profile.warn_of_default(ANTHROPIC_ENV)
		expect(error).not.toHaveBeenCalled()
		agent_role_profile.warn_of_default({})
		expect(error).toHaveBeenCalledWith(
			expect.stringMatching(/^No agent session.*defaulted to anthropic/u),
		)
		error.mockRestore()
	})

	it('rejects conflicting invoking agent sessions instead of choosing a fallback', () => {
		const result = agent_role_profile.resolve(WORKER, { ...ANTHROPIC_ENV, ...OPENAI_ENV })

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain('both Codex and Claude Code')
	})
})

// joshuafolkken/kit#2653: a Codex session is not re-invoked when its background command completes.
describe('completion callback detection', () => {
	it('answers no for a Codex session and yes for a Claude Code one', () => {
		expect(agent_role_profile.has_completion_callback(OPENAI_ENV)).toBe(false)
		expect(agent_role_profile.has_completion_callback(ANTHROPIC_ENV)).toBe(true)
	})

	it('answers no for a handed Codex mark', () => {
		const environment = { [agent_role_profile.HANDED_PROVIDER_KEY]: 'openai' }

		expect(agent_role_profile.has_completion_callback(environment)).toBe(false)
	})

	it('keeps the callback for a defaulted provider and for a session it cannot resolve', () => {
		expect(agent_role_profile.has_completion_callback({})).toBe(true)
		expect(agent_role_profile.has_completion_callback({ ...ANTHROPIC_ENV, ...OPENAI_ENV })).toBe(
			true,
		)
	})
})

// joshuafolkken/kit#2456: a detached supervisor has the parent-session keys stripped, so the provider
// the launching session resolved travels as a mark instead.
describe('the handed provider mark', () => {
	const { HANDED_PROVIDER_KEY } = agent_role_profile

	it('resolves the provider from the mark when no session is detected', () => {
		expect(profile(REVIEWER, { [HANDED_PROVIDER_KEY]: 'openai' })).toMatchObject({
			provider: 'openai',
			model: OPENAI_MODEL,
		})
		expect(profile(REVIEWER, { [HANDED_PROVIDER_KEY]: 'anthropic' })).toMatchObject({
			provider: 'anthropic',
		})
	})

	it('lets a detected session decide over an inherited mark', () => {
		const environment = { ...OPENAI_ENV, [HANDED_PROVIDER_KEY]: 'anthropic' }

		expect(profile(WORKER, environment)).toMatchObject({ provider: 'openai' })
	})

	it('rejects a mark that names no allowed provider', () => {
		const result = agent_role_profile.resolve(WORKER, { [HANDED_PROVIDER_KEY]: 'other' })

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain(HANDED_PROVIDER_KEY)
	})

	it('builds the mark from the provider it resolves, the default included', () => {
		expect(agent_role_profile.handoff_environment(ANTHROPIC_ENV)).toStrictEqual({
			[HANDED_PROVIDER_KEY]: 'anthropic',
		})
		expect(agent_role_profile.handoff_environment({})).toStrictEqual({
			[HANDED_PROVIDER_KEY]: 'anthropic',
		})
	})

	it('builds no mark when the provider is refused', () => {
		const conflicting = { ...ANTHROPIC_ENV, ...OPENAI_ENV }

		expect(agent_role_profile.handoff_environment(conflicting)).toStrictEqual({})
	})
})

describe('role-specific overrides', () => {
	it('changes only the role whose keys are set', () => {
		const environment = {
			...ANTHROPIC_ENV,
			JOSH_WORKER_MODEL: 'sonnet',
			JOSH_WORKER_EFFORT: 'low',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'sonnet', effort: 'low' })
		expect(profile(SCHEDULER, environment)).toStrictEqual(
			agent_role_profile.DEFAULT_PROFILES.scheduler,
		)
	})

	it('does not pass an Anthropic model override to an OpenAI role', () => {
		const environment = {
			...OPENAI_ENV,
			JOSH_WORKER_MODEL: 'opus',
			JOSH_LANE_MODEL: 'legacy-claude-model',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: OPENAI_MODEL })
	})

	it('treats a blank role override as unset', () => {
		expect(
			profile(REVIEWER, {
				...ANTHROPIC_ENV,
				JOSH_REVIEWER_MODEL: ' ',
				JOSH_REVIEWER_EFFORT: '',
			}),
		).toStrictEqual(agent_role_profile.DEFAULT_PROFILES.reviewer)
	})
})

describe('legacy worker overrides', () => {
	it('uses legacy lane keys only for a worker without new keys', () => {
		const environment = {
			...ANTHROPIC_ENV,
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'xhigh',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'legacy', effort: 'xhigh' })
		expect(profile(SCHEDULER, environment)).toStrictEqual(
			agent_role_profile.DEFAULT_PROFILES.scheduler,
		)
	})

	it('lets the new worker keys replace legacy values', () => {
		const environment = {
			...ANTHROPIC_ENV,
			JOSH_WORKER_MODEL: 'new',
			JOSH_WORKER_EFFORT: 'high',
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'low',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'new', effort: 'high' })
	})
})

describe('blank new worker overrides', () => {
	it('uses non-empty legacy values where the corresponding new worker key is blank', () => {
		const environment = {
			...ANTHROPIC_ENV,
			JOSH_WORKER_MODEL: ' ',
			JOSH_WORKER_EFFORT: '',
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'xhigh',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'legacy', effort: 'xhigh' })
	})

	it('resolves each worker field independently across new and legacy keys', () => {
		const environment = {
			...ANTHROPIC_ENV,
			JOSH_WORKER_MODEL: 'new',
			JOSH_WORKER_EFFORT: ' ',
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'low',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'new', effort: 'low' })
	})
})

describe('invalid overrides', () => {
	it('rejects an effort outside the allowlist without escalating it', () => {
		const result = agent_role_profile.resolve(WORKER, {
			...ANTHROPIC_ENV,
			JOSH_WORKER_EFFORT: 'turbo',
		})

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain('turbo')
	})

	it('rejects control characters in a model', () => {
		expect(
			agent_role_profile.resolve(REVIEWER, {
				...ANTHROPIC_ENV,
				JOSH_REVIEWER_MODEL: 'op\u{0}us',
			}),
		).toMatchObject({ kind: 'rejected' })
	})
})

// joshuafolkken/kit#2382: effort is a function of the run phase, not the role alone. Only the mechanical
// ship/bookkeeping region (the pre-gate resume) is lowered for the first merge; the judgment phases keep
// the role default, a phase-less call is unchanged, and an env override still wins.
describe('phase-resolved effort', () => {
	const { PRE_GATE_PHASE, IMPLEMENTATION_PHASE } = agent_role_profile

	function effort_for(environment: Record<string, string>, phase?: string): string {
		const result = agent_role_profile.resolve(WORKER, environment, phase)

		if (result.kind === 'rejected') throw new Error(result.note)

		return result.profile.effort
	}

	it('lowers the worker effort in the pre-gate ship phase', () => {
		expect(effort_for(ANTHROPIC_ENV, PRE_GATE_PHASE)).toBe('low')
	})

	it('keeps the role default in a judgment phase', () => {
		expect(effort_for(ANTHROPIC_ENV, IMPLEMENTATION_PHASE)).toBe('medium')
	})

	it('keeps the role default when no phase is passed, so existing callers are unchanged', () => {
		expect(effort_for(ANTHROPIC_ENV)).toBe('medium')
	})

	it('ignores an unrecognized phase and returns the role default', () => {
		expect(effort_for(ANTHROPIC_ENV, 'nonsense')).toBe('medium')
	})

	it('lets the worker env override win over the phase value', () => {
		expect(effort_for({ ...ANTHROPIC_ENV, JOSH_WORKER_EFFORT: 'high' }, PRE_GATE_PHASE)).toBe(
			'high',
		)
	})
})

describe('with_phase_effort', () => {
	const base = agent_role_profile.DEFAULT_PROFILES.worker

	it('applies the phase effort to a stored profile and keeps its model', () => {
		const adjusted = agent_role_profile.with_phase_effort(
			base,
			agent_role_profile.PRE_GATE_PHASE,
			ANTHROPIC_ENV,
		)

		expect(adjusted).toMatchObject({ model: base.model, effort: 'low' })
	})

	it('lets an env override win over the phase for a stored profile', () => {
		const adjusted = agent_role_profile.with_phase_effort(base, agent_role_profile.PRE_GATE_PHASE, {
			...ANTHROPIC_ENV,
			JOSH_WORKER_EFFORT: 'xhigh',
		})

		expect(adjusted.effort).toBe('xhigh')
	})
})
