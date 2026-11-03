import path from 'node:path'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { edit_tool } from './edit-tool'
import { git_argv } from './git-argv'
import { nested_commands } from './nested-commands'
import { secret_paths } from './secret-paths'
import { shell_redirects } from './shell-redirects'

// The trigger and the delivered text behind the `protected-file` row of `delivered-rules.ts`:
// the two kinds of file a run's own file tools must not touch.
//
// - **A secret file is never read** — by the `Read` or `Grep` tool or by a shell reader in a `Bash` call. `.env`
//   carries the Telegram bot token, its `.env.*` variants and wrangler's `.dev.vars` carry the same
//   kind of value, and gh's `hosts.yml`, Codex's `auth.json`, `~/.netrc` and `~/.ssh/**` carry the
//   tools' own credentials (`secret-paths.ts`); either read lands it in the transcript. The scripts
//   that need one load it in their own process, so refusing the call costs them nothing.
// - **`.claude/settings.json` is never edited in a consumer repository.** It is the deny list and the
//   hooks that enforce every other rule, so a run that rewrites it can switch the guards off; `josh
//   sync` owns it there. Only a kit consumer's file is refused — decided per file from the repository
//   the settings file sits in, not the session's directory — so kit's own edits (it is the file's
//   source) and the user-level `~/.claude/settings.json`, which belongs to no repository, both pass.
//
// It fires on every occurrence, for the reason `git-force.ts` does.

const READ_TOOL = 'Read'
const GREP_TOOL = 'Grep'
const FILE_TOOLS: ReadonlySet<string> = new Set([READ_TOOL, GREP_TOOL])
const { is_edit_tool } = edit_tool
const { is_secret_path } = secret_paths
const SETTINGS_FILE = path.join('.claude', 'settings.json')
// Programs that print a named file's bytes or run them, and programs that write one: a write could set
// a guard switch, so `cp .env.example .env` is refused too (kit #4660) — the person makes the file.
const SHELL_PROGRAMS: ReadonlySet<string> = new Set([
	'cp',
	'install',
	'ln',
	'mv',
	'tee',
	'.',
	'awk',
	'base64',
	'bat',
	'cat',
	'cmp',
	'column',
	'comm',
	'cut',
	'diff',
	'fold',
	'grep',
	'head',
	'hexdump',
	'jq',
	'less',
	'more',
	'nl',
	'od',
	'paste',
	'perl',
	'python',
	'python3',
	'rev',
	'rg',
	'ruby',
	'sed',
	'sort',
	'source',
	'strings',
	'tac',
	'tail',
	'uniq',
	'xxd',
	'yq',
])

// `Grep` names the file or directory it searches in `path`; a content search prints the matching lines.
function file_path_of(call: GuardedCall): string {
	if (!json_value.is_record(call.input)) return ''

	const value = call.input[call.name === GREP_TOOL ? 'path' : 'file_path']

	return typeof value === 'string' ? value : ''
}

// A shell read reaches the same bytes a `Read` does, and a shell write changes the file an `Edit`
// would, so a segment that runs one of the programs (`cat .env`, `source .env`, `tee .env`) or
// redirects the file (`< .env`, `>> .env`, `shell-redirects.ts`) is refused too. Claude Code applies
// the `Read` deny rules to the readers it recognizes, but `source .env.local` passes them (measured on
// 2.1.289, kit #3602), so the variants are matched here as well.
function is_secret_shell_segment(segment: string): boolean {
	const call = git_argv.program_of(segment)
	const is_redirected = shell_redirects
		.targets_of(segment, call?.name)
		.some((target) => is_secret_path(target))

	if (is_redirected || call === undefined) return is_redirected

	return SHELL_PROGRAMS.has(call.name) && call.args.some((word) => is_secret_path(word))
}

function is_secret_shell_access(command: string): boolean {
	return nested_commands.commands_of(command).some((segment) => is_secret_shell_segment(segment))
}

// A `Read` or a `Grep` lands the secret in the transcript; an `Edit` / `Write` could set a guard
// switch.
function is_secret_access(call: GuardedCall): boolean {
	if (FILE_TOOLS.has(call.name) || is_edit_tool(call.name)) {
		return is_secret_path(file_path_of(call))
	}

	return bash_triggers.on_bash_command(is_secret_shell_access)(call)
}

// The repository the settings file belongs to is two levels above it (`<root>/.claude/settings.json`).
function is_consumer_settings_edit(
	call: GuardedCall,
	is_kit_consumer: (root: string) => boolean,
): boolean {
	if (!is_edit_tool(call.name)) return false

	const file_path = path.resolve(file_path_of(call))

	if (!file_path.endsWith(`${path.sep}${SETTINGS_FILE}`)) return false

	return is_kit_consumer(path.dirname(path.dirname(file_path)))
}

function is_protected_file_call(
	call: GuardedCall,
	is_kit_consumer: (root: string) => boolean = doctor_consumer.is_kit_consumer,
): boolean {
	return is_secret_access(call) || is_consumer_settings_edit(call, is_kit_consumer)
}

const PROTECTED_FILE_REASON =
	'⛔ protected file: `.env`, a `.env.*` variant, `.dev.vars` and the credential files (gh ' +
	"`hosts.yml`, Codex's `auth.json`, `~/.netrc`, `~/.curlrc`, `~/.npmrc`, `~/.ssh/**`) hold " +
	'secrets and are read and written only by the person, and a consumer ' +
	'`.claude/settings.json` is owned by `josh sync` (a change belongs upstream in kit). Leave these ' +
	'files alone, or ask the user. It fires on every occurrence.'

const ROW = {
	id: 'protected-file',
	is_trigger: is_protected_file_call,
	reason: PROTECTED_FILE_REASON,
	decide: (): boolean => true,
	// The opening the reason carried before it was cut to the action and the next command.
	former_reasons: ['⛔ protected file: `.env` holds the Telegram bot token'],
	about: {
		title: 'Protected file',
		topic: '`operating-rules.md`',
		fires:
			'a `Read`, `Grep`, `Edit` or `Write` of `.env` or a credential file such as gh `hosts.yml`, Codex `auth.json`, `~/.netrc` or `~/.ssh/**` (or a shell read or write of one), or an `Edit` / `Write` of `.claude/settings.json` outside kit. Every occurrence',
		quiet: "kit itself, or the user's `~/.claude/settings.json`",
	},
}

const protected_files = { ROW, is_protected_file_call }

export { protected_files }
