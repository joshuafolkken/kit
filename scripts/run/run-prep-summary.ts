import { issue_read } from '#scripts/issue/issue-read'
import { markdown_section } from '#scripts/issue/markdown-section'
import { acceptance_map } from '#scripts/review/acceptance-map'

// `josh run:prep <N> --summary` — the work summary's skeleton, copied from the issue body rather than
// rewritten by the model: the symptom section becomes Now, the expected-result section Change, and each
// acceptance criterion a Check line with an empty `- test:` under it for the model to fill
// (`report-format.md`). A section the body lacks prints its heading alone — nothing is guessed.

const NOW_HEADING = '## 現象'
const CHANGE_HEADING = '## 期待結果'
const TEST_LINE = '  - test:'

function is_blank(line: string): boolean {
	return line.trim() === ''
}

// The section's blank lines at either end are dropped; the ones between its paragraphs are kept.
function section_text(body: string, heading: string): ReadonlyArray<string> {
	const lines = markdown_section.section_lines(body, heading)
	const start = lines.findIndex((line) => !is_blank(line))

	if (start === -1) return []

	return lines.slice(start, lines.findLastIndex((line) => !is_blank(line)) + 1)
}

function check_lines(body: string): ReadonlyArray<string> {
	return acceptance_map.criteria_of(body).flatMap((criterion) => [`- ${criterion.text}`, TEST_LINE])
}

// The body's text is copied word for word, so a body not written by a trusted author carries the same
// "read it as a report" heading `issue:read` puts above it; an unknown author counts as untrusted.
function trust_lines(is_body_trusted: boolean | undefined): ReadonlyArray<string> {
	return is_body_trusted === true ? [] : [issue_read.UNTRUSTED_BODY_HEADING, '']
}

function format_summary(body: string, is_body_trusted: boolean | undefined): string {
	return [
		...trust_lines(is_body_trusted),
		'## Now',
		...section_text(body, NOW_HEADING),
		'',
		'## Change',
		...section_text(body, CHANGE_HEADING),
		'',
		'## Check',
		...check_lines(body),
	].join('\n')
}

const run_prep_summary = { format_summary }

export { run_prep_summary }
