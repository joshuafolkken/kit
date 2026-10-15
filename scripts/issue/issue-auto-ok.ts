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
// last the body's judgement declaration (`JUDGEMENT_NEEDED` / `JUDGEMENT_NOT_NEEDED`): whether a
// policy decision, an external account or a human visual check is needed.

interface AutoOkFiling {
	// `--no-auto-ok`: the filer declared the Issue needs a person's judgement.
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

const BACKGROUND_HEADING = '## 背景'
const JUDGEMENT_NOT_NEEDED = '- 人の判断: 不要'
const JUDGEMENT_NEEDED = '- 人の判断: 要'
const DECLARATION_PROBLEM = `declare under \`${BACKGROUND_HEADING}\` whether a person's judgement (a policy decision, an external account, a human visual check) is needed: \`${JUDGEMENT_NOT_NEEDED}\` or \`${JUDGEMENT_NEEDED}（<which one>）\` — exactly one (\`issue-template.md\`)`

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

// `true` / `false` for a declared need, `undefined` when the background declares neither or both.
function judgement_of(body: string): boolean | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const lines = markdown_section.unfenced_lines(background).map((line) => line.trim())
	const is_not_needed = lines.some((line) => line.startsWith(JUDGEMENT_NOT_NEEDED))
	const is_needed = lines.some((line) => line.startsWith(JUDGEMENT_NEEDED))

	return is_not_needed === is_needed ? undefined : is_needed
}

// Why the filing is refused for its declaration, or `undefined` when it declares exactly one answer.
function declaration_problem(body: string): string | undefined {
	return judgement_of(body) === undefined ? DECLARATION_PROBLEM : undefined
}

function decide(filing: AutoOkFiling): AutoOkDecision {
	if (filing.is_opted_out) return OPTED_OUT
	if (filing.is_cross_repository) return CROSS_REPOSITORY

	return exclusion_of(filing.labels) ?? (judgement_of(filing.body) === false ? APPLIED : JUDGEMENT)
}

function line_of(decision: AutoOkDecision): string {
	return `auto-ok: ${decision.is_applied ? 'applied' : 'not applied'} — ${decision.reason}`
}

const issue_auto_ok = { declaration_problem, decide, exclusion_of, line_of }

export type { AutoOkDecision, AutoOkFiling }
export { issue_auto_ok }
