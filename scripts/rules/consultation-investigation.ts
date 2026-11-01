import { agent_provider, type AgentProvider } from '#scripts/agent/agent-provider'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import type { GuardRun } from '#scripts/josh/hook-decision'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { broad_investigation } from './broad-investigation'
import type { DeliveredRule, RuleAbout } from './delivered-rules'
import { main_model_reader } from './main-model'

// A consultation main line refuses its own broad investigation (joshuafolkken/kit#5351).
//
// **The rate is the cost, not the reading.** A main line on the consultation model (Fable, Codex
// Astra) pays that rate for every byte it reads, so a survey, a tree search or a long read goes to a
// subagent on the provider's investigation model. A narrow check of one cited line stays in the main
// line, so it can still verify what the unit returned.
//
// **It fires on every occurrence**: the remedy is the same reading through a unit, so a refusal costs
// one round trip and never wedges the run. A main line on any other model is never refused.

const { ANTHROPIC_PROVIDER, OPENAI_PROVIDER } = agent_provider
const { READ_LINE_CAP, is_broad_investigation, is_delegated_investigation } = broad_investigation
const DELEGATION = '.claude/skills/workflow-commands/delegation.md'
const TOPIC = `\`${DELEGATION}\` → "A consultation main line hands its investigation to a unit"`
const NARROW_EXAMPLE = `\`Read\` of a file or an \`offset\` / \`limit\` range <= ${String(READ_LINE_CAP)} lines, \`grep -n <pattern> <one file>\``

const QUIET = `a main line on any other model, or a narrow check (${NARROW_EXAMPLE})`

type Satisfied = (tail: string, call: GuardedCall, run: GuardRun) => boolean

function reason(provider: AgentProvider, dispatch: string): string {
	const model = agent_role_profile.investigation_model(provider)
	const consulted = agent_role_profile.CONSULTATION_MODELS[provider]

	return (
		`⛔ consultation investigation on ${consulted}: hand broad investigation to ${dispatch} on ` +
		`\`${model}\`, which returns \`file:line\` citations. ` +
		`Keep only a narrow check here — ${NARROW_EXAMPLE}. It fires on every occurrence (\`${DELEGATION}\`).`
	)
}

// A main line on any model but this provider's consultation one has nothing to hand over; an unnamed
// model stays silent rather than guessing. A delegated unit or a reviewer session has no `Agent` tool,
// so it has no unit to hand the reading to either.
function not_consulted_on(provider: AgentProvider): Satisfied {
	return function not_consulted(tail: string, _call: GuardedCall, run: GuardRun): boolean {
		if (run.is_unit === true || agent_session_role.is_reviewer()) return true
		const model = main_model_reader.main_model(tail, run.model)

		return model === undefined || agent_role_profile.consultation_provider(model) !== provider
	}
}

function row(
	id: string,
	provider: AgentProvider,
	dispatch: string,
	about: RuleAbout,
): DeliveredRule {
	return {
		id,
		is_trigger: is_broad_investigation,
		// Read at delivery, not import: the hook loads `.env`, which may name the investigation model,
		// only after the rows are imported.
		get reason(): string {
			return reason(provider, dispatch)
		},
		already_satisfied: not_consulted_on(provider),
		decide: (): boolean => true,
		keeps: is_delegated_investigation,
		about,
	}
}

const ROW = row('consultation-investigation', ANTHROPIC_PROVIDER, 'an `investigator`', {
	title: 'Consultation main line delegates investigation (Claude)',
	topic: TOPIC,
	fires:
		'a broad investigation call — `Glob`, `WebFetch`, a `Read` past the line cap, a tree `Grep` or shell search, an investigation dispatch inheriting the model — on Fable. Every occurrence',
	quiet: QUIET,
})

const CODEX_ROW = row('consultation-investigation-codex', OPENAI_PROVIDER, 'a Codex subagent', {
	title: 'Consultation main line delegates investigation (Codex)',
	topic: TOPIC,
	fires: 'a broad shell investigation on Codex Astra. Every occurrence',
	quiet: QUIET,
})

const consultation_investigation = { CODEX_ROW, ROW }

export { consultation_investigation }
