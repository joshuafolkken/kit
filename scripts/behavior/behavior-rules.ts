import { json_value } from '#scripts/lib/json-value'
import { direct_pr_create } from '#scripts/rules/direct-pr-create'
import { time_shell } from '#scripts/time-runtime/time-shell'
import type { Block, TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import type { Assertion, Finding } from './behavior-assertion'

// The behavior assertions checked against recorded transcripts. Rules join one at a time, each
// verified green across the recorded corpus first — starting with many would land a wall of red that
// says nothing about which behavior actually regressed.

const BASH_TOOL = 'Bash'
const TOOL_USE = 'tool_use'
const COMMAND_KEY = 'command'
const FIRST_POSITION_OFFSET = 1
const TOOL_RESULT = 'tool_result'
// The openings of the two results that mean a Bash call never ran: the permission layer's refusal,
// and a PreToolUse hook's block. A PostToolUse hook error is deliberately
// absent — that hook fires after the command has already run.
const DENIED_BASH_PREFIXES = [
	'Permission to use Bash with command ',
	'PreToolUse:Bash hook error: ',
]

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

// The Bash command a tool-use block requested, or `undefined` for every other block — a text block,
// a tool result, or a call to any tool but `Bash`. Read through `json_value.is_record` so a malformed
// input is treated as absent rather than throwing mid-scan.
function command_of(block: Block): string | undefined {
	if (block.type !== TOOL_USE || block.name !== BASH_TOOL || !json_value.is_record(block.input)) {
		return undefined
	}

	const command = block.input[COMMAND_KEY]

	return typeof command === 'string' ? command : undefined
}

// Whether any segment of a command directly mutates the index: it begins with a staging or commit
// subcommand and is not a dry run. Each `;`/`&&`/`|`-separated segment is judged on its own, so a
// mutation anywhere in a chain is caught while a mention inside another command's argument is not.
//
// Quoted spans are removed before the split: a `|` inside a quoted pattern —
// `grep -E "commit|git add" file` — is not a separator, and cutting there synthesized a segment that
// began with `git add` out of a read-only search. `unquoted` honors escapes and heredoc bodies, so a
// stray `it's` cannot pair with a later quote and erase the real `git add` between them.
function is_index_mutation(command: string): boolean {
	return time_shell
		.unquoted(command)
		.split(SEGMENT_SEPARATOR)
		.map((segment) => segment.trim())
		.some((segment) => INDEX_MUTATION_HEAD.test(segment) && !is_dry_run(segment))
}

// An errored result alone may mean a command ran and failed. Only a refusal before execution — the
// permission layer's or a PreToolUse hook's — identifies a Bash call that never ran; the parser keeps
// the opening of that result's text.
function is_denied_result(block: Block): boolean {
	return (
		block.type === TOOL_RESULT &&
		block.result_id !== '' &&
		block.is_error === true &&
		DENIED_BASH_PREFIXES.some((prefix) => block.error_text.startsWith(prefix))
	)
}

function denied_call_ids(lines: ReadonlyArray<TranscriptLine>): ReadonlySet<string> {
	return new Set(
		lines.flatMap((line) =>
			line.blocks.filter((block) => is_denied_result(block)).map((block) => block.result_id),
		),
	)
}

// The Bash calls that ran on one transcript line and broke the rule, each as a finding at that line's
// position. A line is one assistant content block, so its position is a place a reader can open.
function line_findings(
	line: TranscriptLine,
	position: number,
	denied_ids: ReadonlySet<string>,
	rule: BashRule,
): ReadonlyArray<Finding> {
	return line.blocks
		.filter((block) => !denied_ids.has(block.id))
		.map((block) => command_of(block))
		.filter((command): command is string => command !== undefined && rule.is_violation(command))
		.map((command) => ({ assertion: rule.name, position, detail: command }))
}

interface BashRule {
	name: string
	describe: string
	is_violation: (command: string) => boolean
}

// One assertion over the Bash calls a run actually executed: a call the permission layer or a
// PreToolUse hook refused never ran, so it breaks nothing.
function bash_assertion(rule: BashRule): Assertion {
	function scan(lines: ReadonlyArray<TranscriptLine>): ReadonlyArray<Finding> {
		const denied_ids = denied_call_ids(lines)

		return lines.flatMap((line, index) =>
			line_findings(line, index + FIRST_POSITION_OFFSET, denied_ids, rule),
		)
	}

	return { name: rule.name, describe: rule.describe, scan }
}

const index_mutation_assertion = bash_assertion({
	name: INDEX_ASSERTION_NAME,
	describe: 'git staging or commit must go through `pnpm josh git`, never a direct git call',
	is_violation: is_index_mutation,
})

// The matcher is the `direct-pr-create` guard's own, so the assertion and the refusal cannot drift. The
// guard refuses every match, so a finding means a direct PR call ran past it — every run since the
// guard landed is green; the only hits in the corpus predate it.
const PR_CREATE_ASSERTION_NAME = 'no-direct-pr-create'
const pr_create_assertion = bash_assertion({
	name: PR_CREATE_ASSERTION_NAME,
	describe: 'a pull request must be opened with `pnpm josh pr`, never `gh pr create` or `gh api`',
	is_violation: direct_pr_create.is_direct_pr_create,
})

// Every rule green across the recorded corpus. A new rule is appended here only after it has been
// verified green against past real runs.
const ALL_ASSERTIONS: ReadonlyArray<Assertion> = [index_mutation_assertion, pr_create_assertion]

const behavior_rules = {
	ALL_ASSERTIONS,
	INDEX_ASSERTION_NAME,
	PR_CREATE_ASSERTION_NAME,
	command_of,
	index_mutation_assertion,
	is_index_mutation,
	pr_create_assertion,
}

export { behavior_rules }
