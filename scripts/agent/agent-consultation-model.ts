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

// The id prefix of each provider's models, which tells a main line's provider from its model.
const MODEL_PREFIXES: Readonly<Record<AgentProvider, string>> = {
	anthropic: 'claude-',
	openai: 'gpt-',
}

// The provider whose consultation model this is, by id or by the `Agent` alias; `undefined` for any
// other model.
function consultation_provider(model: string): AgentProvider | undefined {
	if (model === CONSULTATION_ALIAS) return ANTHROPIC_PROVIDER

	return PROVIDER_SCHEMA.options.find((provider) => CONSULTATION_MODELS[provider] === model)
}

// The provider a model id belongs to; `undefined` for an id neither provider names.
function model_provider(model: string): AgentProvider | undefined {
	return PROVIDER_SCHEMA.options.find((provider) => model.startsWith(MODEL_PREFIXES[provider]))
}

const agent_consultation_model = {
	CONSULTATION_ALIAS,
	CONSULTATION_MAIN_MODEL,
	consultation_provider,
	model_provider,
}

export { agent_consultation_model }
