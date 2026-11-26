import { issue_body_keys } from './issue-body-keys'
import { issue_bug_label } from './issue-bug-label'
import { issue_template_section } from './issue-template-section'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#8941: a bug body names why the existing tests missed the defect, so its tests are
// written to close that reason — red on the same kind of miss — rather than to pin the one case seen.
// Only filing checks it, as with the leading summary: bugs filed before the rule have no such line,
// and `issue:body` / `issue:kind` rewrite them.

const BACKGROUND_HEADING = issue_body_keys.heading('background')
const ESCAPE_PREFIX = issue_body_keys.prefix('escape_reason')
// A template placeholder (`<...>`) is guidance the filer replaces, not a reason.
const PLACEHOLDER_PREFIX = '<'

function escape_lines(body: string): ReadonlyArray<string> {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')

	return markdown_section
		.unfenced_lines(background)
		.map((line) => line.trim())
		.filter((line) => line.startsWith(ESCAPE_PREFIX))
}

function is_reason(line: string): boolean {
	const reason = line.slice(ESCAPE_PREFIX.length).trim()

	return reason.length > 0 && !reason.startsWith(PLACEHOLDER_PREFIX)
}

function names_reason(body: string): boolean {
	return escape_lines(body).some((line) => is_reason(line))
}

// The refusal of a bug body with no escape reason under its background heading; `undefined` for a
// body that names one or is not a bug.
function problem(body: string): string | undefined {
	if (!issue_bug_label.is_bug_fix(body) || names_reason(body)) return undefined

	return `missing escape reason: a \`${issue_bug_label.BUG_DECLARATION_LINE}\` body declares \`${ESCAPE_PREFIX} <why the existing tests missed it>\` under ${BACKGROUND_HEADING}, and its tests close that reason (red on the same kind of miss, not one pinned case) — ${issue_template_section.document_name()}`
}

const escape_reason_lint = { problem }

export { escape_reason_lint }
