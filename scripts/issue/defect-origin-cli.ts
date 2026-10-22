import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { IssueRead } from '#scripts/gh/git-gh-issue-read'
import { git_spawn } from '#scripts/git/git-spawn'
import { parse_json } from '#scripts/git/parse-json-array'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_prep_locate } from '#scripts/run/run-prep-locate'
import { z } from 'zod'
import { defect_origin, type Candidate, type Merge, type TargetMerges } from './defect-origin'
import { issue_read_cli } from './issue-read-cli'
import { session_cite } from './session-cite'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: pnpm josh defect:origin <N>'
const UNREADABLE_MESSAGE = 'Could not read the issue, so no origin candidate is listed:'
const UNSEARCHABLE_MESSAGE = 'Could not search the merge history for'

const filed_schema = z.object({ createdAt: z.string() })

interface IssueText {
	text: string
	filed_at: string | undefined
}

// A target that git cannot search is named on stderr and contributes nothing, rather than ending the
// listing or passing for a target no merge touched.
async function read_merges(
	target: string,
	arguments_: Array<string>,
): Promise<ReadonlyArray<Merge>> {
	try {
		return defect_origin.parse_merges(await git_spawn.read(arguments_))
	} catch {
		console.error(`${UNSEARCHABLE_MESSAGE} ${target}`)

		return []
	}
}

// A path is looked up by pathspec; a name no path matches, by the merges that added or removed it.
async function merges_for(target: string, before: string | undefined): Promise<TargetMerges> {
	const by_path = await read_merges(target, defect_origin.path_arguments(target, before))
	const merges =
		by_path.length > 0
			? by_path
			: await read_merges(target, defect_origin.pickaxe_arguments(target, before))

	return { target, merges }
}

async function candidates_for(issue: IssueText): Promise<ReadonlyArray<Candidate>> {
	const targets = run_prep_locate.extract_targets(issue.text)
	const found = await Promise.all(
		targets.map(async (target) => await merges_for(target, issue.filed_at)),
	)

	return defect_origin.rank(found)
}

async function listing(issue_number: string, issue: IssueText): Promise<string> {
	return defect_origin.format(issue_number, await candidates_for(issue))
}

// An unreadable filing time leaves the log unbounded rather than listing nothing.
function filed_at_of(read: IssueRead): string | undefined {
	if (read.kind !== 'read') return undefined

	return parse_json.parse_json_object_or_undefined(read.json, filed_schema)?.createdAt
}

// The body and trusted comments as `issue:read` prints them, and when the issue was filed; the
// failure kind when the issue could not be read.
async function read_issue(issue_number: string): Promise<IssueText | string> {
	const [read, filed] = await Promise.all([
		issue_read_cli.read_block(issue_number),
		git_gh_command.issue_view_json_classified(issue_number, 'createdAt'),
	])

	return read.kind === 'ok' ? { text: read.block, filed_at: filed_at_of(filed) } : read.kind
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [issue_number = ''] = argv

	if (argv.length !== 1 || !issue_number_shape.is_issue_number(issue_number)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const issue = await read_issue(issue_number)

	if (typeof issue === 'string') {
		console.error(`${UNREADABLE_MESSAGE} ${issue}`)

		return FAILURE_EXIT_CODE
	}

	console.info(session_cite.text(await listing(issue_number, issue)))

	return SUCCESS_EXIT_CODE
}

const defect_origin_cli = { USAGE, run }

export { defect_origin_cli }
