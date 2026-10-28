import { readFile } from 'node:fs/promises'
import { aggregation_split } from './aggregation-split'
import { behavior_change_lint } from './behavior-change-lint'
import { expected_effect_lint } from './expected-effect-lint'
import { issue_classification } from './issue-classification'
import { issue_lint } from './issue-lint'
import { issue_not_before } from './issue-not-before'
import { issue_priority } from './issue-priority'
import { issue_template_section } from './issue-template-section'
import { measure_declaration } from './measure-declaration'
import { size_estimate } from './size-estimate'

// `josh issue:lint <path>` — read an Issue body from a file and print `ok`, or every template problem
// one per line, exiting non-zero. It reads a path rather than stdin so it can
// lint a body written to a file before the `gh api … issues` call that files it. A body that declares
// itself a behavior-change Issue is additionally held to the firing-point, baseline and reproduction
// rules, and one that declares a run-time-shortening aim to the expected-effect estimate. Every
// non-epic body declares its size estimate; the guide it is judged against is `issue:file`'s check.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OK_MESSAGE = 'ok'
const NO_LABELS = 'none'
const USAGE = 'Usage: josh issue:lint <path-to-issue-body>'

const MISSING_HEADING_PREFIX = 'missing heading: '

// A missing-heading problem followed by that section of the template, so the filer pastes it in rather
// than reopening `issue-template.md`; any other problem, or a heading the template lacks, is unchanged.
function with_template(problem: string): string {
	if (!problem.startsWith(MISSING_HEADING_PREFIX)) return problem
	const template = issue_template_section.section(problem.slice(MISSING_HEADING_PREFIX.length))

	return template === undefined ? problem : `${problem}\n${template}`
}

// Every problem a body has: the four base template headings it lacks, then the behavior-change and
// expected-effect problems (each empty for an Issue that does not declare itself one).
function problems(body: string): ReadonlyArray<string> {
	const missing = issue_lint
		.missing_headings(body)
		.map((heading) => `${MISSING_HEADING_PREFIX}${heading}`)

	return [
		...missing,
		...behavior_change_lint.problems(body),
		...expected_effect_lint.problems(body),
		...issue_classification.problems(body),
		...issue_not_before.problems(body),
		...measure_declaration.problems(body),
		...size_estimate.problems(body),
		...aggregation_split.problems(body),
		issue_priority.order_problem(body),
	]
		.filter((problem) => problem !== undefined)
		.map((problem) => with_template(problem))
}

function report(found: ReadonlyArray<string>, body: string): number {
	if (found.length === 0) {
		console.info(OK_MESSAGE)
		console.info(`labels: ${issue_classification.required_labels(body).join(', ') || NO_LABELS}`)

		return SUCCESS_EXIT_CODE
	}

	console.error(found.map((problem) => `✖ ${problem}`).join('\n'))

	return FAILURE_EXIT_CODE
}

async function run(body_path: string | undefined): Promise<number> {
	if (body_path === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const body = await readFile(body_path, 'utf8')

	return report(problems(body), body)
}

const issue_lint_cli = { problems, run }

export { issue_lint_cli }
