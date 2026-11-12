import { fileURLToPath } from 'node:url'
import { pr_classification } from '#scripts/ci/pr-classification'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import {
	ENHANCEMENT_LABEL,
	OTHER_CHANGE_LABEL,
	type ReleaseClassification,
} from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'

// `josh issue:release-class <N> <label>` — the one release classification line `josh pr` reads, written
// into the Issue body, so a lane that cannot run `gh issue edit` need not park for it. A bug, breaking
// change or ignored release is declared by its label, not here.
const DECLARABLE: ReadonlyArray<ReleaseClassification> = [ENHANCEMENT_LABEL, OTHER_CHANGE_LABEL]
const USAGE = `Usage: josh issue:release-class <issue-number> <${DECLARABLE.join('|')}>`
const ARGUMENT_COUNT = 2
const FAILURE = 1
const ARGV_OFFSET = 2

interface ReleaseClassRequest {
	issue: string
	label: ReleaseClassification
}

function declarable_of(value: string): ReleaseClassification | undefined {
	return DECLARABLE.find((label) => label === value)
}

function request_from(positionals: ReadonlyArray<string>): ReleaseClassRequest {
	const [issue = '', value = ''] = positionals
	const label = declarable_of(value)

	if (label === undefined || !issue_number_shape.is_issue_number(issue)) throw new Error(USAGE)

	return { issue, label }
}

function request_of(argv: ReadonlyArray<string>): ReleaseClassRequest {
	const parsed = cli_flags.arguments_of(argv, {})

	if (parsed?.positionals.length !== ARGUMENT_COUNT) throw new Error(USAGE)

	return request_from(parsed.positionals)
}

async function apply(request: ReleaseClassRequest): Promise<void> {
	const body = await git_gh_command.issue_get_body(request.issue)

	if (body === undefined) throw new Error(`Could not read ${session_cite.issue(request.issue)}`)
	const updated = pr_classification.with_declaration(body, request.label)

	if (updated !== body) await git_gh_command.issue_edit_body(request.issue, updated)
	console.info(`Release classification declared: ${request.label}`)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		await apply(request_of(argv))

		return 0
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_release_class_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_release_class_cli }
