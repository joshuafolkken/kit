// The `Agent` tool alias a pinned Claude model id runs under (`claude-opus-5-5` → `opus`), so a brief
// can print it beside the id instead of the session converting it by hand.
const CLAUDE_MODEL_PATTERN = /^claude-(?<family>opus|sonnet|haiku|fable)-/u

// The alias of a Claude model id; `undefined` for any other model, a bare alias included.
function alias_of(model: string): string | undefined {
	return CLAUDE_MODEL_PATTERN.exec(model)?.groups?.['family']
}

// The ` (<alias>)` suffix printed after a model id; empty when the model has no alias.
function suffix_of(model: string): string {
	const alias = alias_of(model)

	return alias === undefined ? '' : ` (${alias})`
}

const agent_model_alias = { alias_of, suffix_of }

export { agent_model_alias }
