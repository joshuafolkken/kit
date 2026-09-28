import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BUG_LABEL } from '#scripts/git/issue-labels'
import { issue_bug_label } from '#scripts/issue/issue-bug-label'
import type { GuardRun } from '#scripts/josh/hook-decision'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { issue_filing_args } from './issue-filing-args'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

const LINT_NAMES = new Set(['issue:lint'])
const LINT_PATH = /\b(?:issue:lint|iln)\s+(?:'([^']+)'|"([^"]+)"|(\S+))/u

function lint_argument(segment: string): string | undefined {
	const [, single_quoted, double_quoted, bare] = LINT_PATH.exec(segment) ?? []

	return single_quoted ?? double_quoted ?? bare
}

function latest_lint_path(tail: string): string | undefined {
	const segments = tail_commands
		.prior_bash_commands(tail)
		.flatMap((command) => shell_segments.segments_of(command))
	const lint = segments.findLast((segment) => shell_segments.is_josh_command(segment, LINT_NAMES))

	return lint === undefined ? undefined : lint_argument(lint)
}

function linted_body(body_path: string): string | undefined {
	try {
		return readFileSync(body_path, 'utf8')
	} catch {
		return undefined
	}
}

function matches_linted_file(command: string, lint_path: string): boolean {
	const filing_path = issue_filing_args.body_file(command)

	return filing_path !== undefined && path.resolve(filing_path) === path.resolve(lint_path)
}

function needs_bug_label(command: string, tail: string): boolean {
	const lint_path = latest_lint_path(tail)

	if (lint_path === undefined) return false
	const body = linted_body(lint_path)

	if (body === undefined) return false

	if (!matches_linted_file(command, lint_path)) return true

	return issue_bug_label.is_bug_fix(body) && !issue_filing_args.has_label(command, BUG_LABEL)
}

function decide(call: { input: unknown }, run: GuardRun): boolean {
	const command = time_shell.bash_command(call.input)
	const tail = time_density_hook.read_tail(run.transcript)

	return needs_bug_label(command, tail)
}

const ISSUE_BUG_LABEL_REASON =
	'⛔ bug filing mismatch: use the exact body file checked by `pnpm josh issue:lint` in this ' +
	'creation call (`-F body=@<path>` or `gh issue create --body-file <path>`) and include the ' +
	"`bug` label (`-f 'labels[]=bug'` or `--label bug`). See " +
	'`prompts/collaboration-workflow/issue-template.md`.'

const ROW = {
	id: 'issue-bug-label',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reason: ISSUE_BUG_LABEL_REASON,
	decide,
}

const issue_bug_label_rule = { ROW, latest_lint_path, needs_bug_label }

export { issue_bug_label_rule }
