import {
	agent_profile_schema,
	type AgentEffort,
	type AgentPhase,
	type AgentRole,
} from './agent-profile-schema'
import { agent_provider, type AgentEnvironment, type AgentProvider } from './agent-provider'

const { OPENAI_PROVIDER, trimmed } = agent_provider
const { PHASE_SCHEMA, PRE_GATE_PHASE } = agent_profile_schema

interface PhaseModel {
	key: string
	value: string
}

type PhaseTable<Value> = Readonly<Partial<Record<AgentRole, Partial<Record<AgentPhase, Value>>>>>

const SONNET_MODEL = 'claude-sonnet-5-5'

// **Effort as a function of the run phase, not the role alone**. For the first
// merge only the mechanical ship/bookkeeping region is lowered: the pre-gate resume drives the gate,
// commit, PR and merge, applying fixes the gate has already named — work delegation.md calls the opposite
// of judgement. The design-judgment implementation phases keep the role default, as does any role/phase
// with no entry, and the review's own judgement is the reviewer role's, untouched by lowering
// the worker here. The investigation phase — highest output density — is left for a later merge, once
// the delegation half of this Issue has moved its reading out.
const SHIP_EFFORT: AgentEffort = 'low'
const PHASE_EFFORT: PhaseTable<AgentEffort> = {
	worker: { [PRE_GATE_PHASE]: SHIP_EFFORT },
}

// **The ship phase may run on a model of its own** (joshuafolkken/kit#5343), read from its key ahead of
// the role's and applied on the same cut relaunch as `SHIP_EFFORT`. Unset, the phase runs on its default:
// Sonnet held the ship phase's duration and stop rates against Opus across a lane trial (joshuafolkken/kit#5346).
const PHASE_MODELS: PhaseTable<PhaseModel> = {
	worker: { [PRE_GATE_PHASE]: { key: 'JOSH_WORKER_SHIP_MODEL', value: SONNET_MODEL } },
}

function phase_model_keys(): ReadonlyArray<string> {
	return Object.values(PHASE_MODELS).flatMap((phases) =>
		Object.values(phases).map(({ key }) => key),
	)
}

// A role's entry in a phase table; `undefined` for a phase-less or unrecognized phase, or no entry.
function phase_entry<Value>(
	table: PhaseTable<Value>,
	role: AgentRole,
	phase: string | undefined,
): Value | undefined {
	const parsed = PHASE_SCHEMA.safeParse(phase)

	return parsed.success ? table[role]?.[parsed.data] : undefined
}

// The phase's own model — its key when set, else its default; `undefined` for a phase with no entry or
// an OpenAI session, whose model is never read from env.
function phase_model(
	role: AgentRole,
	provider: AgentProvider,
	phase: string | undefined,
	environment: AgentEnvironment,
): PhaseModel | undefined {
	const entry = provider === OPENAI_PROVIDER ? undefined : phase_entry(PHASE_MODELS, role, phase)
	if (entry === undefined) return undefined

	return { key: entry.key, value: trimmed(environment[entry.key]) ?? entry.value }
}

// The effort a phase resolves to before any env override: the phase's own value where the table names
// one, otherwise the fallback. A phase-less or unrecognized call returns the
// fallback unchanged, which is what keeps every existing caller reading the current default.
function phase_effort(
	role: AgentRole,
	phase: string | undefined,
	fallback: AgentEffort,
): AgentEffort {
	return phase_entry(PHASE_EFFORT, role, phase) ?? fallback
}

const agent_phase_profile = {
	SONNET_MODEL,
	phase_effort,
	phase_model,
	phase_model_keys,
}

export { agent_phase_profile }
