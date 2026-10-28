import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line, type Block } from '#scripts/time-runtime/time-transcript-line'
import { bash_triggers } from './bash-triggers'
import { tail_commands } from './tail-commands'

// The filings a turn made, read off the session transcript for the `Stop` hook's offer to file
// (`stop-guard.ts`). **No new predicate**: the filing is `bash_triggers.is_issue_filing`, reused
// verbatim. The filing cap is not this count — it is `issue:file`'s own step, per originating work item
// (`scripts/issue/issue-file-cap.ts`, joshuafolkken/kit#4750).
//
// **A guard-refused filing does not count.** Claude Code writes a denied call to the transcript as a
// `tool_use` block with an errored `tool_result` — the same exclusion `investigation-reads.ts` makes
// for a refused read. **Nor does one `issue:file` held itself**: a lint problem or an unacknowledged
// duplicate exits non-zero having filed nothing. The filing is counted only where its result did not
// fail.

interface TailFilings {
	// The `tool_use` id of every filing on the tail.
	filing_ids: Array<string>
	// The id of every result that came back as a failure — a guard refusal, or `issue:file` holding the
	// filing itself (a lint problem, an unacknowledged duplicate), which files nothing either.
	failures: Set<string>
}

function is_filing_use(block: Block): boolean {
	if (!tail_commands.is_bash_use(block)) return false

	return bash_triggers.is_issue_filing(time_shell.bash_command(block.input))
}

function collect_block(block: Block, found: TailFilings): void {
	if (block.result_id !== '' && block.is_error === true) found.failures.add(block.result_id)
	if (is_filing_use(block)) found.filing_ids.push(block.id)
}

function collect_line(line: string, found: TailFilings): void {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed === undefined) return

	for (const block of parsed.blocks) collect_block(block, found)
}

function scan_tail(tail: string): TailFilings {
	const found: TailFilings = { filing_ids: [], failures: new Set<string>() }

	for (const line of tail.split('\n')) collect_line(line, found)

	return found
}

// How many Issues the tail filed, counting only filings whose result did not fail.
function filing_count(tail: string): number {
	const { filing_ids, failures } = scan_tail(tail)

	return filing_ids.filter((id) => !failures.has(id)).length
}

// A person's prompt: a `user` line carrying no tool result. Tool results ride `user` lines too, so the
// absence of one is what marks the line as typed rather than returned.
function is_prompt_line(line: string): boolean {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed?.type !== 'user') return false

	return parsed.blocks.every((block) => block.result_id === '')
}

// The tail from the last prompt on, so a filing an earlier turn made does not answer for this one.
// A tail with no prompt on it is returned whole.
function current_turn(tail: string): string {
	const lines = tail.split('\n')
	const start = lines.findLastIndex((line) => is_prompt_line(line))

	return lines.slice(Math.max(start, 0)).join('\n')
}

// How many Issues this turn has filed — `filing_count` read over `current_turn`.
function turn_filing_count(tail: string): number {
	return filing_count(current_turn(tail))
}

const turn_filings = {
	current_turn,
	filing_count,
	is_prompt_line,
	turn_filing_count,
}

export { turn_filings }
