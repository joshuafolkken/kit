import { agent_provider, type AgentProvider } from './agent-provider'

const { ANTHROPIC_PROVIDER, PROVIDER_SCHEMA } = agent_provider

// **The consultation main line runs on Opus** (joshuafolkken/kit#6901): the session a person opens
// without a kit launcher. A design consultation goes from it to the `design-consultant` unit on Fable,
// so the main line's own rate stays Opus for operating, filing and plain questions.
const CONSULTATION_MAIN_MODEL = 'claude-opus-5-5'

// **The consultation models** (joshuafolkken/kit#5351) — the high-rate models a launched main line
// never runs on and a main line on one hands its run to `run:handoff`. The Astra id is confirmed on a
// live Codex CLI by joshuafolkken/kit#5394.
const CONSULTATION_MODELS: Readonly<Record<AgentProvider, string>> = {
	anthropic: 'claude-fable-5-1',
	openai: 'gpt-6.1-astra',
}
// The `Agent` tool's alias for the Claude consultation model.
const CONSULTATION_ALIAS = 'fable'

// Every Opus release, the default's family, costs more than the investigation model.
const MAIN_FAMILY_PREFIX = 'claude-opus-'

// The provider whose consultation model this is, by id or by the `Agent` alias; `undefined` for any
// other model.
function consultation_provider(model: string): AgentProvider | undefined {
	if (model === CONSULTATION_ALIAS) return ANTHROPIC_PROVIDER

	return PROVIDER_SCHEMA.options.find((provider) => CONSULTATION_MODELS[provider] === model)
}

// The provider a main line on this model hands its reading over on: the Opus family or a
// consultation model, each above its investigation model's rate; `undefined` for a cheaper or unknown
// model, which has nothing cheaper to hand to.
function rated_provider(model: string): AgentProvider | undefined {
	if (model.startsWith(MAIN_FAMILY_PREFIX)) return ANTHROPIC_PROVIDER

	return consultation_provider(model)
}

const agent_consultation_model = {
	CONSULTATION_ALIAS,
	CONSULTATION_MAIN_MODEL,
	consultation_provider,
	rated_provider,
}

export { agent_consultation_model }
