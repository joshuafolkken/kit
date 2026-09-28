import { readFileSync } from 'node:fs'
import { issue_bug_label } from '#scripts/issue/issue-bug-label'
import type { GuardRun } from '#scripts/josh/hook-decision'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

const LINT_NAMES = new Set(['issue:lint'])
const LINT_PATH = /\b(?:issue:lint|iln)\s+(?:'([^']+)'|"([^"]+)"|(\S+))/u
const BUG_FIELD = /(?:^|\s)(?:-f|-F|--field|--raw-field)\s+['"]?labels\[\]=bug(?:['"]|\s|$)/u
const BUG_OPTION = /(?:^|\s)(?:-l|--label)\s+['"]?bug(?:['"]|\s|$)/u

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

function declares_bug(path: string | undefined): boolean {
	if (path === undefined) return false

	try {
		return issue_bug_label.is_bug_fix(readFileSync(path, 'utf8'))
	} catch {
		return false
	}
}

function has_bug_label(command: string): boolean {
	return BUG_FIELD.test(command) || BUG_OPTION.test(command)
}

function needs_bug_label(command: string, tail: string): boolean {
	return declares_bug(latest_lint_path(tail)) && !has_bug_label(command)
}

function decide(call: { input: unknown }, run: GuardRun): boolean {
	const command = time_shell.bash_command(call.input)
	const tail = time_density_hook.read_tail(run.transcript)

	return needs_bug_label(command, tail)
}

const ISSUE_BUG_LABEL_REASON =
	'⛔ bug label missing: the body most recently checked by `pnpm josh issue:lint` declares ' +
	"`- 種別: 不具合`, but this filing omits `bug`. Add `-f 'labels[]=bug'` to the same " +
	'creation call, then reissue it. See `prompts/collaboration-workflow/issue-template.md`.'

const ROW = {
	id: 'issue-bug-label',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reason: ISSUE_BUG_LABEL_REASON,
	decide,
}

const issue_bug_label_rule = { ROW, has_bug_label, latest_lint_path, needs_bug_label }

export { issue_bug_label_rule }
