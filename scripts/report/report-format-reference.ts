// Where a fixed-shape failure points its reader. `report:lint`, `test:declared
// --match` and the live-evidence check each said what was missing but not where the shape is written,
// so the reader grepped for it. **The document and its headings are named once, here**, and every
// failure builds its pointer from them — a renamed heading then fails this module's test rather than
// sending the reader to a section that no longer exists.

const REPORT_FORMAT_PATH = 'prompts/collaboration-workflow/report-format.md'
const SUMMARY_RULES_HEADING = '作業前サマリはいつ・どう出すか'
const SUMMARY_TEMPLATE_HEADING = '作業前サマリ（セッション向け・`JOSH_SESSION_LANG` の言語）'
const COMPLETION_REPORT_HEADING = '完了報告（セッション向け）'
const ACCEPTANCE_MAP_HEADING = 'PR 本文の受け入れ条件の対応表'
const REMOVED_TESTS_HEADING = 'PR 本文の消えたテストの処置'
// The lane child's summary is shaped in the backlogrun child's document, not in `report-format.md`.
const CHILD_SUMMARY_PATH = '.claude/skills/workflow-commands/backlogrun-child.md'
const CHILD_SUMMARY_HEADING = 'What the summary carries, and how long it may be'

// The heading goes in single quotes in the runnable form: the template heading carries backticks,
// which a double-quoted shell argument would run as a command substitution.
function section_pointer(path: string, heading: string): string {
	return `${path} → "${heading}" (read it: pnpm josh doc:section ${path} '${heading}')`
}

function pointer(heading: string): string {
	return section_pointer(REPORT_FORMAT_PATH, heading)
}

function child_summary_pointer(): string {
	return section_pointer(CHILD_SUMMARY_PATH, CHILD_SUMMARY_HEADING)
}

const report_format_reference = {
	ACCEPTANCE_MAP_HEADING,
	CHILD_SUMMARY_HEADING,
	CHILD_SUMMARY_PATH,
	child_summary_pointer,
	COMPLETION_REPORT_HEADING,
	pointer,
	REMOVED_TESTS_HEADING,
	REPORT_FORMAT_PATH,
	SUMMARY_RULES_HEADING,
	SUMMARY_TEMPLATE_HEADING,
}

export { report_format_reference }
