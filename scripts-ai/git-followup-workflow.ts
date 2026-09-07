#!/usr/bin/env tsx
import { parseArgs } from 'node:util'
import { git_branch } from '../scripts/git/git-branch'
import { git_error } from '../scripts/git/git-error'
import { git_followup_pending } from '../scripts/git/git-followup-pending'
import { git_next_issues } from '../scripts/git/git-next-issues'
import { git_notify, type GitNotifyConfig } from '../scripts/git/git-notify'
import { git_pr_followup } from '../scripts/git/git-pr-followup'
import { review_attest } from '../scripts/review/review-attest'
import { review_stamps } from '../scripts/review/review-stamps'
import { run_hold } from '../scripts/run/run-hold'
import { time_history } from '../scripts/time/time-history'
import { load_optional_environment } from './environment-loader'

load_optional_environment()

// cspell:words coderabbit

/* eslint-disable @typescript-eslint/naming-convention */
interface CliArguments {
	values: {
		branch?: string
		'issue-number'?: string
		'notify-target'?: string
		'notify-message'?: string
		'notify-mentions'?: string
		'coderabbit-ignore-reason'?: string
		'ai-review-ignore-reason'?: string
		'skip-watch'?: boolean
		'no-merge'?: boolean
		merge?: boolean
		help?: boolean
	}
	positionals: Array<string>
}
/* eslint-enable @typescript-eslint/naming-convention */

function display_help(): void {
	console.info(`
🚦 PR Followup Workflow

Usage:
  jf-git-followup [issue] [options]

Options:
  --branch                     Target branch name (default: current branch)
  --issue-number               Issue number for completion messages
  --notify-target              pr | issue | both
  --notify-message             Completion message header
  --notify-mentions            Comma-separated mentions (user,org/team)
  --coderabbit-ignore-reason   Reason text when keeping CodeRabbit findings unresolved
  --ai-review-ignore-reason    Reason text when keeping AI reviewer (Claude Review / CodeRabbit
                               summary) findings unresolved
  --skip-watch                 Skip the two-minute check look-ahead and only evaluate latest status
  --no-merge                   Skip merging the PR (merge is on by default)
  --merge                      (Deprecated — merge is now the default; kept for backward compatibility)
  -h, --help                   Show this help
	`)
}

function parse_cli_arguments(): CliArguments {
	return parseArgs({
		options: {
			branch: { type: 'string' },
			'issue-number': { type: 'string' },
			'notify-target': { type: 'string' },
			'notify-message': { type: 'string' },
			'notify-mentions': { type: 'string' },
			'coderabbit-ignore-reason': { type: 'string' },
			'ai-review-ignore-reason': { type: 'string' },
			'skip-watch': { type: 'boolean' },
			'no-merge': { type: 'boolean' },
			merge: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' },
		},
		allowPositionals: true,
	})
}

function parse_issue_number_from_text(input: string | undefined): string | undefined {
	if (input === undefined) return undefined
	const trimmed = input.trim()
	const direct_match = /^#?(\d+)$/u.exec(trimmed)
	if (direct_match?.[1] !== undefined) return direct_match[1]
	const title_match = /#(\d+)$/u.exec(trimmed)

	return title_match?.[1]
}

async function resolve_branch_name(raw_branch: string | undefined): Promise<string> {
	if (raw_branch !== undefined && raw_branch.trim().length > 0) return raw_branch.trim()

	return await git_branch.current()
}

function build_notify_config(values: CliArguments['values']): GitNotifyConfig | undefined {
	return git_notify.build_notify_config({
		raw_target: values['notify-target'] ?? 'issue',
		raw_message: values['notify-message'],
		raw_mentions: values['notify-mentions'],
	})
}

function is_merge_resolved(values: CliArguments['values']): boolean {
	return values['no-merge'] !== true
}

// **The count of unreleased merges, not the project version** (joshuafolkken/kit#1486). This line
// used to read the local `package.json` and was read as "the version this run just shipped"; children
// no longer bump, so that number names the *previous* release and the reading is false. The count is
// the one `pnpm josh release` acts on, and it is printed here for the same reason it goes into the
// Telegram: a number that keeps climbing is a release nobody has run.
//
// Printed after the merge, and the count is read from a freshly fetched default branch — so this
// run's own merge is already in it and nothing here says otherwise, unlike the Telegram sent one step
// earlier from a tree the merge had not reached.
async function print_pending_release(): Promise<void> {
	const line = await git_followup_pending.pending_release_line({ is_merge_pending: false })

	if (line !== undefined) console.info(line)
}

// One parser for both consumers: `--issue-number` is a free-form string, and `Number('42a')` is
// NaN — which compares unequal to every issue number and would silently disable the
// just-completed-issue exclusion. `parse_issue_number_from_text` already accepts every shape the
// positional does (`42`, `#42`, a title ending in `#42`) and guarantees digits-only output, so
// reusing it keeps the two paths from disagreeing about what "the completed issue" is.
function parse_completed_issue_number(raw: string | undefined): number | undefined {
	const digits = parse_issue_number_from_text(raw)

	return digits === undefined ? undefined : Number(digits)
}

// #821: surface what to run next right where the completion is read. Printed before the project
// version line, which stays the final line of the console output by contract.
async function print_next_issues(completed_issue_number: string | undefined): Promise<void> {
	const lines = await git_next_issues.fetch_next_issue_lines(
		parse_completed_issue_number(completed_issue_number),
	)
	for (const line of lines) console.info(line)
}

// The tail printed once the workflow itself has finished. `print_pending_release` stays last by
// contract, so anything added here goes above it.
async function print_completion(
	issue_number: string | undefined,
	should_merge: boolean,
): Promise<void> {
	console.info('')
	console.info('✅ PR followup completed.')
	// Merged runs only, like the epic auto-close: on `--no-merge` the linked issue is still open
	// and still the current task, so a "next" list would hide the one issue that matters.
	if (should_merge) await print_next_issues(issue_number)
	await print_pending_release()
}

// A **merged** run ends here, and the round-1 review snapshot's lifetime is one run
// (joshuafolkken/kit#1441). `--no-merge` is not the end of one — the pull request is still open and
// the issue is still the current task, the same line `print_next_issues` and the epic auto-close
// already draw — and clearing there would be the unsafe direction: the next round-1 brief would find
// no record and write a fresh one against the already-fixed tree, which is the arm-A skip over
// unreviewed fix code the record exists to prevent.
//
// A named function rather than one line inside `main`, so the gate itself is testable: `main` runs at
// import time in this module, so a suite reaching the clear through it would be removing the record of
// whatever run is in flight around it (the trap joshuafolkken/kit#1437 fixed for the gate's own
// records).
function clear_round_one_snapshot(should_merge: boolean): void {
	if (should_merge) review_stamps.clear_round_one()
}

// joshuafolkken/kit#1522: `/code-review` is forked by the harness and inherits the *session's*
// working directory, so a run implementing in a lane can be reviewed against a different tree
// entirely — one holding the previous child's already-merged code. That review finds nothing wrong
// and says so, and the run reads the silence as a clean round. **This is the seam where that stops
// being free**: a merge is refused unless the review attested the checkout it was briefed on.
//
// **Absence is a refusal, not a pass.** The defect produced *no* signal, so a check that only
// compared two present records would answer `ok` in exactly the state it exists to catch.
//
// **Scoped to a checkout that actually briefed a review.** `review_attest.check` answers
// `not-required` where no `josh review:brief` was run here inside a run's lifetime, so a project or
// a flow that does not use the brief merges exactly as it did before.
//
// The direction is deliberate: a wrongly-refused merge costs one re-run of the review, and a wrongly
// allowed one ships a diff nobody read. Thrown rather than reported, so no `completion` Telegram is
// sent and nothing merges — `git_pr_followup.run` is never reached.
async function assert_review_attested(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	const verdict = await review_attest.check_here()

	if (verdict.status === 'ok' || verdict.status === 'not-required') return

	throw new Error(review_attest.refusal_message(verdict))
}

// Cleared beside the round-1 snapshot, and for the same reason: the contract's lifetime is one run,
// and a record left behind is the one the next run's check would read.
async function clear_review_target(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	try {
		await review_attest.clear_here()
	} catch {
		/* a fresh `josh review:brief` replaces the record the next run reads */
	}
}

// joshuafolkken/kit#1471: the run report only ever appeared when a person typed `diag`, so a run
// nobody asked about left no record — and a measurement that is not continuous cannot say whether
// the last change made anything faster. Every `fullrun`, and every child of an `epicrun` or a
// `queue`, ends here, so emitting it from this one seam covers all of them without a second hook.
//
// **Gated on `should_merge`, like the epic auto-close and the round-1 snapshot clear above.** A
// `--no-merge` run has not finished: the pull request is still open and its CI wait is not over, so
// a record written there would compare a part of a run against whole ones.
//
// **Printed above `print_completion`**, because `print_pending_release` stays the final line of the
// console output by contract.
async function record_run_report(
	issue_number: string | undefined,
	should_merge: boolean,
): Promise<void> {
	if (!should_merge) return

	const completed = parse_completed_issue_number(issue_number)
	if (completed === undefined) return

	const lines = await time_history.record_run(completed, process.cwd())
	for (const line of lines) console.info(line)
}

// joshuafolkken/kit#1091: the working-tree hold a typed entry point claims before it starts is
// released here, on the one seam every `fullrun` — and every child of an `epicrun` or a `queue` —
// passes through, so a finished run never leaves the next one locked out. **Gated on `should_merge`
// like the epic auto-close and the round-1 snapshot clear**: a `--no-merge` run has not finished, and
// its tree is still the one nobody else may start in.
//
// It swallows its own failure for the same reason the gate's in-flight marker does: the record must
// never decide whether a merged run reports success. A record that survives anyway expires on its own
// eight hours later, which is what covers an abnormally ended run.
async function release_worktree_hold(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	try {
		const directory = await run_hold.worktree_directory()

		if (directory !== undefined) run_hold.release_hold(run_hold.hold_path(directory))
	} catch {
		/* the record expires on its own, and `pnpm josh run:release` clears it early */
	}
}

// The tail every invocation shares, in one function so `main` stays inside its statement budget: the
// run report, the console completion, and the two records only a merged run releases. The order is
// the contract — `print_completion` ends with the unreleased-merge count, the final console line.
async function finish(issue_number: string | undefined, should_merge: boolean): Promise<void> {
	await record_run_report(issue_number, should_merge)
	await print_completion(issue_number, should_merge)
	clear_round_one_snapshot(should_merge)
	await clear_review_target(should_merge)
	await release_worktree_hold(should_merge)
}

async function main(): Promise<void> {
	const cli = parse_cli_arguments()

	if (cli.values.help === true) {
		display_help()

		return
	}

	const issue_number =
		cli.values['issue-number'] ?? parse_issue_number_from_text(cli.positionals[0] ?? undefined)
	const should_merge = is_merge_resolved(cli.values)

	await assert_review_attested(should_merge)
	await git_pr_followup.run({
		branch_name: await resolve_branch_name(cli.values.branch),
		issue_number,
		notify_config: build_notify_config(cli.values),
		coderabbit_ignore_reason: cli.values['coderabbit-ignore-reason'],
		ai_review_ignore_reason: cli.values['ai-review-ignore-reason'],
		is_skip_watch: cli.values['skip-watch'] === true,
		should_merge,
	})
	await finish(issue_number, should_merge)
}

try {
	await main()
	console.info('')
} catch (error) {
	git_error.handle(error)
}

const git_followup_workflow = {
	assert_review_attested,
	clear_review_target,
	clear_round_one_snapshot,
	release_worktree_hold,
	record_run_report,
	parse_issue_number_from_text,
	resolve_branch_name,
	is_merge_resolved,
	print_pending_release,
	print_next_issues,
	print_completion,
}

export { git_followup_workflow }
