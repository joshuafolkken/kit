import {
	run_board_fit,
	type DetailPart,
	type FrameParts,
	type NotesPart,
	type PlanSection,
} from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'

// Attach identity after folding, widening and lamp expansion have finished parsing headings.
function headed<Part extends { head: ReadonlyArray<string> }>(part: Part, key: string): Part {
	return {
		...part,
		head: part.head.map((line, index) =>
			line === '' ? line : run_board_row_key.flashed(line, `head:${key}:${String(index)}`, true),
		),
	}
}

function detail(part: DetailPart | undefined, key: string): DetailPart | undefined {
	if (part === undefined) return undefined

	return {
		...headed(part, key),
		lines: part.lines.map((line) => ({
			...line,
			text: run_board_row_key.trailing_flash(line.text),
		})),
	}
}

function section(part: PlanSection): PlanSection {
	const key = part.flash_key ?? part.key ?? part.label

	if (key === undefined) return part
	const result = headed(part, key)
	const { fold } = part

	return fold === undefined
		? result
		: {
				...result,
				fold: (cut) => run_board_row_key.flashed(fold(cut), `more:${key}`, true),
			}
}

function notes(part: NotesPart): NotesPart {
	const { more } = part
	const result = headed(part, 'findings')

	return more === undefined
		? result
		: {
				...result,
				more: (hidden) => run_board_row_key.flashed(more(hidden), 'more:findings', true),
			}
}

function keyed(parts: FrameParts, is_on = false): FrameParts {
	if (!is_on) return parts
	const more = parts.more ?? run_board_fit.plain_more

	return {
		...parts,
		more: (hidden) => run_board_row_key.flashed(more(hidden), 'more:plan', true),
		throughput: detail(parts.throughput, 'throughput'),
		usage: detail(parts.usage, 'usage'),
		usage_alone: detail(parts.usage_alone, 'usage'),
		processes: detail(parts.processes, 'processes'),
		plan: parts.plan.map((part) => section(part)),
		below: parts.below?.map((part) => section(part)),
		notes: notes(parts.notes),
	}
}

const run_board_flash_parts = { keyed }

export { run_board_flash_parts }
