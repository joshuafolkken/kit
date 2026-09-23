import { markdown_section } from './markdown-section'

// A defect-claiming (behavior-change) Issue's reproduction section is written as `command + actual
// output`, never prose, so the claim rests on a run that can be repeated rather than on a reading
// (joshuafolkken/kit#2353). This is the counterpart of `baseline-measure.ts`: the baseline is a
// distilled `command -> value`, the reproduction is the raw command *and* the output block it printed
// — a prose "I checked it" is refused for the same reason a prose baseline is, it cannot be re-run.

const REPRODUCTION_HEADING = '## 再現'
// A backticked command span on a line that is not inside a fenced block. `- `grep …`` and a bare
// `` `grep …` `` both match; prose with no backticked command does not.
const COMMAND_SPAN = /`[^`]+`/u
// A fenced code block boundary — a backtick or tilde fence. The actual output goes between an opening
// and a closing fence, so a valid reproduction carries at least two of these lines. Tilde is accepted
// so the template can show the block without nesting a backtick fence inside its own ```md example.
const FENCE_LINE = /^\s*(?:```|~~~)/u
const FENCE_PAIR = 2

interface Reproduction {
	has_command: boolean
	has_output: boolean
}

// A command span read from the open text before the output block: the reproduction is written command
// first, then the fenced output, so the command lives among the lines ahead of the first fence. Reading
// only there keeps a backticked word inside the output block from being mistaken for the command.
function has_command_line(lines: ReadonlyArray<string>): boolean {
	const first_fence = lines.findIndex((line) => FENCE_LINE.test(line))
	const open_lines = first_fence === -1 ? lines : lines.slice(0, first_fence)

	return open_lines.some((line) => COMMAND_SPAN.test(line))
}

// An opened-and-closed output block is two fence lines, so counting them is enough — a section with a
// single stray fence has no closed block and does not qualify.
function has_output_block(lines: ReadonlyArray<string>): boolean {
	return lines.filter((line) => FENCE_LINE.test(line)).length >= FENCE_PAIR
}

// The heading is a parameter so every `command + actual output` section is read by this one parser —
// a pull request's live-execution evidence section is the same shape (joshuafolkken/kit#2446).
function parse_reproduction(body: string, heading: string = REPRODUCTION_HEADING): Reproduction {
	const lines = markdown_section.section_lines(body, heading)

	return { has_command: has_command_line(lines), has_output: has_output_block(lines) }
}

// A body carries a re-runnable reproduction when its section holds both a backticked command and a
// fenced output block.
function has_command_output(body: string, heading: string = REPRODUCTION_HEADING): boolean {
	const reproduction = parse_reproduction(body, heading)

	return reproduction.has_command && reproduction.has_output
}

const reproduction_measure = { REPRODUCTION_HEADING, has_command_output, parse_reproduction }

export type { Reproduction }
export { reproduction_measure }
