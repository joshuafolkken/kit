import { agent_consultation_model } from '#scripts/agent/agent-consultation-model'
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
// **The rate is the cost, not the reading.** The consultation main line (Opus by default, Fable or
// Codex Astra where a person picks one) pays its rate for every byte it reads, so a survey, a tree
// search or a long read goes to a subagent on the provider's investigation model. A narrow check of
// one cited line stays in the main line, so it can still verify what the unit returned.
//
// **It fires on every occurrence**: the remedy is the same reading through a unit, so a refusal costs
// one round trip and never wedges the run. A launched session is never refused.

const { ANTHROPIC_PROVIDER, OPENAI_PROVIDER } = agent_provider
const { READ_LINE_CAP, is_broad_investigation, is_delegated_investigation } = broad_investigation
const DELEGATION = '.claude/skills/workflow-commands/delegation.md'
const TOPIC = `\`${DELEGATION}\` → "A consultation main line hands its investigation to a unit"`
const NARROW_EXAMPLE = `\`Read\` of a file or an \`offset\` / \`limit\` range <= ${String(READ_LINE_CAP)} lines, \`grep -n <pattern> <one file>\``

const QUIET = `a launched session (lane, reviewer, scheduler), a delegated unit, a main line on the investigation model, another provider's or an unnamed model, or a narrow check (${NARROW_EXAMPLE})`

type Satisfied = (tail: string, call: GuardedCall, run: GuardRun) => boolean

function reason(provider: AgentProvider, dispatch: string): string {
	const model = agent_role_profile.investigation_model(provider)

	return (
		`⛔ consultation investigation: the consultation main line hands broad investigation to ${dispatch} on ` +
		`\`${model}\`, which returns \`file:line\` citations. ` +
		`Keep only a narrow check here — ${NARROW_EXAMPLE}. It fires on every occurrence (\`${DELEGATION}\`).`
	)
}

// The consultation main line is the session no kit launcher started (joshuafolkken/kit#6901), told
// apart by its launch, not its model: it runs on Opus, the same model a lane does. A launched session
// has its reading budgeted by its own guards, and a delegated unit — the Fable `design-consultant`
// among them — has no `Agent` tool to hand the reading to. A main line on another provider's model
// is the other row's, and one already on the investigation model has nothing cheaper to hand to; an
// unnamed model stays silent rather than guessing.
function is_handed_on(provider: AgentProvider, model: string | undefined): boolean {
	const delegated = agent_role_profile.investigation_model(provider)
	if (model === undefined || model === delegated) return false

	return agent_consultation_model.model_provider(model) === provider
}

function not_consulted_on(provider: AgentProvider): Satisfied {
	return function not_consulted(tail: string, _call: GuardedCall, run: GuardRun): boolean {
		if (run.is_unit === true || agent_session_role.is_launched(run.context.env)) return true

		return !is_handed_on(provider, main_model_reader.main_model(tail, run.model))
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
		'a broad investigation call — `Glob`, `WebFetch`, a `Read` past the line cap, a tree `Grep` or shell search, an investigation dispatch inheriting the model — on the consultation main line on a Claude model. Every occurrence',
	quiet: QUIET,
})

const CODEX_ROW = row('consultation-investigation-codex', OPENAI_PROVIDER, 'a Codex subagent', {
	title: 'Consultation main line delegates investigation (Codex)',
	topic: TOPIC,
	fires: 'a broad shell investigation on the consultation main line on Codex. Every occurrence',
	quiet: QUIET,
})

const consultation_investigation = { CODEX_ROW, ROW }

export { consultation_investigation }
