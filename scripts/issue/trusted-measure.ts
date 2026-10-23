import { execSync } from 'node:child_process'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'
import { session_cite } from './session-cite'

// Running a command an Issue body names — `josh measure:rerun`'s baselines and the drive's measurement
// declaration (`measure-declaration.ts`) alike.
//
// **The command is shell, and the body is written by whoever filed the Issue**.
// A baseline needs pipes and loops (`git log … | wc -l`, `for d in $(ls …)`), so an allow-list of
// commands cannot make it safe; what can is who wrote it. The input is therefore the Issue number, not
// a file, so the author's `author_association` arrives with the body from the same REST read, and only
// a body written by someone with write access to the repository is run.

const ISSUE_FIELDS = 'body,author_association,user'
const UNKNOWN_ASSOCIATION = 'unknown'
// One command's budget — the same minute `josh-harness.ts` gives one command it spawns. A measurement
// is a count or a digest that answers in seconds, so a command still running after a minute is stuck,
// and without a bound it would hold the whole re-measurement open with nothing printed.
const MEASURE_TIMEOUT_MS = 60_000
const issue_schema = z.object({
	body: z.string().nullish(),
	author_association: z.string().nullish(),
	user: z.looseObject({ login: z.string() }).nullish(),
})

type IssueFields = z.infer<typeof issue_schema>
type BodyRead = { kind: 'trusted'; body: string } | { kind: 'refused'; reason: string }
type CommandRun = { kind: 'ok'; output: string } | { kind: 'failed'; message: string }

// The command's stdout, trimmed, or the message a failing or timed-out command threw.
function run_command(command: string): CommandRun {
	try {
		return {
			kind: 'ok',
			output: execSync(command, { encoding: 'utf8', timeout: MEASURE_TIMEOUT_MS }).trim(),
		}
	} catch (error) {
		return { kind: 'failed', message: error_text.message_of(error) }
	}
}

// The run as one printable value: a failure is spelled in place of the output.
function text_of(run: CommandRun): string {
	return run.kind === 'ok' ? run.output : `(command failed: ${run.message})`
}

async function read_issue(issue_number: string): Promise<IssueFields | undefined> {
	const json = await git_gh_issue_read.issue_view_json(issue_number, ISSUE_FIELDS)

	return json === undefined ? undefined : parse_json_object_or_undefined(json, issue_schema)
}

function untrusted(issue_number: string, issue: IssueFields): BodyRead {
	const association = issue.author_association ?? UNKNOWN_ASSOCIATION

	return {
		kind: 'refused',
		reason: `refusing to run the baseline of ${session_cite.issue(issue_number)}: its author (${association}) is not ${gh_author_association.TRUSTED_LIST}`,
	}
}

// The body, only when its author can write to the repository. A read that fails is refused as well:
// an unknown author is not a trusted one.
async function read_trusted_body(issue_number: string): Promise<BodyRead> {
	const issue = await read_issue(issue_number)

	if (issue === undefined) {
		return { kind: 'refused', reason: `could not read issue ${session_cite.issue(issue_number)}` }
	}

	const author = { login: issue.user?.login, association: issue.author_association }

	if (!(await gh_author_association.is_trusted(author))) return untrusted(issue_number, issue)

	return { kind: 'trusted', body: issue.body ?? '' }
}

const trusted_measure = { read_trusted_body, run_command, text_of }

export type { BodyRead, CommandRun }
export { trusted_measure }
