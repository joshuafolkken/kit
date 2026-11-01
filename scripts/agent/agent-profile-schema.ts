import { z } from 'zod'
import { agent_model_alias } from './agent-model-alias'
import { agent_provider, type AgentProvider } from './agent-provider'
import { agent_safe_text } from './agent-safe-text'

// The profile's shape, its role and phase names, each role's default profile and the pure reads over
// a profile — apart from the resolution in `agent-role-profile.ts`, so a module that needs only these
// does not import the resolution and every test reaching it (joshuafolkken/kit#5757).
const ROLE_SCHEMA = z.enum(['scheduler', 'worker', 'reviewer'])
const EFFORT_SCHEMA = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
// The run phases effort may vary by. They are the cut boundaries a lane child
// resumes across — `run-cut.ts` imports these names for its own cut record, so the phase a run passes
// and the phase the profile's table is keyed on cannot drift. A phase-less call resolves the role
// default, which is what keeps every existing caller unchanged.
const PHASE_SCHEMA = z.enum(['implementation', 'pre-gate'])
const PROFILE_SCHEMA = z.object({
	provider: agent_provider.PROVIDER_SCHEMA.default('anthropic'),
	role: ROLE_SCHEMA,
	model: z.string(),
	effort: EFFORT_SCHEMA,
})

type AgentRole = z.infer<typeof ROLE_SCHEMA>
type AgentEffort = z.infer<typeof EFFORT_SCHEMA>
type AgentPhase = z.infer<typeof PHASE_SCHEMA>
type AgentProfile = z.infer<typeof PROFILE_SCHEMA>

const SCHEDULER: AgentRole = 'scheduler'
const WORKER: AgentRole = 'worker'
const REVIEWER: AgentRole = 'reviewer'
const IMPLEMENTATION_PHASE: AgentPhase = 'implementation'
const PRE_GATE_PHASE: AgentPhase = 'pre-gate'

// **Pinned model ids, never a floating alias**. An alias such as `opus` moves
// whenever the CLI moves it, so a run log could not say which model produced it and a model migration
// could not be measured apart from everything else. A new lane records the id it resolved; a lane
// created before a migration keeps the model it recorded (`with_phase` moves it only by a phase key).
const OPENAI_MODEL = 'gpt-6.1-sol'
const ANTHROPIC_MODEL = 'claude-opus-5-5'

// **Round 1 reviews at `medium`** (joshuafolkken/kit#5106): it ended clean on 88% of diffs while its
// `high` run sat on the lane's critical path; the verification pass keeps `high`.
const REVIEW_EFFORT: AgentEffort = 'medium'

const { ANTHROPIC_PROVIDER, OPENAI_PROVIDER } = agent_provider
const { is_safe_value } = agent_safe_text

// Every provider runs each role at the same effort; only the model differs.
function role_profiles(
	provider: AgentProvider,
	model: string,
): Readonly<Record<AgentRole, AgentProfile>> {
	return {
		scheduler: { provider, role: SCHEDULER, model, effort: 'medium' },
		worker: { provider, role: WORKER, model, effort: 'medium' },
		reviewer: { provider, role: REVIEWER, model, effort: REVIEW_EFFORT },
	}
}

// Each role's profile before any env override.
const DEFAULT_PROFILES = role_profiles(ANTHROPIC_PROVIDER, ANTHROPIC_MODEL)
const OPENAI_PROFILES = role_profiles(OPENAI_PROVIDER, OPENAI_MODEL)

function describe(profile: AgentProfile): string {
	return `provider=${profile.provider} role=${profile.role} model=${profile.model}${agent_model_alias.suffix_of(profile.model)} effort=${profile.effort}`
}

// The run-log line a review launch writes, so each round's model is on record beside its round.
function describe_review(round: number, profile: AgentProfile): string {
	return `review round ${String(round)} · ${describe(profile)}`
}

function parse(value: unknown): AgentProfile | undefined {
	const parsed = PROFILE_SCHEMA.safeParse(value)

	return parsed.success && is_safe_value(parsed.data.model) ? parsed.data : undefined
}

const agent_profile_schema = {
	ANTHROPIC_MODEL,
	DEFAULT_PROFILES,
	EFFORT_SCHEMA,
	IMPLEMENTATION_PHASE,
	OPENAI_MODEL,
	OPENAI_PROFILES,
	PHASE_SCHEMA,
	PRE_GATE_PHASE,
	PROFILE_SCHEMA,
	REVIEWER,
	SCHEDULER,
	WORKER,
	describe,
	describe_review,
	parse,
}

export type { AgentEffort, AgentPhase, AgentProfile, AgentRole }
export { agent_profile_schema }
