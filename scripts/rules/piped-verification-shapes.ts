import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { piped_verification } from './piped-verification'
import { rule_value } from './rule-value'
import { shell_segments } from './shell-segments'

// The `piped-verification` refusals named by the filter that drew them, for `josh rule:value --fresh`.
//
// **Which shape to move from the refusal to the rewrite is read here, not in a transcript by hand.**
// The refusal text is one fixed reason, so the row's `refused` count says how often and never why; the
// command that drew it is the call the errored result answers, paired by its `tool_use_id`
// (joshuafolkken/kit#5266). A shape is named by the first that holds, in the order below: the filters
// that hide a verdict first, the chain — a line of more than one command, a heredoc's body lines
// included — only where no filter explains the refusal.

const SHAPE = {
	head: 'head',
	grep: 'grep',
	script: 'awk|sed|tee',
	chain: 'chain',
	other: 'other',
} as const

type RefusalShape = (typeof SHAPE)[keyof typeof SHAPE]
type ShapeCounts = Map<RefusalShape, number>

const HEAD_FILTER = /^head\b/u
const SCRIPT_FILTER = /^(?:awk|sed|tee)\b/u
// The reason's opening, matched as `rule-value.ts` matches a refusal; a text without the cheap mark —
// the reason's ASCII words, which the rewrite note does not share — is skipped unparsed.
const SIGNATURE = piped_verification.PIPED_VERIFICATION_REASON.slice(
	0,
	rule_value.REASON_SIGNATURE_LENGTH,
)
const CHEAP_MARK = 'piped verification: a pipeline exits'
const HEADING = 'piped-verification refusals by shape:'
const SHAPE_GAP = ' · '

function filter_shape(filters: ReadonlyArray<string>): RefusalShape | undefined {
	if (filters.some((piece) => HEAD_FILTER.test(piece))) return SHAPE.head
	if (filters.some((piece) => piped_verification.EARLY_EXIT_GREP.test(piece))) return SHAPE.grep

	return filters.some((piece) => SCRIPT_FILTER.test(piece)) ? SHAPE.script : undefined
}

function shape_of(command: string): RefusalShape {
	const by_filter = filter_shape(piped_verification.check_filters(command))

	if (by_filter !== undefined) return by_filter

	const segments = shell_segments.segments_of(time_shell.unquoted(command))

	return segments.length > 1 ? SHAPE.chain : SHAPE.other
}

interface Pairing {
	commands: Map<string, string>
	refused: Array<string>
}

type Block = NonNullable<ReturnType<typeof time_transcript_line.parse_line>>['blocks'][number]

function is_refusal(block: Block): boolean {
	if (block.error_text === '') return false

	return time_transcript_line.refusal_body(block.error_text).startsWith(SIGNATURE)
}

function pair_block(block: Block, pairing: Pairing): void {
	if (block.id !== '') pairing.commands.set(block.id, time_shell.bash_command(block.input))
	if (is_refusal(block)) pairing.refused.push(block.result_id)
}

function blocks_of(text: string): Array<Block> {
	return text.split('\n').flatMap((line) => time_transcript_line.parse_line(line)?.blocks ?? [])
}

// The commands one transcript's `piped-verification` refusals answered.
function refused_commands(text: string): Array<string> {
	if (!text.includes(CHEAP_MARK)) return []

	const pairing: Pairing = { commands: new Map(), refused: [] }

	for (const block of blocks_of(text)) pair_block(block, pairing)

	return pairing.refused
		.map((id) => pairing.commands.get(id) ?? '')
		.filter((command) => command !== '')
}

function count(text: string, counts: ShapeCounts): void {
	for (const command of refused_commands(text)) {
		const shape = shape_of(command)

		counts.set(shape, (counts.get(shape) ?? 0) + 1)
	}
}

function render(counts: ShapeCounts): string {
	const cells = Object.values(SHAPE).map(
		(shape) => `${shape} ${(counts.get(shape) ?? 0).toString()}`,
	)

	return `${HEADING} ${cells.join(SHAPE_GAP)}`
}

const piped_verification_shapes = { HEADING, SHAPE, count, refused_commands, render, shape_of }

export { piped_verification_shapes }
export type { RefusalShape, ShapeCounts }
