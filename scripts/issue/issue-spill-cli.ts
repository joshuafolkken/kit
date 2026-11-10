import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { epic_add } from '#scripts/epic/epic-add'
import { epic_index } from '#scripts/epic/epic-index'
import { epic_run } from '#scripts/epic/epic-run'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'
import { issue_cite } from './issue-cite'
import { issue_file_cli } from './issue-file-cli'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from './issue-labels'
import { issue_number_shape } from './issue-number-shape'
import { issue_spill, type SpillSubject } from './issue-spill'
import { session_cite } from './session-cite'

// `josh issue:spill <N> --estimate "<files> / <lines>"` — move #N's unchecked acceptance criteria into
// a follow-up Issue, place it after #N, and leave one link line in #N where they stood.
//
// **Every write is an existing command's function**: the filing is `issue:file --route split`'s
// `file_issue` (its scout, lint and labels included), the placement `epic --add`'s `add_children` or
// `epic`'s `create_epic_number`. #N is passed as `--distinct`: the follow-up quotes #N's criteria, so
// the scout would otherwise hold #N as its duplicate. Any other candidate the scout holds is declared
// separate by re-running with `--distinct <N,…>`.
//
// **#N is rewritten only once the follow-up exists**, and before the placement: a refused filing
// leaves #N untouched, and a failed placement leaves the two bodies consistent and prints the
// `epic --add` command that places the follow-up.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh issue:spill <issue-number> --estimate "<files> ファイル / <lines> 行" [--distinct <N,…>]…'
const OPTIONS = {
	estimate: { type: 'string' },
	distinct: { type: 'string', multiple: true },
} as const
const SUBJECT_FIELDS = 'title,body,labels'
// The same bound `epic:bundle` lists the open epics with.
const EPIC_LIMIT = 200
const COMPLETE_LISTING = 'none'
const TRIAGE_LABELS: ReadonlySet<string> = new Set([RUN_LANE_LABEL, RUN_SOLO_LABEL])

const label_schema = z.looseObject({ name: z.string() })
const subject_schema = z.looseObject({
	title: z.string(),
	body: z.string().nullish(),
	labels: z.array(label_schema).optional(),
})

interface SpillRequest {
	issue_number: number
	estimate: string
	// The `--distinct` values as given, passed on to `issue:file`, which parses and checks them.
	distinct: ReadonlyArray<string>
}

interface SpillIssue extends SpillSubject {
	labels: ReadonlyArray<string>
}

interface ParentEpic {
	epic: number | undefined
	is_complete: boolean
}

function issue_number_of(positionals: ReadonlyArray<string>): number | undefined {
	const [issue_number, ...rest] = positionals
	const is_one_number = rest.length === 0 && issue_number_shape.is_issue_number(issue_number ?? '')

	return is_one_number ? Number(issue_number) : undefined
}

function distinct_of(values: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
	return values ?? []
}

function parse_request(argv: ReadonlyArray<string>): SpillRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue_number = issue_number_of(parsed.positionals)
	const estimate = issue_spill.estimate_line(parsed.values.estimate ?? '')

	if (issue_number === undefined || estimate === undefined) return undefined

	return { issue_number, estimate, distinct: distinct_of(parsed.values.distinct) }
}

function parse_subject(json: string): z.infer<typeof subject_schema> | undefined {
	try {
		return parse_json_object_or_undefined(json, subject_schema)
	} catch {
		return undefined
	}
}

async function read_issue(issue_number: number): Promise<SpillIssue | undefined> {
	const read = await git_gh_command.issue_view_json_classified(String(issue_number), SUBJECT_FIELDS)
	const parsed = read.kind === 'read' ? parse_subject(read.json) : undefined

	if (parsed === undefined) return undefined

	return {
		issue_number,
		title: parsed.title,
		body: parsed.body ?? '',
		labels: (parsed.labels ?? []).map((label) => label.name),
	}
}

// #N's own triage label rides along: `issue:file` refuses an `auto-ok` filing without one. The
// caller's `--distinct` values follow #N's, so a filing held on another duplicate candidate is
// reissued with that candidate declared separate.
function filing_argv(
	issue: SpillIssue,
	request: SpillRequest,
	body_file: string,
): ReadonlyArray<string> {
	const triage = issue.labels.filter((label) => TRIAGE_LABELS.has(label))
	const labels = triage.flatMap((label) => ['--label', label])
	const distinct = [String(issue.issue_number), ...request.distinct].flatMap((value) => [
		'--distinct',
		value,
	])

	return [
		issue_spill.follow_up_title(issue),
		'--body-file',
		body_file,
		'--route',
		'split',
		...distinct,
		...labels,
	]
}

async function file_follow_up(
	issue: SpillIssue,
	request: SpillRequest,
): Promise<number | undefined> {
	const directory = await mkdtemp(path.join(tmpdir(), 'josh-issue-spill-'))
	const body_file = path.join(directory, 'body.md')

	try {
		await writeFile(body_file, issue_spill.follow_up_body(issue, request.estimate))

		const filed = github_issue_url.parse(
			await issue_file_cli.file_issue(filing_argv(issue, request, body_file)),
		)

		return filed === undefined ? undefined : Number(filed.issue_number)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

async function create_epic(issue: SpillIssue, follow_up: number): Promise<number> {
	const origin = issue_cite.plain_for('github', issue.issue_number)
	const epic_number = await epic_run.create_epic_number({
		title: `Split of ${origin}: ${issue.title}`,
		children: [issue.issue_number, follow_up],
		rationale: `${origin} の未チェックの受け入れ条件を ${issue_cite.plain_for('github', follow_up)} に切り出した。`,
		is_ordered: true,
	})

	return epic_number === undefined ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function add_after(epic: number, issue_number: number, follow_up: number): Promise<number> {
	const position = { kind: 'after', target: issue_number } as const

	return await epic_add.add_children({ epic_number: epic, children: [follow_up], position })
}

// An incomplete listing may hide #N's epic, and a second epic for it is the duplicate `epic:bundle`
// refuses to make, so a cut-short or failed listing creates nothing.
async function parent_epic(issue_number: number): Promise<ParentEpic> {
	const fetched = await epic_index.fetch_epics(EPIC_LIMIT)

	if (fetched === undefined) return { epic: undefined, is_complete: false }

	return {
		epic: epic_index.build_epic_index(fetched.epics).get(issue_number),
		is_complete: fetched.cutoff === COMPLETE_LISTING,
	}
}

async function placed(issue: SpillIssue, follow_up: number): Promise<number> {
	const { epic, is_complete } = await parent_epic(issue.issue_number)

	if (epic !== undefined) return await add_after(epic, issue.issue_number, follow_up)
	if (is_complete) return await create_epic(issue, follow_up)
	console.error('✖ the open epics could not be read in full.')

	return FAILURE_EXIT_CODE
}

// A re-run cannot place it — #N has no unchecked criteria left — so every failure names the command.
async function place(issue: SpillIssue, follow_up: number): Promise<number> {
	const exit_code = await placed(issue, follow_up)

	if (exit_code !== SUCCESS_EXIT_CODE) {
		console.error(
			`✖ ${session_cite.issue(follow_up)} was not placed — place it with \`pnpm josh epic --add <E> ${String(follow_up)} --after ${String(issue.issue_number)}\`.`,
		)
	}

	return exit_code
}

async function rewrite(issue: SpillIssue, follow_up: number): Promise<boolean> {
	try {
		await git_gh_command.issue_edit_body(
			String(issue.issue_number),
			issue_spill.kept_body(issue.body, follow_up),
		)

		return true
	} catch (error) {
		console.error(
			`✖ ${session_cite.issue(follow_up)} was filed, but ${session_cite.issue(issue.issue_number)}'s body was not rewritten: ${error_text.message_of(error)}`,
		)

		return false
	}
}

async function spill(issue: SpillIssue, request: SpillRequest): Promise<number> {
	const follow_up = await file_follow_up(issue, request)

	if (follow_up === undefined || !(await rewrite(issue, follow_up))) return FAILURE_EXIT_CODE
	console.info(
		`spill: ${session_cite.issue(issue.issue_number)} → ${session_cite.issue(follow_up)}`,
	)

	return await place(issue, follow_up)
}

// Zero unchecked criteria writes nothing: no follow-up, no placement, #N untouched.
async function spill_request(request: SpillRequest): Promise<number> {
	const issue = await read_issue(request.issue_number)
	const number = session_cite.issue(request.issue_number)

	if (issue === undefined) {
		console.error(`✖ ${number} could not be read.`)

		return FAILURE_EXIT_CODE
	}

	if (issue_spill.unchecked_lines(issue.body).length > 0) return await spill(issue, request)

	console.info(`${number} has no unchecked acceptance criteria — nothing spilled.`)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request !== undefined) return await spill_request(request)
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

const issue_spill_cli = {
	USAGE,
	run,
}

export { issue_spill_cli }
