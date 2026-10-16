import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { time_shell } from '#scripts/time-runtime/time-shell'

// Which kind of work a tool call was, for `josh cost:audit`'s per-tool-category table.
//
// **A Bash call is read by what it runs, not by the tool it went through**: `grep` is a code search
// and `pnpm josh gate` a verification whichever tool carried them, so a Bash call is matched first on
// its josh subcommand and then on its leading word. A call matching nothing is `other`, and a request
// that issued no call at all is `reply` — the model answering, which is a cost of its own.

type ToolCategory =
	| 'code search'
	| 'doc read'
	| 'orchestration'
	| 'issue ops'
	| 'edit'
	| 'verification'
	| 'other'
	| 'reply'

const OTHER: ToolCategory = 'other'
const REPLY: ToolCategory = 'reply'
const ORCHESTRATION: ToolCategory = 'orchestration'

// Each category with the tool names, josh subcommand prefixes and shell words that fall in it, so a
// category is spelled once however many names it takes. A josh prefix covers its family — `lint`
// matches `lint:related`.
interface CategoryNames {
	category: ToolCategory
	tools: ReadonlyArray<string>
	josh: ReadonlyArray<string>
	shell: ReadonlyArray<string>
}

const CATEGORY_NAMES: ReadonlyArray<CategoryNames> = [
	{
		category: 'code search',
		tools: ['Grep', 'Glob', 'WebSearch'],
		josh: [],
		shell: ['grep', 'rg', 'find', 'ls'],
	},
	{
		category: 'doc read',
		tools: ['Read', 'WebFetch'],
		josh: ['doc:', 'read:'],
		shell: ['cat', 'sed', 'head', 'tail', 'wc'],
	},
	{ category: 'edit', tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], josh: [], shell: [] },
	{
		category: ORCHESTRATION,
		tools: [
			'Agent',
			'Task',
			'Skill',
			'TodoWrite',
			'ToolSearch',
			'SendMessage',
			'Monitor',
			'TaskStop',
		],
		josh: [],
		shell: [],
	},
	{ category: 'issue ops', tools: [], josh: ['issue', 'epic'], shell: ['gh'] },
	{
		category: 'verification',
		tools: [],
		josh: ['gate', 'lint', 'test', 'cspell', 'review'],
		shell: ['vitest', 'tsc', 'eslint'],
	},
]

function category_where(is_match: (names: CategoryNames) => boolean): ToolCategory | undefined {
	return CATEGORY_NAMES.find((names) => is_match(names))?.category
}

// Any other josh subcommand drives the run — `run:*`, `ship`, `followup`, `notify` and the rest.
function josh_category(josh_command: string): ToolCategory {
	const name = josh_command.slice(time_shell.JOSH_PREFIX.length)
	const found = category_where((names) => names.josh.some((prefix) => name.startsWith(prefix)))

	return found ?? ORCHESTRATION
}

function bash_category(input: unknown): ToolCategory {
	const command = time_shell.bash_command(input)
	const josh_command = time_shell.josh_command_of(command)

	if (josh_command !== '') return josh_category(josh_command)

	const word = time_shell.leading_word(command)

	return category_where((names) => names.shell.includes(word)) ?? OTHER
}

function category_of(name: string, input: unknown): ToolCategory {
	if (name === cost_blocks.BASH_TOOL) return bash_category(input)

	return category_where((names) => names.tools.includes(name)) ?? OTHER
}

const cost_audit_tool = { OTHER, REPLY, category_of }

export type { ToolCategory }
export { cost_audit_tool }
