#!/usr/bin/env tsx
import { parseArgs } from 'node:util'
import { git_branch } from '../scripts/git/git-branch'
import { git_error } from '../scripts/git/git-error'
import { git_notify, type GitNotifyConfig } from '../scripts/git/git-notify'
import { git_pr_followup } from '../scripts/git/git-pr-followup'
import { cli_body } from '../scripts/josh/cli-body'
import { review_attest } from '../scripts/review/review-attest'
import { load_optional_environment } from './environment-loader'
import { parse_issue_number_from_text } from './followup-issue-number'
import { git_followup_finish } from './git-followup-finish'

load_optional_environment()

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
// never was (joshuafolkken/kit#1578).
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
// process starts, and joshuafolkken/kit#1198 recorded both halves of that — a Telegram body that
// silently lost a word, and a comment body whose text ran as git commands.
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
	// **The number the run reports on is the one it used**, which is the number the pull request
	// closes where the invocation named none (joshuafolkken/kit#1539). Recovered inside `run`, so the
	// tail records a run the command line could not identify rather than silently skipping it.
	const used_issue_number = await git_pr_followup.run({
		branch_name: await resolve_branch_name(cli.values.branch),
		issue_number,
		notify_config: build_notify_config(cli.values),
		coderabbit_ignore_reason: cli.values['coderabbit-ignore-reason'],
		ai_review_ignore_reason: cli.values['ai-review-ignore-reason'],
		is_skip_watch: cli.values['skip-watch'] === true,
		should_merge,
	})

	await git_followup_finish.finish(used_issue_number ?? issue_number, should_merge)
}

try {
	await main()
	console.info('')
} catch (error) {
	git_error.handle(error)
}

const git_followup_workflow = {
	assert_review_attested,
	parse_issue_number_from_text,
	resolve_branch_name,
	is_merge_resolved,
}

export { git_followup_workflow }
