import { issue_auto_ok } from './issue-auto-ok'
import { issue_body_keys } from './issue-body-keys'
import { markdown_section } from './markdown-section'
import { measure_declaration } from './measure-declaration'

// joshuafolkken/kit#8568: a display change is looked at after the merge and fixed in a follow-up Issue
// (joshuafolkken/kit#8246), so a body that waits for a person's pre-merge look parks its run only after
// the implementation and the gate (joshuafolkken/kit#8505). Refused at filing: a judgement-needed line whose
// reason is a visual check alone, and an acceptance criterion only a person looking can meet. A body
// that declares why the change cannot be fixed after the merge passes. Fenced examples do not count.

const BACKGROUND_HEADING = issue_body_keys.heading('background')
const CRITERIA_HEADING = issue_body_keys.heading('criteria')
const JUDGEMENT_NEEDED = issue_body_keys.line('judgement', 'needed')
const JUDGEMENT_NOT_NEEDED = issue_body_keys.line('judgement', 'not_needed')
const POST_MERGE_CHECK = issue_body_keys.prefix('post_merge_check')
const REASON_PREFIX = issue_body_keys.prefix('pre_merge_visual_reason')
const PLACEHOLDER_PREFIX = '<'

const VISUAL = /目視|見た目|visual|appearance/iu
// A criterion is refused only when it names the person who looks: a line that merely mentions a visual
// check, or rules one out, is not one only a person can meet.
const PERSON = /人が|人の目|人間|human|person|manual/iu
// The template's other judgement kinds: a reason naming one is not a visual check alone.
const OTHER_JUDGEMENT = /方針|外部|アカウント|policy|external|account/iu

const REWRITE = `a display change is checked after merge and fixed in a follow-up Issue: declare \`${JUDGEMENT_NOT_NEEDED}\` and \`${POST_MERGE_CHECK} <where to look>\` under ${BACKGROUND_HEADING}; only a change that cannot be fixed after merge declares \`${REASON_PREFIX} <why>\` (\`issue-template.md\`)`

function declares_reason(body: string): boolean {
	const value = measure_declaration.background_value(body, REASON_PREFIX)

	return value !== undefined && value !== '' && !value.startsWith(PLACEHOLDER_PREFIX)
}

function judgement_problem(body: string): string | undefined {
	const reason = issue_auto_ok.judgement_reason(body)

	if (reason === undefined || !VISUAL.test(reason) || OTHER_JUDGEMENT.test(reason)) return undefined

	return `\`${JUDGEMENT_NEEDED}\` names only a pre-merge visual check — ${REWRITE}`
}

function criteria_problems(body: string): ReadonlyArray<string> {
	const section = markdown_section.section_lines(body, CRITERIA_HEADING).join('\n')

	return markdown_section
		.unfenced_lines(section)
		.map((line) => line.trim())
		.filter((line) => VISUAL.test(line) && PERSON.test(line))
		.map((line) => `a criterion asks a person to look: \`${line}\` — ${REWRITE}`)
}

// Every pre-merge visual-check problem a body has, or an empty array.
function problems(body: string): ReadonlyArray<string> {
	if (declares_reason(body)) return []

	return [judgement_problem(body), ...criteria_problems(body)].filter(
		(problem): problem is string => problem !== undefined,
	)
}

const visual_check_lint = { problems }

export { visual_check_lint }
