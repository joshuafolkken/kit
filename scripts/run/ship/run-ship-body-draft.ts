import { access, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { live_evidence } from '#scripts/review/live-evidence'
import type { ShipArguments } from './run-ship-steps'

// **The pull-request body a run fills in before `josh ship`, written where ship reads it.** The
// acceptance-map and live-evidence refusals stopped about one ship per merge: their rows were printed
// at `run:prep`, long before the ship, and the lane child's ship carried no `--body-file` at all
// (joshuafolkken/kit#4168). The rows now land in a file in the work tree's own git directory — outside
// the tree, so no check sees it as a change — and `josh ship` reads it when `--body-file` is omitted,
// handing it to the preflight, `git -y` and a detached supervisor alike (`with_draft`).
// Nothing is satisfied for the run: each row still carries its pending ending and the evidence section is empty, so
// the same refusals stand until the run writes them.

// The PR body carrying the live-execution evidence `followup` gates the merge
// on, forwarded to `git -y` as a path because it holds commands and their output.
const BODY_FILE_OPTION = 'body-file' as const
const DRAFT_PREFIX = 'josh-ship-body-'
const DRAFT_SUFFIX = '.md'
const EXISTS_CODE = 'EEXIST'
const NO_GIT_DIRECTORY = 'no git directory to hold the ship body draft'

async function path_of(issue_number: string): Promise<string> {
	const [git_directory] = await git_command.git_directories()

	if (git_directory === undefined) throw new Error(NO_GIT_DIRECTORY)

	return path.join(git_directory, `${DRAFT_PREFIX}${issue_number}${DRAFT_SUFFIX}`)
}

function is_exists_error(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === EXISTS_CODE
}

function draft_text(acceptance_rows: string): string {
	return `${acceptance_rows}\n\n${live_evidence.EVIDENCE_HEADING}\n`
}

// Written once: a draft the run has already filled in is never replaced by pending rows.
async function prepare(issue_number: string, acceptance_rows: string): Promise<string> {
	const target = await path_of(issue_number)

	try {
		await writeFile(target, draft_text(acceptance_rows), { flag: 'wx' })
	} catch (error) {
		if (!is_exists_error(error)) throw error
	}

	return target
}

async function existing(issue_number: string): Promise<string | undefined> {
	const target = await path_of(issue_number)

	try {
		await access(target)

		return target
	} catch {
		return undefined
	}
}

// Removed once the pull request merged: keyed by issue number alone, a draft left in a git directory
// no lane close prunes (the main checkout's `.git`) would hand a reopened issue's ship the old body.
async function remove(issue_number: string): Promise<void> {
	await rm(await path_of(issue_number), { force: true })
}

function body_arguments(body_path: string | undefined): ReadonlyArray<string> {
	return body_path === undefined ? [] : [`--${BODY_FILE_OPTION}`, body_path]
}

// The ship's `--body-file`, or the draft when it was omitted and one exists.
async function with_draft(args: ShipArguments): Promise<ShipArguments> {
	if (args.body_path !== undefined) return args
	const draft = await existing(args.number)

	return draft === undefined ? args : { ...args, body: body_arguments(draft), body_path: draft }
}

const run_ship_body_draft = {
	BODY_FILE_OPTION,
	body_arguments,
	existing,
	path_of,
	prepare,
	remove,
	with_draft,
}

export { run_ship_body_draft }
