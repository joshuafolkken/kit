import { cost_tokens } from '#scripts/cost-runtime/cost-tokens'
import { document_section, type Section } from './document-section'

// What a read costs, and the scoped union that charges one file's cited sections once — split out
// of `entry-read-set.ts` when it reached its line limit. `entry_read_set`
// re-exports `cost_of`, `total` and `Cost` under the names they always had, so the move changed no
// call site.

const NOTHING = 0
const ONE_LINE = 1

interface Cost {
	bytes: number
	tokens: number
}

function cost_of(text: string): Cost {
	return { bytes: Buffer.byteLength(text, 'utf8'), tokens: cost_tokens.estimate(text) }
}

function total(costs: ReadonlyArray<Cost>): Cost {
	const running = { bytes: NOTHING, tokens: NOTHING }

	for (const cost of costs) {
		running.bytes += cost.bytes
		running.tokens += cost.tokens
	}

	return running
}

function add_range(charged: Set<number>, found: Section): void {
	for (let index = found.first_line; index <= found.last_line; index += ONE_LINE) charged.add(index)
}

// `undefined` the moment one heading does not resolve, because that reference is charged at its whole
// file and there is then nothing to union.
function charged_lines(markdown: string, headings: ReadonlyArray<string>): Set<number> | undefined {
	const charged = new Set<number>()

	for (const heading of headings) {
		const found = document_section.section(markdown, heading)

		if (found === undefined) return undefined

		add_range(charged, found)
	}

	return charged
}

// **The union's charged lines are split into contiguous runs, and each run is costed on its own
// natural text.** Joining non-adjacent lines with `\n` into one string fabricates a token boundary at
// every gap the union skipped, so the estimate could drift a token *above* the per-reference sum even
// with no real overlap — a false negative saving the measurement must never print.
// A run is a maximal stretch of consecutive charged lines, which is exactly
// the contiguous text a reader of that section actually reads, so summing the runs both mirrors the
// real read and keeps `scoped` at or below the per-reference sum by construction.
function extend_or_start(runs: Array<Array<number>>, index: number): void {
	const current = runs.at(-1)

	if (current?.at(-1) === index - ONE_LINE) current.push(index)
	else runs.push([index])
}

function contiguous_runs(charged: ReadonlySet<number>): Array<Array<number>> {
	const runs: Array<Array<number>> = []
	const ascending = [...charged].toSorted((left, right) => left - right)

	for (const index of ascending) extend_or_start(runs, index)

	return runs
}

function run_text(lines: ReadonlyArray<string>, run: ReadonlyArray<number>): string {
	return run.map((index) => lines[index] ?? '').join('\n')
}

// **Charged per file over the union of the lines its references cover, never per reference.**
// Summing the references instead double-counts the two ways one file can be cited twice — two
// unresolved headings each charged at the whole file, and a `##` section cited beside one of its own
// `###` children, which `section()` already returns inside the parent. Either one could push the
// scoped figure above the whole one and print a *negative* saving, which is the single direction this
// measurement must not be able to move.
function scoped_file_cost(markdown: string, headings: ReadonlyArray<string>): Cost {
	const charged = charged_lines(markdown, headings)

	if (charged === undefined) return cost_of(markdown)

	const lines = markdown.split('\n')

	return total(contiguous_runs(charged).map((run) => cost_of(run_text(lines, run))))
}

const read_set_cost = { cost_of, scoped_file_cost, total }

export type { Cost }
export { read_set_cost }
