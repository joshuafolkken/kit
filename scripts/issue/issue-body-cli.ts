import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_lint_cli } from '#scripts/issue/issue-lint-cli'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { size_estimate } from '#scripts/issue/size-estimate'
import { cli_body } from '#scripts/josh/cli-body'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'

// `josh issue:body <N> --body-file <path>` — replace an existing Issue body with a file's, once it
// passes `issue:lint`. `issue:plan` writes only a blank body, and a consultation session's hook refuses
// every non-GET `gh api`, so a body rewrite had no route a session could run (joshuafolkken/kit#7002).
// An epic body (`## Split rationale`) is not an issue-template body, so `issue:lint` does not judge it;
// `epic:check` does.
const BODY_FILE_FLAG = '--body-file'
const USAGE = `Usage: josh issue:body <issue-number> ${BODY_FILE_FLAG} <path>`
const OPTIONS = { 'body-file': { type: 'string' } } as const
const SUCCESS = 0
const FAILURE = 1
const ARGV_OFFSET = 2

interface BodyRequest {
	issue: string
	body_path: string
}

function request_of(argv: ReadonlyArray<string>): BodyRequest {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) throw new Error(USAGE)
	const issue = issue_number_shape.single_of(parsed.positionals)
	const body_path = parsed.values['body-file']

	if (issue === undefined || body_path === undefined || body_path.length === 0) {
		throw new Error(USAGE)
	}

	return { issue, body_path }
}

async function apply(request: BodyRequest): Promise<number> {
	const body = cli_body.read_file_or_stdin(request.body_path)
	const problems = size_estimate.is_epic(body) ? [] : issue_lint_cli.problems(body)

	if (problems.length > 0) {
		console.error(problems.map((problem) => `✖ ${problem}`).join('\n'))

		return FAILURE
	}

	console.info(await git_gh_command.issue_edit_body(request.issue, body))

	return SUCCESS
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await apply(request_of(argv))
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_body_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_body_cli }
