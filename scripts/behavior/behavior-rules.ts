import { json_value } from '#scripts/lib/json-value'
import type { Block, TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import type { Assertion, Finding } from './behavior-assertion'

// The behavior assertions checked against recorded transcripts (joshuafolkken/kit#2365). This is the
// **seed set** — the issue's own plan is to land one rule that is green across the recorded corpus,
// then add more one at a time, each verified green before it joins. Starting with many would land a
// wall of red that says nothing about which behavior actually regressed.

const BASH_TOOL = 'Bash'
const TOOL_USE = 'tool_use'
const COMMAND_KEY = 'command'
const FIRST_POSITION_OFFSET = 1

// The git subcommands that stage or rewrite the index — the ones `CLAUDE.md` reserves for `pnpm josh
// git` under "Never stage or mutate the git index on your own". An agent that runs one directly has
// overwritten the user's snapshot with a command the settings deny it.
//
// **The match is anchored at the start of a command segment, not searched anywhere in the string.** A
// `grep '…git commit…'` or an `echo "git add"` mentions the words without running them, and searching
// the whole command would read the mention as the act — the exact false positive that would turn a
// run that only investigated git into a red gate. Splitting on the shell's own separators and
// requiring the segment to *begin* with the mutation is what tells the command from the quotation.
const SEGMENT_SEPARATOR = /[\n;&|]+/u
const INDEX_MUTATION_HEAD = /^git\s+(?:commit|add|rm\s+--cached|restore\s+--staged)\b/u
// `git add -n` / `--dry-run` stage nothing, so they are not a mutation — the one such command in the
// recorded corpus is a `git add -n .` dry run, and reading it as a violation would fail the assertion
// on a run that broke no rule. **`-n` means dry-run only where the subcommand defines it that way**:
// for `add`/`rm` it is `--dry-run`, but for `git commit` `-n` is `--no-verify`, a real commit — so the
// short flag is honored only after an `add`/`rm` head, while `--dry-run` is unambiguous everywhere.
const DRY_RUN_LONG = /(?:^|\s)--dry-run(?:\s|$)/u
const DRY_RUN_SHORT = /(?:^|\s)-n(?:\s|$)/u
const DRY_RUN_SHORT_HEAD = /^git\s+(?:add|rm)\b/u

function is_dry_run(segment: string): boolean {
	if (DRY_RUN_LONG.test(segment)) return true

	return DRY_RUN_SHORT_HEAD.test(segment) && DRY_RUN_SHORT.test(segment)
}

const INDEX_ASSERTION_NAME = 'no-direct-git-index-mutation'

// The Bash command a tool-use block ran, or `undefined` for every other block — a text block, a tool
// result, or a call to any tool but `Bash`. Read through `json_value.is_record` so a malformed input
// is treated as absent rather than throwing mid-scan.
function command_of(block: Block): string | undefined {
	if (block.type !== TOOL_USE || block.name !== BASH_TOOL) return undefined
	if (!json_value.is_record(block.input)) return undefined

	const command = block.input[COMMAND_KEY]

	return typeof command === 'string' ? command : undefined
}

// Whether any segment of a command directly mutates the index: it begins with a staging or commit
// subcommand and is not a dry run. Each `;`/`&&`/`|`-separated segment is judged on its own, so a
// mutation anywhere in a chain is caught while a mention inside another command's argument is not.
function is_index_mutation(command: string): boolean {
	return command
		.split(SEGMENT_SEPARATOR)
		.map((segment) => segment.trim())
		.some((segment) => INDEX_MUTATION_HEAD.test(segment) && !is_dry_run(segment))
}

// The direct index mutations one transcript line ran, each as a finding at that line's position. A
// line is one assistant content block, so its position is a place a reader can open in the file.
function line_mutations(line: TranscriptLine, index: number): ReadonlyArray<Finding> {
	return line.blocks
		.map((block) => command_of(block))
		.filter((command): command is string => command !== undefined && is_index_mutation(command))
		.map((command) => ({
			assertion: INDEX_ASSERTION_NAME,
			position: index + FIRST_POSITION_OFFSET,
			detail: command,
		}))
}

function scan_index_mutation(lines: ReadonlyArray<TranscriptLine>): ReadonlyArray<Finding> {
	return lines.flatMap((line, index) => line_mutations(line, index))
}

const index_mutation_assertion: Assertion = {
	name: INDEX_ASSERTION_NAME,
	describe: 'git staging or commit must go through `pnpm josh git`, never a direct git call',
	scan: scan_index_mutation,
}

// The seed set: every rule green across the recorded corpus today. A new rule is appended here only
// after it has been verified green against past real runs.
const ALL_ASSERTIONS: ReadonlyArray<Assertion> = [index_mutation_assertion]

const behavior_rules = {
	ALL_ASSERTIONS,
	INDEX_ASSERTION_NAME,
	command_of,
	index_mutation_assertion,
	is_index_mutation,
}

export { behavior_rules }
