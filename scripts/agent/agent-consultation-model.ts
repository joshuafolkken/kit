import { agent_provider, type AgentProvider } from './agent-provider'

const { ANTHROPIC_PROVIDER, PROVIDER_SCHEMA } = agent_provider

// **The consultation models** (joshuafolkken/kit#5351). A main line consulted on one of these pays its
// rate for every byte it reads, so broad investigation goes to a subagent on that provider's
// investigation model. The Astra id is confirmed on a live Codex CLI by joshuafolkken/kit#5394.
const CONSULTATION_MODELS: Readonly<Record<AgentProvider, string>> = {
	anthropic: 'claude-fable-5-1',
	openai: 'gpt-6.1-astra',
}
// The `Agent` tool's alias for the Claude consultation model.
const CONSULTATION_ALIAS = 'fable'

// The provider whose consultation model this is, by id or by the `Agent` alias; `undefined` for any
// other model.
function consultation_provider(model: string): AgentProvider | undefined {
	if (model === CONSULTATION_ALIAS) return ANTHROPIC_PROVIDER

	return PROVIDER_SCHEMA.options.find((provider) => CONSULTATION_MODELS[provider] === model)
}

const agent_consultation_model = { CONSULTATION_MODELS, consultation_provider }

export { agent_consultation_model }
