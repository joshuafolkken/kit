import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { document_section } from '#scripts/document/document-section'
import { decision_oracle } from './decision-oracle'
import { guard_rule_rows } from './guard-rule-rows'

// `josh rule:value --prose` — every prose rule, read against the registered rules that cite its source.
// A prose rule is a paragraph or list item that opens with a bold label, the form these documents
// already cite a rule by (`document-section.ts` → "A bold label is an anchor too"). It is enforced
// where a guard row's `topic` cites the section it sits in, measured only where just a decision
// oracle's `single_source` does, and prose only where nothing does — the count the residency rule
// works down (`prompts/collaboration-workflow/residency.md`).

const PROSE_GLOBS = ['prompts/**/*.md', '.claude/skills/**/*.md', 'CLAUDE.md']
const ENFORCED = '強制あり'
const MEASURED = '計測のみ'
const PROSE_ONLY = '文章だけ'
// The label runs to its closing `**` or the line end, so a label that wraps still names its rule.
const RULE_LINE = /^(?<marker>\s*(?:[-*]|\d+\.) )?\*\*(?<label>[^*]+)/u
const SOURCE_ARROW = '→'
const CITE_MARKS = /["`]/gu
const MARKDOWN_EXTENSION = '.md'
const LABEL_WIDTH = 80
const COLUMN_GAP = '  '
const LINE_BASE = 1

type ProseClass = typeof ENFORCED | typeof MEASURED | typeof PROSE_ONLY

interface ProseDocument {
	file: string
	markdown: string
}

interface ProseRule {
	file: string
	// One-based, as a `file:line` citation reads.
	line: number
	label: string
}

interface AuditedRule extends ProseRule {
	class: ProseClass
}

// Zero-based and inclusive, as `document_section.section` reports a section.
interface Span {
	file: string
	first_line: number
	last_line: number
}

interface Sources {
	guards: ReadonlyArray<string>
	oracles: ReadonlyArray<string>
}

// A bare `**` line opens a rule only after a blank line; mid-paragraph it is a wrapped continuation.
function opens_rule(lines: ReadonlyArray<string>, index: number, marker?: string): boolean {
	return marker !== undefined || (lines[index - LINE_BASE] ?? '').trim() === ''
}

function opening_label(lines: ReadonlyArray<string>, index: number): string | undefined {
	const groups = RULE_LINE.exec(lines[index] ?? '')?.groups ?? {}

	return opens_rule(lines, index, groups['marker']) ? groups['label'] : undefined
}

function rule_at(file: string, lines: ReadonlyArray<string>, index: number): ProseRule | undefined {
	const label = opening_label(lines, index)

	if (label === undefined) return undefined

	return { file, line: index + LINE_BASE, label: label.trim().slice(0, LABEL_WIDTH) }
}

// Fenced lines are quoted code, never a rule — the same flags the section reader skips them by.
function rules_of({ file, markdown }: ProseDocument): Array<ProseRule> {
	const lines = markdown.split('\n')
	const fenced = document_section.fenced_flags(lines)

	return lines
		.map((_line, index) => (fenced[index] === true ? undefined : rule_at(file, lines, index)))
		.filter((rule): rule is ProseRule => rule !== undefined)
}

// A cited file names a document by its path or its base name, as `topic` strings do.
function is_cited_file(file: string, cited: string): boolean {
	return file === cited || file.endsWith(`/${cited}`)
}

function span_of(document: ProseDocument, heading: string): Span | undefined {
	const lines = document.markdown.split('\n')

	if (heading === '') return { file: document.file, first_line: 0, last_line: lines.length }

	const found = document_section.section(document.markdown, heading)

	if (found === undefined) return undefined

	return { file: document.file, first_line: found.first_line, last_line: found.last_line }
}

// The quotes and code marks around a cited name; the section reader drops inner backticks itself.
function bare(text: string): string {
	return text.replaceAll(CITE_MARKS, '').trim()
}

// `` `file.md` → "Heading" `` and `file.md → Heading` alike: the file before the arrow, the section
// after it. A source that is not a markdown document cites no prose rule.
function spans_of(source: string, documents: ReadonlyArray<ProseDocument>): Array<Span> {
	const [head = '', ...rest] = source.split(SOURCE_ARROW)
	const cited = bare(head)

	if (!cited.endsWith(MARKDOWN_EXTENSION)) return []

	const heading = bare(rest.join(SOURCE_ARROW))

	return documents
		.filter((document) => is_cited_file(document.file, cited))
		.map((document) => span_of(document, heading))
		.filter((span): span is Span => span !== undefined)
}

function all_spans(
	sources: ReadonlyArray<string>,
	documents: ReadonlyArray<ProseDocument>,
): Array<Span> {
	return sources.flatMap((source) => spans_of(source, documents))
}

function is_covered(rule: ProseRule, spans: ReadonlyArray<Span>): boolean {
	const index = rule.line - LINE_BASE

	return spans.some(
		(span) => span.file === rule.file && span.first_line <= index && index <= span.last_line,
	)
}

function classify(documents: ReadonlyArray<ProseDocument>, sources: Sources): Array<AuditedRule> {
	const guard_spans = all_spans(sources.guards, documents)
	const oracle_spans = all_spans(sources.oracles, documents)
	const rules = documents.flatMap((document) => rules_of(document))

	return rules.map(function audited(rule: ProseRule): AuditedRule {
		if (is_covered(rule, guard_spans)) return { ...rule, class: ENFORCED }

		return { ...rule, class: is_covered(rule, oracle_spans) ? MEASURED : PROSE_ONLY }
	})
}

function documents_in(cwd: string): Array<ProseDocument> {
	return globSync(PROSE_GLOBS, { cwd })
		.toSorted((left, right) => left.localeCompare(right))
		.map((file) => ({ file, markdown: readFileSync(path.join(cwd, file), 'utf8') }))
}

function registered_sources(): Sources {
	return {
		// The rows `rule:list` prints.
		guards: guard_rule_rows.rows().map((row) => row.about.topic),
		oracles: decision_oracle.DECISION_ORACLES.map((oracle) => oracle.single_source),
	}
}

function audit(cwd: string = process.cwd()): Array<AuditedRule> {
	return classify(documents_in(cwd), registered_sources())
}

function count_of(audited: ReadonlyArray<AuditedRule>, wanted: ProseClass): string {
	return `${wanted} ${audited.filter((rule) => rule.class === wanted).length.toString()}`
}

function render(audited: ReadonlyArray<AuditedRule>): string {
	const rows = audited.map((rule) =>
		[rule.class, `${rule.file}:${rule.line.toString()}`, rule.label].join(COLUMN_GAP),
	)
	const classes: ReadonlyArray<ProseClass> = [ENFORCED, MEASURED, PROSE_ONLY]
	const totals = classes.map((wanted) => count_of(audited, wanted))

	return [...rows, '', totals.join(' · ')].join('\n')
}

const rule_value_prose = { audit, classify, render, ENFORCED, MEASURED, PROSE_ONLY }

export type { AuditedRule, ProseDocument }
export { rule_value_prose }
