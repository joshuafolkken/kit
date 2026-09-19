import { describe, expect, it } from 'vitest'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

const { REVIEWER, SCHEDULER, WORKER } = agent_role_profile
const OPENAI_MODEL = 'gpt-5.6-sol'
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
			model: 'opus',
			effort: 'medium',
		})
		expect(profile(WORKER, ANTHROPIC_ENV)).toMatchObject({
			provider: 'anthropic',
			model: 'opus',
			effort: 'medium',
		})
		expect(profile(REVIEWER, ANTHROPIC_ENV)).toMatchObject({
			provider: 'anthropic',
			model: 'opus',
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
})

describe('invoking session detection', () => {
	it('rejects an environment with no invoking agent session', () => {
		expect(agent_role_profile.resolve(WORKER, {})).toMatchObject({ kind: 'rejected' })
	})

	it('rejects conflicting invoking agent sessions instead of choosing a fallback', () => {
		const result = agent_role_profile.resolve(WORKER, { ...ANTHROPIC_ENV, ...OPENAI_ENV })

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain('both Codex and Claude Code')
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
