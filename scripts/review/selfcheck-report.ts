import { review_interaction } from './review-interaction'
import type { Readers, ReadersRead } from './review-untouched-readers'
import type { CommandsReport } from './selfcheck-commands'

// `josh review:selfcheck`'s report (joshuafolkken/kit#5540): one block per question, then one verdict
// line. **Question 4 never fails the verdict** — a reader outside the diff is something to open, not a
// defect — so the line counts it beside the two that can fail. A search that could not answer is exit
// 2, never read as "none found". Where the interaction review is due, question 4 also asks that pass's
// three questions over the due paths, so the author answers them before round 1 (joshuafolkken/kit#5766).

interface Sections {
	stale: { text: string; exit_code: number }
	readers: ReadersRead
	// The paths the interaction review is due on — `review_interaction.due_paths`.
	interaction: ReadonlyArray<string>
	commands: CommandsReport
}

interface SelfcheckReport {
	text: string
	exit_code: number
}

const NONE_LINE = 'none'
const STALE_OK = 'ok'
const FOUND_EXIT = 1
const FAILED_EXIT = 2

function lines_of(reader: Readers): Array<string> {
	if (reader.has_failed) return [`search failed: ${reader.target}`]

	return reader.hits.map(
		(hit) => `${hit.path}:${hit.line} ${reader.target} (from ${reader.origin})`,
	)
}

function reader_lines(read: ReadersRead): Array<string> {
	const omitted =
		read.omitted > 0 ? [`… and ${String(read.omitted)} more edited names, not searched`] : []

	return [...read.readers.flatMap((reader) => lines_of(reader)), ...omitted]
}

// `read` fails whole only on a throw; one reader's search that could not answer fails it too.
function readers_failed(read: ReadersRead): boolean {
	return read.has_failed || read.readers.some((reader) => reader.has_failed)
}

function block(heading: string, lines: ReadonlyArray<string>): string {
	return [heading, ...(lines.length > 0 ? lines : [NONE_LINE])].join('\n')
}

function interaction_lines(due: ReadonlyArray<string>): Array<string> {
	if (due.length === 0) return []

	return [...review_interaction.QUESTIONS, ...due.map((file) => `- ${file}`)]
}

function stale_count(stale: Sections['stale']): number {
	return stale.text === STALE_OK ? 0 : stale.text.split('\n').length
}

function exit_code_of(sections: Sections): number {
	const is_unanswered = sections.stale.exit_code === FAILED_EXIT || readers_failed(sections.readers)

	if (is_unanswered) return FAILED_EXIT

	return stale_count(sections.stale) + sections.commands.failed > 0 ? FOUND_EXIT : 0
}

function verdict(sections: Sections, exit_code: number): string {
	const stale = stale_count(sections.stale)
	const readers = reader_lines(sections.readers).length
	const counts = `q2 ${String(stale)} stale · q10 ${String(sections.commands.failed)} failed`
	const word = ['pass', 'fail', 'unanswered'][exit_code] ?? 'unanswered'

	return `selfcheck: ${word} — ${counts} (q4: ${String(readers)} readers to read)`
}

function report(sections: Sections): SelfcheckReport {
	const exit_code = exit_code_of(sections)
	const blocks = [
		block(
			'## q2 prose matches the code',
			sections.stale.text === STALE_OK ? [] : [sections.stale.text],
		),
		block('## q4 readers outside the diff', reader_lines(sections.readers)),
		block('## q4 interaction review questions', interaction_lines(sections.interaction)),
		block('## q10 commands run', sections.commands.lines),
	]

	return { text: [...blocks, verdict(sections, exit_code)].join('\n\n'), exit_code }
}

const selfcheck_report = { FAILED_EXIT, report }

export type { Sections }
export { selfcheck_report }
