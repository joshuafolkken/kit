// Where a fixed-shape failure points its reader. `report:lint`, `test:declared
// --match` and the live-evidence check each said what was missing but not where the shape is written,
// so the reader grepped for it. **The document and its headings are named once, here**, and every
// failure builds its pointer from them — a renamed heading then fails this module's test rather than
// sending the reader to a section that no longer exists.

const REPORT_FORMAT_PATH = 'prompts/collaboration-workflow/report-format.md'
const SUMMARY_RULES_HEADING = '作業前サマリはいつ・どう出すか'
const SUMMARY_TEMPLATE_HEADING = '作業前サマリ（セッション向け・`JOSH_SESSION_LANG` の言語）'
const COMPLETION_REPORT_HEADING = '完了報告（セッション向け）'

// The heading goes in single quotes in the runnable form: the template heading carries backticks,
// which a double-quoted shell argument would run as a command substitution.
function pointer(heading: string): string {
	return `${REPORT_FORMAT_PATH} → "${heading}" (read it: pnpm josh doc:section ${REPORT_FORMAT_PATH} '${heading}')`
}

const report_format_reference = {
	COMPLETION_REPORT_HEADING,
	pointer,
	REPORT_FORMAT_PATH,
	SUMMARY_RULES_HEADING,
	SUMMARY_TEMPLATE_HEADING,
}

export { report_format_reference }
