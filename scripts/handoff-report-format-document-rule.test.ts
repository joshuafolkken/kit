import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#984: joshuafolkken/kit#968 created a fourth kind of stop — the hand-off — and
// defined no format for reporting it, so the first real hand-off was reported in the completion
// format. Its body said "one child left" and its labels said the run had finished; the labels are
// what a reader sees first. A stop that has no format of its own always borrows one of the other
// three, and always misnames itself doing so.

const FORMAT = 'prompts/collaboration-workflow/report-format.md'
const SKILL = '.claude/skills/workflow-commands/epicrun.md'
// One document, not two. `prompts/collaboration-workflow/epicrun.md` used to carry the hand-off
// procedure in Japanese as well, so the reference to the format had to exist in both copies; under
// joshuafolkken/kit#1188 that file became a pointer with no procedure to attach a reference to.
const EPICRUN_DOCS: ReadonlyArray<string> = [SKILL]

// The four things a hand-off has to say. Dropping any one of them collapses it back into a report
// that could be read as a completion — and `残っていること` is the load-bearing one, since it is
// the only line a finished run would not have.
const HANDOFF_LABELS: ReadonlyArray<string> = [
	'終わったこと',
	'残っていること',
	'止めた理由',
	'次に打つコマンド',
]

describe(`${FORMAT} — defines the hand-off report`, () => {
	const content = read_repo_file(FORMAT)
	const unwrapped = read_unwrapped(FORMAT)

	// A heading of its own, at the same level as the completion report it must not be confused with.
	it('has the section as a heading of its own', () => {
		expect(content).toMatch(/^#{3} .*区切りの報告/mu)
	})

	it.each(HANDOFF_LABELS)('names %j as one of the lines', (label) => {
		expect(unwrapped).toContain(label)
	})

	// The prohibition is the point of the section: the completion labels are defined for a finished
	// run, and an epic mid-flight is not one.
	it('forbids the completion report’s three labels', () => {
		expect(unwrapped).toContain('`原因` / `対応` / `結果` を使わない')
	})

	// A stop that is not completion, not a park and not a failure. Without this a reader files it
	// under whichever of the three looks closest, which is how the format went missing in the first
	// place.
	it('names it as a fourth kind of stop', () => {
		expect(unwrapped).toContain('第 4 の停止')
	})

	// Session output and the Telegram body are read by the same person, so one of them keeping the
	// completion labels would undo the distinction.
	it('applies the same format to the Telegram body', () => {
		expect(unwrapped).toMatch(/Telegram 本文も同じ書式で書/u)
	})

	// The format is only half of it: sent as `completion`, an unfinished epic is announced as
	// finished by the notification's own label, whatever the body says.
	it('names the task type the hand-off notification is sent with', () => {
		expect(unwrapped).toContain('--task-type confirmation')
	})

	// The label table is what a Japanese session translates from; a label missing there is a label
	// that comes out in English.
	it('maps the hand-off labels in the translation table', () => {
		const table = content.slice(content.indexOf('| 英語ドキュメントのラベル'))
		const rows = table.slice(0, table.indexOf('\n\n'))

		expect(rows).toContain('■ 区切り')

		for (const label of HANDOFF_LABELS) expect(rows).toContain(label)
	})
})

// A format nothing points at is a format nobody reaches. The hand-off procedure is where the report
// is written, so that is where the reference has to be — in both copies, since a run reads the
// skill and a person settling a disagreement reads the canonical.
describe.each(EPICRUN_DOCS)('%s — points at the hand-off format', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it('names the document that defines it', () => {
		expect(unwrapped).toContain('report-format.md')
	})

	it('repeats the prohibition rather than only linking to it', () => {
		expect(unwrapped).toContain('完了報告の書式で書かない')
	})

	it('names the four lines the report carries', () => {
		for (const label of HANDOFF_LABELS) expect(unwrapped).toContain(label)
	})
})
