import { z } from 'zod'

const FIRST_PRINTABLE_CODE = 0x20
const DELETE_CODE = 0x7f
const FIRST_CODE_POINT = 0
const EMPTY_LENGTH = 0
const MAX_VALUE_LENGTH = 4096

const ROLE_SCHEMA = z.enum(['scheduler', 'worker', 'reviewer'])
const PROVIDER_SCHEMA = z.enum(['anthropic', 'openai'])
const EFFORT_SCHEMA = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
const PROFILE_SCHEMA = z.object({
	provider: PROVIDER_SCHEMA.default('anthropic'),
	role: ROLE_SCHEMA,
	model: z.string(),
	effort: EFFORT_SCHEMA,
})

type AgentRole = z.infer<typeof ROLE_SCHEMA>
type AgentProvider = z.infer<typeof PROVIDER_SCHEMA>
type AgentEffort = z.infer<typeof EFFORT_SCHEMA>
type AgentProfile = z.infer<typeof PROFILE_SCHEMA>
type AgentEnvironment = Readonly<Record<string, string | undefined>>
type ProfileResult = { kind: 'profile'; profile: AgentProfile } | { kind: 'rejected'; note: string }
type Rejected = Extract<ProfileResult, { kind: 'rejected' }>
type EffortResult = Rejected | { kind: 'effort'; effort: AgentEffort }

const SCHEDULER: AgentRole = 'scheduler'
const WORKER: AgentRole = 'worker'
const REVIEWER: AgentRole = 'reviewer'
const DEFAULT_PROVIDER: AgentProvider = 'anthropic'
const OPENAI_PROVIDER: AgentProvider = 'openai'
const OPENAI_MODEL = 'gpt-5.6-sol'
const PROVIDER_ENV_KEY = 'JOSH_AGENT_PROVIDER'

const DEFAULT_PROFILES: Readonly<Record<AgentRole, AgentProfile>> = {
	scheduler: { provider: DEFAULT_PROVIDER, role: SCHEDULER, model: 'opus', effort: 'high' },
	worker: { provider: DEFAULT_PROVIDER, role: WORKER, model: 'opus', effort: 'medium' },
	reviewer: { provider: DEFAULT_PROVIDER, role: REVIEWER, model: 'opus', effort: 'high' },
}

const OPENAI_PROFILES: Readonly<Record<AgentRole, AgentProfile>> = {
	scheduler: { provider: OPENAI_PROVIDER, role: SCHEDULER, model: OPENAI_MODEL, effort: 'high' },
	worker: { provider: OPENAI_PROVIDER, role: WORKER, model: OPENAI_MODEL, effort: 'medium' },
	reviewer: { provider: OPENAI_PROVIDER, role: REVIEWER, model: OPENAI_MODEL, effort: 'high' },
}

const PROVIDER_PROFILES = { anthropic: DEFAULT_PROFILES, openai: OPENAI_PROFILES }

const ENV_KEYS: Readonly<Record<AgentRole, { model: string; effort: string }>> = {
	scheduler: { model: 'JOSH_SCHEDULER_MODEL', effort: 'JOSH_SCHEDULER_EFFORT' },
	worker: { model: 'JOSH_WORKER_MODEL', effort: 'JOSH_WORKER_EFFORT' },
	reviewer: { model: 'JOSH_REVIEWER_MODEL', effort: 'JOSH_REVIEWER_EFFORT' },
}

const LEGACY_WORKER_KEYS = { model: 'JOSH_LANE_MODEL', effort: 'JOSH_LANE_EFFORT' }

function is_control_character(character: string): boolean {
	const code = character.codePointAt(FIRST_CODE_POINT) ?? FIRST_PRINTABLE_CODE

	return code < FIRST_PRINTABLE_CODE || code === DELETE_CODE
}

function is_safe_value(value: string): boolean {
	if (value.length === EMPTY_LENGTH || value.length > MAX_VALUE_LENGTH) return false

	for (const character of value) if (is_control_character(character)) return false

	return true
}

function trimmed(value: string | undefined): string | undefined {
	const result = value?.trim()

	return result === undefined || result.length === EMPTY_LENGTH ? undefined : result
}

function override_value(
	role: AgentRole,
	field: 'model' | 'effort',
	environment: AgentEnvironment,
): { key: string; value: string | undefined } {
	const key = ENV_KEYS[role][field]
	const value = trimmed(environment[key])
	if (value !== undefined) return { key, value }
	if (role !== WORKER) return { key, value: undefined }

	const legacy = LEGACY_WORKER_KEYS[field]
	const legacy_value = trimmed(environment[legacy])

	return legacy_value === undefined
		? { key, value: undefined }
		: { key: legacy, value: legacy_value }
}

function rejection(key: string, value: string, expected: string): Rejected {
	return { kind: 'rejected', note: `${key}=${value} ${expected}, so the agent was not started` }
}

function resolved_effort(
	override: { key: string; value: string | undefined },
	fallback: AgentEffort,
): EffortResult {
	const parsed = EFFORT_SCHEMA.safeParse(override.value ?? fallback)

	return parsed.success
		? { kind: 'effort', effort: parsed.data }
		: rejection(override.key, override.value ?? '', 'is not an allowed effort')
}

function resolved_provider(environment: AgentEnvironment): Rejected | { provider: AgentProvider } {
	const raw = trimmed(environment[PROVIDER_ENV_KEY]) ?? DEFAULT_PROVIDER
	const parsed = PROVIDER_SCHEMA.safeParse(raw)

	return parsed.success
		? { provider: parsed.data }
		: rejection(PROVIDER_ENV_KEY, raw, 'is not an allowed provider')
}

function validate(profile: AgentProfile, model_key: string): ProfileResult {
	if (!is_safe_value(profile.model)) {
		return rejection(model_key, profile.model, 'is not a safe model')
	}

	return { kind: 'profile', profile }
}

function resolve(role: AgentRole, environment: AgentEnvironment = process.env): ProfileResult {
	const selected = resolved_provider(environment)
	if ('kind' in selected) return selected
	const defaults = PROVIDER_PROFILES[selected.provider][role]
	const model = override_value(role, 'model', environment)
	const effort = override_value(role, 'effort', environment)
	const resolved = resolved_effort(effort, defaults.effort)

	if (resolved.kind === 'rejected') return resolved

	const profile: AgentProfile = {
		provider: selected.provider,
		role,
		model: model.value ?? defaults.model,
		effort: resolved.effort,
	}

	return validate(profile, model.key)
}

function describe(profile: AgentProfile): string {
	return `provider=${profile.provider} role=${profile.role} model=${profile.model} effort=${profile.effort}`
}

function parse(value: unknown): AgentProfile | undefined {
	const parsed = PROFILE_SCHEMA.safeParse(value)

	return parsed.success && is_safe_value(parsed.data.model) ? parsed.data : undefined
}

const agent_role_profile = {
	DEFAULT_PROFILES,
	DEFAULT_PROVIDER,
	EFFORT_SCHEMA,
	ENV_KEYS,
	LEGACY_WORKER_KEYS,
	MAX_VALUE_LENGTH,
	OPENAI_PROFILES,
	PROVIDER_ENV_KEY,
	PROVIDER_SCHEMA,
	PROFILE_SCHEMA,
	REVIEWER,
	SCHEDULER,
	WORKER,
	describe,
	is_safe_value,
	parse,
	resolve,
}

export type { AgentEffort, AgentEnvironment, AgentProfile, AgentProvider, AgentRole, ProfileResult }
export { agent_role_profile }
