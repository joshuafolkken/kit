#!/usr/bin/env tsx
import { parseArgs } from 'node:util'
import { git_branch } from '../scripts/git/git-branch'
import { git_error } from '../scripts/git/git-error'
import { git_next_issues } from '../scripts/git/git-next-issues'
import { git_notify, type GitNotifyConfig } from '../scripts/git/git-notify'
import { git_pr_followup } from '../scripts/git/git-pr-followup'
import { version_targets } from '../scripts/version/version-targets'
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
  --skip-watch                 Skip "gh pr checks --watch" and only evaluate latest status
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

function print_project_version(): void {
	const line = version_targets.project_version_line(process.cwd())
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

// The tail printed once the workflow itself has finished. `print_project_version` stays last by
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
	print_project_version()
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

	await git_pr_followup.run({
		branch_name: await resolve_branch_name(cli.values.branch),
		issue_number,
		notify_config: build_notify_config(cli.values),
		coderabbit_ignore_reason: cli.values['coderabbit-ignore-reason'],
		ai_review_ignore_reason: cli.values['ai-review-ignore-reason'],
		is_skip_watch: cli.values['skip-watch'] === true,
		should_merge,
	})
	await print_completion(issue_number, should_merge)
}

try {
	await main()
	console.info('')
} catch (error) {
	git_error.handle(error)
}

const git_followup_workflow = {
	parse_issue_number_from_text,
	resolve_branch_name,
	is_merge_resolved,
	print_project_version,
	print_next_issues,
	print_completion,
}

export { git_followup_workflow }
