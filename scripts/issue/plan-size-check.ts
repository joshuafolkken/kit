import { git_gh_command } from '#scripts/gh/git-gh-command'
import { lane_net_read } from '#scripts/lane/lane-net-read'
import { json_value } from '#scripts/lib/json-value'
import { split_assess } from '#scripts/split/split-assess'
import { z } from 'zod'
import { issue_body_keys } from './issue-body-keys'
import { issue_cite } from './issue-cite'
import { markdown_section } from './markdown-section'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#7734: a plan re-read against the tree can state an estimate past the guide that
// the filing passed, yet `issue:plan --planned` labelled it `run:planned` and one lane took it. The
// plan's estimate and its reason it stays one Issue — each the plan's line when it states one, else
// the issue body's — are judged by the filing's own `size_estimate.guide_problem`.

const BACKGROUND_HEADING = issue_body_keys.heading('background')
const SIZE_PREFIX = issue_body_keys.prefix('size')
const { REASON_PREFIX } = split_assess
const ISSUE_FIELDS = 'body,labels'
const label_schema = z.object({ name: z.string() })
const issue_schema = z.object({ body: z.string(), labels: z.array(label_schema) })

type Issue = z.infer<typeof issue_schema>

// The first line anywhere in the plan declaring `prefix`, trimmed.
function plan_line(plan: string, prefix: string): string | undefined {
	return markdown_section
		.unfenced_lines(plan)
		.map((text) => text.trim())
		.find((text) => text.startsWith(prefix))
}

// The issue body's declaration of `prefix` under its background heading, as a line.
function issue_line(body: string, prefix: string): string | undefined {
	const value = size_estimate.declared(body, prefix)

	return value === undefined ? undefined : `${prefix} ${value}`
}

// A background section holding the estimate and the reason the judgment reads; a plan line that does
// not parse as an estimate leaves the issue body's in force.
function judged_body(plan: string, body: string): string {
	const estimate = size_estimate.stated_line(plan) ?? issue_line(body, SIZE_PREFIX)
	const reason = plan_line(plan, REASON_PREFIX) ?? issue_line(body, REASON_PREFIX)
	const lines = [estimate, reason].filter((line) => line !== undefined)

	return [BACKGROUND_HEADING, ...lines].join('\n')
}

async function issue_of(issue_number: string, repo?: string): Promise<Issue | undefined> {
	const json = await git_gh_command.issue_view_json(issue_number, ISSUE_FIELDS, repo)

	return json === undefined ? undefined : json_value.parse_with(json, issue_schema)
}

// The filing's refusal for the plan's estimate, or `undefined` within the guide, excused, with no
// estimate, or when the issue could not be read.
async function problem_of(
	issue_number: string,
	plan: string,
	repo?: string,
): Promise<string | undefined> {
	const issue = await issue_of(issue_number, repo)
	if (issue === undefined) return undefined
	const { implement_rate, growth } = await lane_net_read.measurements()
	const route = size_estimate.route_of(issue.labels.map((label) => label.name))

	return size_estimate.guide_problem(judged_body(plan, issue.body), route, implement_rate, growth)
}

// `issue:body` has no `--repo`, so another repository's body is rewritten from its own checkout.
function body_rewrite(issue_number: string, repo?: string): string {
	const command = `\`pnpm josh issue:body ${issue_number} --body-file -\``

	return repo === undefined ? command : `${command} in ${repo}'s checkout`
}

// The steps after a refusal: answer the split question, then split or declare why it stays one. A
// `--repo` plan's steps address that repository's issue.
function next_steps(issue_number: string, repo?: string): string {
	const target = issue_cite.plain_for('program', issue_number, repo)
	const rerun = repo === undefined ? '' : ` --repo ${repo}`

	return [
		`run:planned not applied to ${target} — answer question 1 of \`pnpm josh doc:section .claude/skills/workflow-commands/split-assessment.md "${split_assess.QUESTION_SECTION}"\`:`,
		`  separable → \`kickoff ${target}\`'s split path (\`--route split\` children under an epic)`,
		`  one deliverable → add \`${REASON_PREFIX} <理由>\` under ${BACKGROUND_HEADING} (${body_rewrite(issue_number, repo)}) and re-run \`issue:plan --planned${rerun}\``,
	].join('\n')
}

const plan_size_check = { problem_of, next_steps }

export { plan_size_check }
