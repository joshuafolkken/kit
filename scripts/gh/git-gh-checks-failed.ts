import { git_branch } from '#scripts/git/git-branch'
import { z } from 'zod'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { read_pull, require_pr_number } from './git-gh-pr-read'
import { git_gh_pr_rollup } from './git-gh-pr-rollup'

// `josh checks:failed`: every failing check on a commit, required or not, read over REST — the check
// runs and the commit statuses, the two halves `gh pr checks` merged before a cloud session refused it
// with 403. The merge gate reads only the required checks; this answers "what is red", which is the
// first thing a red pull request's diagnosis needs.

const FAILED_CONCLUSIONS = new Set([
	'failure',
	'timed_out',
	'cancelled',
	'action_required',
	'startup_failure',
])
const FAILED_STATES = new Set(['failure', 'error'])

// A bare number is a pull request only below a short sha's 7 characters, so an all-digit sha is still
// read as a commit; `#N` names a pull request at any length.
const PR_NUMBER_PATTERN = /^(?:#\d+|\d{1,6})$/u
const SHA_PATTERN = /^[\da-f]{7,40}$/iu
const NO_URL = '(no URL)'
const NO_HEAD_SHA_MESSAGE = 'gh api answered a pull request with no head commit'

const check_run_schema = z.looseObject({
	name: z.string(),
	conclusion: z.string(),
	details_url: z.string().nullish(),
	html_url: z.string().nullish(),
})

// A commit status carries `context` and `state`, which no check run has, so the two shapes cannot
// mistake one for the other.
const status_schema = z.looseObject({
	context: z.string(),
	state: z.string(),
	target_url: z.string().nullish(),
})

interface FailedCheck {
	name: string
	conclusion: string
	url: string
}

interface FailedChecks {
	sha: string
	failed: Array<FailedCheck>
}

async function head_sha_of(pr_number: number): Promise<string> {
	const pull = await read_pull(pr_number)
	const sha = pull.head?.sha
	if (sha === undefined) throw new Error(NO_HEAD_SHA_MESSAGE)

	return sha
}

async function current_pr_number(): Promise<number> {
	return await require_pr_number(await git_branch.current())
}

// No target → the current branch's pull request; `#N` or a number of up to 6 digits → that pull
// request's head; a 7-to-40-character hex string → the commit itself.
async function resolve_sha(target: string | undefined): Promise<string> {
	if (target === undefined) return await head_sha_of(await current_pr_number())

	if (PR_NUMBER_PATTERN.test(target)) return await head_sha_of(Number(target.replace('#', '')))
	if (SHA_PATTERN.test(target)) return target

	throw new Error(`checks:failed: not a pull request number or commit sha: ${target}`)
}

async function read_pages(path: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: `${path}${FULL_PAGE_QUERY}`,
		should_paginate: true,
		should_slurp: true,
	})
}

function failed_status(element: unknown): FailedCheck | undefined {
	const parsed = status_schema.safeParse(element)
	if (!parsed.success || !FAILED_STATES.has(parsed.data.state)) return undefined

	const { context, state, target_url } = parsed.data

	return { name: context, conclusion: state, url: target_url ?? NO_URL }
}

// A run still in progress has a `null` conclusion, which the schema refuses, and `success` /
// `skipped` / `neutral` are not failures.
function failed_check_run(element: unknown): FailedCheck | undefined {
	const parsed = check_run_schema.safeParse(element)
	if (!parsed.success || !FAILED_CONCLUSIONS.has(parsed.data.conclusion)) return undefined

	const { name, conclusion, details_url, html_url } = parsed.data

	return { name, conclusion, url: details_url ?? html_url ?? NO_URL }
}

function to_failed_check(element: unknown): FailedCheck | undefined {
	return failed_status(element) ?? failed_check_run(element)
}

// The rollup keeps only the newest run of each check name, so a check re-run green is not listed.
async function list_failed_checks(target?: string): Promise<FailedChecks> {
	const sha = await resolve_sha(target)
	const [check_runs_json, status_json] = await Promise.all([
		read_pages(git_gh_api_path.commit_check_runs_api_path(sha)),
		read_pages(git_gh_api_path.commit_status_api_path(sha)),
	])
	const rollup = git_gh_pr_rollup.to_status_check_rollup({ check_runs_json, status_json })
	const failed = rollup.map((element) => to_failed_check(element))

	return { sha, failed: failed.filter((check) => check !== undefined) }
}

function format_failed_checks({ sha, failed }: FailedChecks): string {
	if (failed.length === 0) return `No failing checks on ${sha}.`

	const lines = failed.map(({ name, conclusion, url }) => `- ${name} — ${conclusion} — ${url}`)

	return [`${String(failed.length)} failing check(s) on ${sha}:`, ...lines].join('\n')
}

async function report(target?: string): Promise<string> {
	return format_failed_checks(await list_failed_checks(target))
}

const git_gh_checks_failed = {
	list_failed_checks,
	report,
}

export type { FailedCheck, FailedChecks }
export { git_gh_checks_failed }
