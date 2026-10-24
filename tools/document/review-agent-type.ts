import { readdirSync } from 'node:fs'
import path from 'node:path'
import { read_unwrapped } from '#scripts/document/ai-document-fixture'

// The `/code-review` subagent's agent type is named once, in `chain-rule.md` step 1, so a run stops
// guessing a name like `code-reviewer` and receiving `Agent type not found`.
// This reads that name back and checks it is a real agent type rather than a plausible invention.

const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'

// The built-in Claude Code agent types the `Agent` tool resolves. There is no runtime registry to
// derive them from, so they are enumerated here.
const BUILT_IN_AGENT_TYPES: ReadonlyArray<string> = [
	'general-purpose',
	'Explore',
	'Plan',
	'claude',
	'claude-code-guide',
	'statusline-setup',
]

// The project's own agent types, one definition file each. `reviewer` is the one the review uses: it
// carries no `Skill` and no `Agent` tool, so the review cannot fork a second agent that reads the same
// diff and brief again (joshuafolkken/kit#4715).
const AGENT_DIRECTORY = '.claude/agents'
const DEFINITION_EXTENSION = '.md'

function project_agent_types(): ReadonlyArray<string> {
	return readdirSync(path.join(process.cwd(), AGENT_DIRECTORY))
		.filter((entry) => entry.endsWith(DEFINITION_EXTENSION))
		.map((entry) => path.basename(entry, DEFINITION_EXTENSION))
}

const KNOWN_AGENT_TYPES: ReadonlySet<string> = new Set([
	...BUILT_IN_AGENT_TYPES,
	...project_agent_types(),
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
	named_agent_type,
	names_known_type,
}

export { review_agent_type }
