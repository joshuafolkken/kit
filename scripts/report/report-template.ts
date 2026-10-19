import type { ReportLabels } from './report-labels'
import { report_lint } from './report-lint'

// The skeletons `report:template` prints — the work summary and the completion report — built from
// the one label table `report:lint` checks against, so a printed skeleton always passes the lint in
// the session's language. What a command can answer is filled in: each changed path gets its own
// change block, and the abnormal cases `josh cases` owes for that path open its "if it breaks" tier.
// The rest is a `<…>` placeholder, the sentences only the writer can supply.

type TemplateKind = 'summary' | 'done'

interface ChangeInput {
	path: string
	abnormal_cases: ReadonlyArray<string>
}

const KINDS: ReadonlyArray<TemplateKind> = ['summary', 'done']
const KIND_NAMES: ReadonlySet<string> = new Set(KINDS)
const PLACEHOLDER = '<…>'
// The test line after the changed path: what changes, the test kind, the test file, the behavior.
const TEST_LINE = `${PLACEHOLDER} — Test: <Unit|E2E> — ${PLACEHOLDER} — ${PLACEHOLDER}`

function is_kind(value: string): value is TemplateKind {
	return KIND_NAMES.has(value)
}

function bold(label: string): string {
	return `**${label}**`
}

function item(label: string, value: string): string {
	return `- ${bold(label)}: ${value}`
}

function code_list(paths: ReadonlyArray<string>): string {
	return paths.length === 0 ? PLACEHOLDER : paths.map((path) => `\`${path}\``).join(', ')
}

// The owed abnormal cases first, then placeholders up to the lint's minimum — never fewer than three.
function break_conditions(abnormal_cases: ReadonlyArray<string>): ReadonlyArray<string> {
	const padding = Math.max(report_lint.MIN_BREAK_CONDITIONS - abnormal_cases.length, 0)
	const conditions = [...abnormal_cases, ...Array.from({ length: padding }, () => PLACEHOLDER)]

	return conditions.map((condition, index) => `     ${String(index + 1)}. ${condition}`)
}

function change_block(change: ChangeInput, index: number, labels: ReportLabels): string {
	return [
		`${String(index + 1)}. \`${change.path}\`: ${TEST_LINE}`,
		`   - ${labels.cases}: ${labels.case_vocabulary.join(' / ')}`,
		`   - ${labels.if_it_breaks}:`,
		...break_conditions(change.abnormal_cases),
	].join('\n')
}

// No path still yields one block, so the skeleton keeps the shape the lint checks.
function change_blocks(changes: ReadonlyArray<ChangeInput>, labels: ReportLabels): string {
	const blocks = changes.length === 0 ? [{ path: PLACEHOLDER, abnormal_cases: [] }] : changes

	return blocks.map((change, index) => change_block(change, index, labels)).join('\n')
}

function summary_template(changes: ReadonlyArray<ChangeInput>, labels: ReportLabels): string {
	return [
		bold(labels.overview),
		'',
		item(labels.now, PLACEHOLDER),
		item(labels.change, PLACEHOLDER),
		item(labels.check, PLACEHOLDER),
		'',
		bold(labels.details),
		'',
		`- ${labels.target}: ${code_list(changes.map((change) => change.path))}`,
		`- ${labels.approach}: ${PLACEHOLDER}`,
		`- ${labels.out_of_scope}: ${PLACEHOLDER}`,
		'',
		bold(labels.changes),
		'',
		change_blocks(changes, labels),
	].join('\n')
}

function done_template(changes: ReadonlyArray<ChangeInput>, labels: ReportLabels): string {
	return [
		bold(labels.completion),
		'',
		item(labels.cause, PLACEHOLDER),
		item(labels.fix, PLACEHOLDER),
		item(labels.result, `${PLACEHOLDER} (v<version>)`),
		'',
		bold(labels.details),
		'',
		`- ${labels.changed_files}: ${code_list(changes.map((change) => change.path))}`,
		`- ${labels.test_results}: ${PLACEHOLDER}`,
		`- ${labels.evidence}: ${PLACEHOLDER}`,
		`- ${labels.caught_by}: ${PLACEHOLDER}`,
		`- ${labels.remaining}: ${PLACEHOLDER}`,
	].join('\n')
}

function build(
	kind: TemplateKind,
	changes: ReadonlyArray<ChangeInput>,
	labels: ReportLabels,
): string {
	return kind === 'summary' ? summary_template(changes, labels) : done_template(changes, labels)
}

const report_template = { KINDS, build, is_kind }

export type { ChangeInput, TemplateKind }
export { report_template }
