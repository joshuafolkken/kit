import { stripVTControlCharacters } from 'node:util'
import { markdown_section } from '#scripts/issue/markdown-section'
import { shell_quote } from '#scripts/lib/shell-quote'
import { live_evidence } from '#scripts/review/live-evidence'

// **The live evidence a run records instead of pasting it** (joshuafolkken/kit#5585). A lane picked a
// command it had run from its terminal history and pasted it, with its output, under the evidence
// heading by hand; a shape of its own met the ship's preflight refusal. Here the command is run and its
// invocation and output tail are written in the shape `live_evidence.verdict_for` reads, so the run
// chooses only which command is the evidence.

const HEADING_PREFIX = '## '
const BACKTICK = '`'
const BACKTICK_RUN = /`+/gu
const MIN_FENCE = 3
// The end of the output carries the verdict; the whole of a long run would bury it in the body.
const TAIL_LINES = 40

function longest_backtick_run(text: string): number {
	return Math.max(0, ...[...text.matchAll(BACKTICK_RUN)].map((match) => match[0].length))
}

// One run longer than any inside, so a backtick in the command never ends its span early.
function code_span(text: string): string {
	const run = longest_backtick_run(text)
	const ticks = BACKTICK.repeat(run + 1)

	return run === 0 ? `${ticks}${text}${ticks}` : `${ticks} ${text} ${ticks}`
}

function tail_of(output: string): string {
	const lines = stripVTControlCharacters(output).trimEnd().split('\n')

	return lines.slice(-TAIL_LINES).join('\n')
}

// The invocation as one code span and the output tail in a fence no fence inside it closes.
function block_of(command: ReadonlyArray<string>, output: string): string {
	const tail = tail_of(output)
	const fence = BACKTICK.repeat(Math.max(MIN_FENCE, longest_backtick_run(tail) + 1))
	const invocation = command.map((token) => shell_quote.word(token)).join(' ')

	return `${code_span(invocation)}\n\n${fence}\n${tail}\n${fence}\n`
}

// The line after the evidence section's last: the next heading outside a fence, else the end.
function section_end(visible: ReadonlyArray<string>, start: number): number {
	const next = visible.findIndex(
		(line, index) => index > start && line.trimStart().startsWith(HEADING_PREFIX),
	)

	return next === -1 ? visible.length : next
}

// `block` at the end of the evidence section, which is added when the draft has none.
function with_evidence(draft: string, block: string): string {
	const visible = markdown_section.fence_free_lines(draft)
	const start = visible.findIndex((line) => line.trim() === live_evidence.EVIDENCE_HEADING)

	if (start === -1) return `${draft.trimEnd()}\n\n${live_evidence.EVIDENCE_HEADING}\n\n${block}`
	const lines = markdown_section.lines_of(draft)
	const end = section_end(visible, start)
	const before = lines.slice(0, end).join('\n').trimEnd()
	const after = lines.slice(end).join('\n')

	return after === '' ? `${before}\n\n${block}` : `${before}\n\n${block}\n${after}`
}

const run_ship_evidence = { TAIL_LINES, block_of, tail_of, with_evidence }

export { run_ship_evidence }
