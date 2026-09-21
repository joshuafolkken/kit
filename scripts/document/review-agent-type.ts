import { read_unwrapped } from './ai-document-fixture'

// The `/code-review` subagent's agent type is named once, in `chain-rule.md` step 1, so a run stops
// guessing a name like `code-reviewer` and receiving `Agent type not found` (joshuafolkken/kit#2297).
// This reads that name back and checks it is a real Claude Code agent type rather than a plausible
// invention.

const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'

// The built-in Claude Code agent types the `Agent` tool resolves. `general-purpose` is the one the
// review uses — it carries every tool, so it can load the review skill and, with `--fix`, apply
// findings. The set is the source of truth the document test measures the named type against; there is
// no runtime registry to derive it from, so it is enumerated here.
const KNOWN_AGENT_TYPES: ReadonlySet<string> = new Set([
	'general-purpose',
	'Explore',
	'Plan',
	'claude',
	'claude-code-guide',
	'statusline-setup',
])

// The type named as `` `<name>` agent type ``, read from the unwrapped document so a reflow that moved
// the words to a new line does not hide it.
const AGENT_TYPE_PATTERN = /`([\w-]+)` agent type/u

function named_agent_type(text: string = read_unwrapped(CHAIN_RULE)): string | undefined {
	return AGENT_TYPE_PATTERN.exec(text)?.[1]
}

// Whether the document names an agent type and that type is a real one. A missing name and an invented
// name are both failures — the first leaves the run guessing, the second is the guess made canonical.
function names_known_type(text: string = read_unwrapped(CHAIN_RULE)): boolean {
	const named = named_agent_type(text)

	return named !== undefined && KNOWN_AGENT_TYPES.has(named)
}

const review_agent_type = {
	CHAIN_RULE,
	KNOWN_AGENT_TYPES,
	named_agent_type,
	names_known_type,
}

export { review_agent_type }
