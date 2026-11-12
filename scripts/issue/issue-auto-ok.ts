import { issue_body_keys } from './issue-body-keys'
import {
	BREAKING_CHANGE_LABEL,
	DEFERRED_LABEL,
	EPIC_LABEL,
	has_label_name,
	NEEDS_HUMAN_REVIEW_LABEL,
	RELEASE_LABEL,
} from './issue-labels'
import { markdown_section } from './markdown-section'

// Whether `josh issue:file` applies `auto-ok` to the Issue it files, judged against the criteria
// `docs/how-to/run-backlog.md` records rather than the context the filing happens in, so a filing a
// person asked for (`kickoff new`) is judged the same as one an agent makes on its own. The answer is
// a pure reading of the filing — its labels, its body and its target — so `backlogrun`'s judgement
// of an Issue already open reuses `exclusion_of` rather than a second list (joshuafolkken/kit#3854).
// The order: `--no-auto-ok`, a filing to another repository (whose own `backlogrun` would implement
// and merge it though nobody opted that repository in), a label that keeps a person in the loop, and
// last the body's recorded user prohibition or judgement declaration (`JUDGEMENT_NEEDED` / `JUDGEMENT_NOT_NEEDED`): whether a
// policy decision, an external account or a human visual check is needed.

interface AutoOkFiling {
	// `--no-auto-ok`: an existing exclusion or a verified original user prohibition.
	is_opted_out: boolean
	is_cross_repository: boolean
	// Every label the filing carries, including the ones the body's declarations add.
	labels: ReadonlyArray<string>
	body: string
}

interface AutoOkDecision {
	is_applied: boolean
	reason: string
}

const BACKGROUND_HEADING = issue_body_keys.heading('background')
const JUDGEMENT_NOT_NEEDED = issue_body_keys.line('judgement', 'not_needed')
const JUDGEMENT_NEEDED = issue_body_keys.line('judgement', 'needed')
const DECLARATION_PROBLEM = `declare under \`${BACKGROUND_HEADING}\` whether a person's judgement (a policy decision, an external account, a human visual check) is needed: \`${JUDGEMENT_NOT_NEEDED}\` or \`${JUDGEMENT_NEEDED}（<which one>）\` — exactly one (\`issue-template.md\`)`
const DECISION_RULE_PREFIX = issue_body_keys.prefix('decision_rule')
const DECISION_PROBLEM = `a decision rule citing a measurement Issue determines the choice; declare \`${JUDGEMENT_NOT_NEEDED}\` and record the applied result and reason in an Issue comment`

const OPTED_OUT: AutoOkDecision = { is_applied: false, reason: '--no-auto-ok declared' }
const CROSS_REPOSITORY: AutoOkDecision = {
	is_applied: false,
	reason: 'the Issue is filed to another repository',
}
const JUDGEMENT: AutoOkDecision = {
	is_applied: false,
	reason: `the body declares \`${JUDGEMENT_NEEDED}\``,
}
const APPLIED: AutoOkDecision = {
	is_applied: true,
	reason: 'no exclusion holds and the body declares no judgement is needed',
}
const CONSTRAINT_HEADING = issue_body_keys.heading('auto_execution_constraint')
const CONSTRAINT_SOURCE = `${issue_body_keys.prefix('constraint_source')} user`
const CONSTRAINT_REFERENCE = `${issue_body_keys.prefix('constraint_reference')} `
const CONSTRAINT_INSTRUCTION = `${issue_body_keys.prefix('constraint_instruction')} `
const CONSTRAINT_FIELDS = [CONSTRAINT_REFERENCE, CONSTRAINT_INSTRUCTION]
const CONSTRAINT_PROBLEM = `--no-auto-ok without an exclusion needs ${CONSTRAINT_HEADING}: ${CONSTRAINT_SOURCE}, ${CONSTRAINT_REFERENCE}<original user prompt or comment URL>, ${CONSTRAINT_INSTRUCTION}<verbatim prohibition>; verify the cited user instruction, not an agent inference or a later judgement. Kickoff ending at planning is not an opt-out.`
const USER_CONSTRAINT: AutoOkDecision = {
	is_applied: false,
	reason: 'a user prohibition is recorded under 自動実行の制約',
}

function user_constraint_of(body: string): AutoOkDecision | undefined {
	const section = markdown_section.section_lines(body, CONSTRAINT_HEADING).join('\n')
	const lines = markdown_section.unfenced_lines(section).map((line) => line.trim())
	const has_fields = CONSTRAINT_FIELDS.every((prefix) =>
		lines.some((line) => line.startsWith(prefix) && line.slice(prefix.length).trim() !== ''),
	)

	return has_fields && lines.includes(CONSTRAINT_SOURCE) ? USER_CONSTRAINT : undefined
}

// The labels that keep a person in the loop, each with the reason it withholds `auto-ok`. A
// `breaking-change` declared in the body arrives here as its label, added before the decision.
const EXCLUDED_LABELS: ReadonlyArray<readonly [string, string]> = [
	[RELEASE_LABEL, 'a release is Tier C'],
	[BREAKING_CHANGE_LABEL, 'a breaking change needs a person to accept the migration'],
	[DEFERRED_LABEL, 'the Issue is deferred'],
	[NEEDS_HUMAN_REVIEW_LABEL, 'a person reviews the change before it lands'],
	[EPIC_LABEL, 'an epic is opted in by a person, and that opts in every descendant'],
]

// The first label that withholds `auto-ok`, or `undefined` when none of them is present.
function exclusion_of(labels: ReadonlyArray<string>): AutoOkDecision | undefined {
	const found = EXCLUDED_LABELS.find(([label]) => has_label_name(labels, label))

	if (found === undefined) return undefined

	return { is_applied: false, reason: `a \`${found[0]}\` Issue — ${found[1]}` }
}

function background_lines(body: string): ReadonlyArray<string> {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')

	return markdown_section.unfenced_lines(background).map((line) => line.trim())
}

// `true` / `false` for a declared need, `undefined` when the background declares neither or both.
function judgement_of(body: string): boolean | undefined {
	const lines = background_lines(body)
	const is_not_needed = lines.some((line) => line.startsWith(JUDGEMENT_NOT_NEEDED))
	const is_needed = lines.some((line) => line.startsWith(JUDGEMENT_NEEDED))

	return is_not_needed === is_needed ? undefined : is_needed
}

// Why the filing is refused for its declaration, or `undefined` when it declares exactly one answer.
function declaration_problem(body: string): string | undefined {
	return judgement_of(body) === undefined ? DECLARATION_PROBLEM : undefined
}

function decision_problem(body: string): string | undefined {
	if (judgement_of(body) !== true) return undefined
	const has_rule = background_lines(body).some(
		(line) => line.startsWith(DECISION_RULE_PREFIX) && /#[1-9]\d*\b/u.test(line),
	)

	return has_rule ? DECISION_PROBLEM : undefined
}

function body_decision(body: string): AutoOkDecision {
	return user_constraint_of(body) ?? (judgement_of(body) === false ? APPLIED : JUDGEMENT)
}

function decide(filing: AutoOkFiling): AutoOkDecision {
	if (filing.is_opted_out) return OPTED_OUT
	if (filing.is_cross_repository) return CROSS_REPOSITORY

	return exclusion_of(filing.labels) ?? body_decision(filing.body)
}

function opt_out_problem(filing: AutoOkFiling): string | undefined {
	if (!filing.is_opted_out || user_constraint_of(filing.body) !== undefined) return undefined
	const without_opt_out = decide({ ...filing, is_opted_out: false })

	return without_opt_out.is_applied ? CONSTRAINT_PROBLEM : undefined
}

function line_of(decision: AutoOkDecision): string {
	return `auto-ok: ${decision.is_applied ? 'applied' : 'not applied'} — ${decision.reason}`
}

const issue_auto_ok = {
	declaration_problem,
	decide,
	decision_problem,
	exclusion_of,
	line_of,
	opt_out_problem,
	user_constraint_of,
}

export type { AutoOkDecision, AutoOkFiling }
export { issue_auto_ok }
