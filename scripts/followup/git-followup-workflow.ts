#!/usr/bin/env tsx
import { parseArgs } from 'node:util'
import { git_branch } from '#scripts/git/git-branch'
import { git_error } from '#scripts/git/git-error'
import { cli_body } from '#scripts/josh/cli-body'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { lane_size_record } from '#scripts/lane/lane-size-record'
import { git_notify, type GitNotifyConfig } from '#scripts/notify/git-notify'
import { acceptance_map_check } from '#scripts/review/acceptance-map-check'
import { live_evidence } from '#scripts/review/live-evidence'
import { removed_tests_check } from '#scripts/review/removed-tests-check'
import { parse_issue_number_from_text } from './followup-issue-number'
import { followup_review_gates } from './followup-review-gates'
import { followup_section } from './followup-section'
import { git_followup_finish } from './git-followup-finish'
import { git_followup_flush } from './git-followup-flush'
import { git_followup_merged, type MergePlan } from './git-followup-merged'
import { git_pr_followup } from './git-pr-followup'

josh_environment_file.load_environment_file()

// cspell:words coderabbit

/* eslint-disable @typescript-eslint/naming-convention */
interface CliArguments {
	values: {
		branch?: string
		'issue-number'?: string
		'notify-target'?: string
		'notify-message'?: string
		'notify-message-file'?: string
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

// The text is a constant rather than an inline literal: it is one option per supported flag, so it
// grows with the command and would otherwise push `display_help` past the function line limit every
// time a flag is added — a limit that exists to catch functions doing several things, which this one
// never was.
const HELP_TEXT = `
🚦 PR Followup Workflow

Usage:
  jf-git-followup [issue] [options]

Options:
  --branch                     Target branch name (default: current branch)
  --issue-number               Issue number for completion messages
  --notify-target              pr | issue | both
  --notify-message             Completion message header
  --notify-message-file        Read the completion message from a file (\`-\` reads stdin). Use this
                               whenever the message carries a backtick or a \`$\` — inside shell
                               double quotes the shell evaluates them before this command runs
  --notify-mentions            Comma-separated mentions (user,org/team)
  --coderabbit-ignore-reason   Reason text when keeping CodeRabbit findings unresolved
  --ai-review-ignore-reason    Reason text when keeping AI reviewer (Claude Review / CodeRabbit
                               summary) findings unresolved
  --skip-watch                 Skip the two-minute check look-ahead and only evaluate latest status
  --no-merge                   Skip merging the PR (merge is on by default)
  --merge                      (Deprecated — merge is now the default; kept for backward compatibility)
  -h, --help                   Show this help
`

function display_help(): void {
	console.info(HELP_TEXT)
}

function parse_cli_arguments(): CliArguments {
	return parseArgs({
		options: {
			branch: { type: 'string' },
			'issue-number': { type: 'string' },
			'notify-target': { type: 'string' },
			'notify-message': { type: 'string' },
			'notify-message-file': { type: 'string' },
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

async function resolve_branch_name(raw_branch: string | undefined): Promise<string> {
	if (raw_branch !== undefined && raw_branch.trim().length > 0) return raw_branch.trim()

	return await git_branch.current()
}

// The message is resolved here rather than inside `git_notify`, so the file form reaches the config
// as text and the config keeps one `message` field. `--notify-message-file` exists because the inline
// form is a double-quoted shell argument: a backtick or a `$` in the body is evaluated before this
// process starts — a Telegram body can silently lose a word, and a comment body's text can run as
// git commands.
function build_notify_config(values: CliArguments['values']): GitNotifyConfig | undefined {
	return git_notify.build_notify_config({
		raw_target: values['notify-target'] ?? 'issue',
		raw_message: cli_body.resolve({
			inline: values['notify-message'],
			file_path: values['notify-message-file'],
			inline_flag: '--notify-message',
			file_flag: '--notify-message-file',
		}),
		raw_mentions: values['notify-mentions'],
	})
}

function is_merge_resolved(values: CliArguments['values']): boolean {
	return values['no-merge'] !== true
}

const { assert_review_attested, assert_review_recorded, is_valid_issue } = followup_review_gates

// A runtime change merges only with its acceptance criteria run for real and
// recorded in the pull request body — `live_evidence` carries the why. `exempt` (no runtime path
// changed) merges as before, and a `--no-merge` run has not reached the gate at all.
async function assert_live_evidence(should_merge: boolean, branch_name: string): Promise<void> {
	if (!should_merge) return

	const verdict = await live_evidence.check(branch_name)

	if (verdict !== 'required') return

	throw new Error(live_evidence.refusal_message())
}

// Every acceptance criterion the Issue carries at the merge maps to a row in the pull request body —
// `acceptance_map` carries the why. Re-read here rather than at the commit, so a criterion added
// during the review is refused too. A run whose issue it cannot identify has no criteria to read.
async function assert_acceptance_mapped(
	should_merge: boolean,
	issue_number: string | undefined,
	branch_name: string,
): Promise<void> {
	if (!should_merge || !is_valid_issue(issue_number)) return

	const refusal = await acceptance_map_check.refusal(issue_number, branch_name)

	if (refusal !== undefined) throw new Error(refusal)
}

// Every test the change removes is disposed of in the pull request body — `removed_tests` carries the
// why. It reads this checkout's diff, which `assert_live_evidence` has already refused to read for a
// branch other than the one checked out.
async function assert_removed_tests_disposed(
	should_merge: boolean,
	branch_name: string,
): Promise<void> {
	if (!should_merge) return

	const refusal = await removed_tests_check.refusal(branch_name)

	if (refusal !== undefined) throw new Error(refusal)
}

// Every pre-merge refusal, in order — each one throws, so nothing merges past the first that fails.
async function assert_merge_gates(
	should_merge: boolean,
	issue_number: string | undefined,
	branch_name: string,
): Promise<void> {
	await assert_review_attested(should_merge)
	await assert_review_recorded(should_merge, issue_number)
	await assert_live_evidence(should_merge, branch_name)
	await assert_acceptance_mapped(should_merge, issue_number, branch_name)
	await assert_removed_tests_disposed(should_merge, branch_name)
}

// After the gates, before the CI wait: the lane's size line is written while the branch is still
// checked out, then a line appended since the run's commit rides the pull request
// itself, so it merges with it — a lane's included. **A pull request that has
// already merged skips both**: the gates guard a merge this run no longer
// makes, and a ledger commit would land on a branch that has already gone in.
async function prepare_merge(
	plan: MergePlan,
	issue_number: string | undefined,
	branch_name: string,
): Promise<void> {
	if (plan.is_merged) return

	await assert_merge_gates(plan.should_merge, issue_number, branch_name)
	if (is_valid_issue(issue_number)) await lane_size_record.record(plan.should_merge, issue_number)
	await git_followup_flush.commit_ledger_step(plan.should_merge, issue_number)
}

// `--help` answers alone; every other invocation opens on the section that governs it. `true` when the
// help was the whole answer.
function answer_help_or_open(values: CliArguments['values']): boolean {
	if (values.help !== true) {
		followup_section.print_section()

		return false
	}

	display_help()

	return true
}

async function main(): Promise<void> {
	const cli = parse_cli_arguments()

	if (answer_help_or_open(cli.values)) return
	const issue_number =
		cli.values['issue-number'] ?? parse_issue_number_from_text(cli.positionals[0] ?? undefined)
	const branch_name = await resolve_branch_name(cli.values.branch)
	const plan = await git_followup_merged.read_merge_plan(branch_name, is_merge_resolved(cli.values))

	await prepare_merge(plan, issue_number, branch_name)
	// **The number the run reports on is the one it used**, which is the number the pull request
	// closes where the invocation named none. Recovered inside `run`, so the
	// tail records a run the command line could not identify rather than silently skipping it.
	const used_issue_number = await git_pr_followup.run({
		branch_name,
		issue_number,
		notify_config: build_notify_config(cli.values),
		coderabbit_ignore_reason: cli.values['coderabbit-ignore-reason'],
		ai_review_ignore_reason: cli.values['ai-review-ignore-reason'],
		is_skip_watch: cli.values['skip-watch'] === true,
		should_merge: plan.should_merge,
		is_merged: plan.is_merged,
		merged_at: plan.merged_at,
	})

	await git_followup_finish.finish(used_issue_number ?? issue_number, plan.should_merge)
}

try {
	await main()
	console.info('')
} catch (error) {
	git_error.handle(error)
}

const git_followup_workflow = {
	answer_help_or_open,
	assert_acceptance_mapped,
	assert_live_evidence,
	assert_removed_tests_disposed,
	parse_issue_number_from_text,
	prepare_merge,
	resolve_branch_name,
	is_merge_resolved,
}

export { git_followup_workflow }
