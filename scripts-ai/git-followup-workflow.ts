#!/usr/bin/env tsx
import { parseArgs } from 'node:util'
import { git_branch } from '../scripts/git/git-branch'
import { git_error } from '../scripts/git/git-error'
import { git_notify, type GitNotifyConfig } from '../scripts/git/git-notify'
import { git_pr_followup } from '../scripts/git/git-pr-followup'

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
  --merge                      Merge the PR right after sending the completion notification
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

async function main(): Promise<void> {
	const cli = parse_cli_arguments()

	if (cli.values.help === true) {
		display_help()

		return
	}

	await git_pr_followup.run({
		branch_name: await resolve_branch_name(cli.values.branch),
		issue_number:
			cli.values['issue-number'] ?? parse_issue_number_from_text(cli.positionals[0] ?? undefined),
		notify_config: build_notify_config(cli.values),
		coderabbit_ignore_reason: cli.values['coderabbit-ignore-reason'],
		ai_review_ignore_reason: cli.values['ai-review-ignore-reason'],
		is_skip_watch: cli.values['skip-watch'] === true,
		should_merge: cli.values.merge === true,
	})
	console.info('')
	console.info('✅ PR followup completed.')
}

try {
	await main()
	console.info('')
} catch (error) {
	git_error.handle(error)
}
