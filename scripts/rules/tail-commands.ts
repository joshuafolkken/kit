import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line, type Block } from '#scripts/time-runtime/time-transcript-line'

// The `Bash` commands a run's transcript tail already issued, parsed once here rather than in each
// rule that needs them (joshuafolkken/kit#2119). `prior-comment-read.ts` had this reading first; the
// scout gate needs the same "what did the run already run" question, so a second copy would be the
// clone `CLAUDE.md` prohibits. The delivery path sees only the raw tail — `delivered-rules.ts` names
// the reason a run's own calls are not handed to it — so the earlier calls are recovered by parsing
// that tail the same way `time-batch-guard.ts` does.

// A `tool_use` block that ran a shell command.
function is_bash_use(block: Block): boolean {
	return block.type === cost_blocks.TOOL_USE_TYPE && block.name === cost_blocks.BASH_TOOL
}

// The Bash commands one transcript line issued, empty for a line that parses to none.
function bash_commands_of(line: string): ReadonlyArray<string> {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed === undefined) return []

	return parsed.blocks
		.filter((block) => is_bash_use(block))
		.map((block) => time_shell.bash_command(block.input))
}

// Every Bash command the tail holds, in the order they were issued.
function prior_bash_commands(tail: string): ReadonlyArray<string> {
	return tail.split('\n').flatMap((line) => bash_commands_of(line))
}

const tail_commands = { bash_commands_of, is_bash_use, prior_bash_commands }

export { tail_commands }
