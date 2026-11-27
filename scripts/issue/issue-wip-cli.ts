// `josh issue:wip <N> --wip <name>` (joshuafolkken/kit#9153): the Issue body's adopt-branch row rewritten to
// the commit `wip/<name>` names now, or added when the body has none — the one path that moves the row
// after filing, for work stacked on the wip branch or a wip history rewritten since. A running lane takes
// the new sha in at its next entry, which reads the body live. A branch naming no commit is refused; a
// rewritten history is written with a warning, since a lane that took the old commit in keeps it.

import { fileURLToPath } from 'node:url'
import { git_ancestor } from '#scripts/git/git-ancestor'
import { issue_body_adopt_branch } from '#scripts/issue/issue-body-adopt-branch'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { run_handoff_args } from '#scripts/run/handoff/run-handoff-args'
import { run_handoff_wip } from '#scripts/run/handoff/run-handoff-wip'

const USAGE = 'Usage: josh issue:wip <issue-number> --wip <name>'
const OPTIONS = { wip: { type: 'string' } } as const
const SUCCESS = 0
const FAILURE = 1
const ARGV_OFFSET = 2

interface WipRequest {
	issue: string
	branch: string
}

function request_of(argv: ReadonlyArray<string>): WipRequest {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) throw new Error(USAGE)

	const issue = issue_number_shape.single_of(parsed.positionals)
	const branch = run_handoff_args.wip_branch(parsed.values.wip)

	if (issue === undefined || branch === undefined) throw new Error(USAGE)

	return { issue, branch }
}

// A warning when the present row's commit is not built on by `sha` (a rewritten wip history): a lane that
// already took the old commit in keeps its changes, so a rewrite that dropped some does not undo them.
async function rewrite_warning(issue: string, sha: string): Promise<string | undefined> {
	const present = await issue_body_adopt_branch.read_issue(issue)

	if (present.kind !== 'row' || (await git_ancestor.is_ancestor(present.row.sha, sha))) {
		return undefined
	}

	return `⚠ ${present.row.sha} is not an ancestor of ${sha}: a lane that already took ${present.row.sha} in keeps its changes`
}

async function apply(request: WipRequest): Promise<number> {
	const { issue, branch } = request
	const sha = await run_handoff_wip.resolve_commit(branch)

	if (sha === undefined) throw new Error(`--wip: no branch ${branch} in this repository`)

	const warning = await rewrite_warning(issue, sha)

	if (warning !== undefined) console.warn(warning)

	const problem = await run_handoff_wip.rewrite_row(issue, { branch, sha })

	if (problem !== undefined) throw new Error(problem)

	console.info(`${issue_cite.plain_for('terminal', issue)} adopts ${branch} @ ${sha}`)

	return SUCCESS
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await apply(request_of(argv))
	} catch (error: unknown) {
		console.error(error_text.message_of(error))

		return FAILURE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_wip_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_wip_cli }
