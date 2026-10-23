import path from 'node:path'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `protected-file` row of `delivered-rules.ts`:
// the two files a run's own file tools must not touch.
//
// - **A secret file is never read** — by the `Read` tool or by a shell reader in a `Bash` call. `.env`
//   carries the Telegram bot token, its `.env.*` variants and wrangler's `.dev.vars` carry the same
//   kind of value, and either read lands it in the transcript. The scripts that need one load it in
//   their own process, so refusing the call costs them nothing.
// - **`.claude/settings.json` is never edited in a consumer repository.** It is the deny list and the
//   hooks that enforce every other rule, so a run that rewrites it can switch the guards off; `josh
//   sync` owns it there. Only a kit consumer's file is refused — decided per file from the repository
//   the settings file sits in, not the session's directory — so kit's own edits (it is the file's
//   source) and the user-level `~/.claude/settings.json`, which belongs to no repository, both pass.
//
// It fires on every occurrence, for the reason `git-force.ts` does.

const READ_TOOL = 'Read'
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])
const SECRET_FILES: ReadonlySet<string> = new Set(['.env', '.dev.vars'])
const ENVIRONMENT_VARIANT_PREFIX = '.env.'
// The two variants `.gitignore` un-ignores: they are tracked and hold placeholders, not secrets. The
// `Read(!…)` carve-outs in `.claude/settings.json` name the same two.
const TRACKED_VARIANTS: ReadonlySet<string> = new Set(['.env.example', '.env.test'])
const SETTINGS_FILE = path.join('.claude', 'settings.json')
const WHITESPACE = /\s+/u
const TOKEN_QUOTES = /["']/gu
// Each character of a redirect operator (`<`, `>`, `>>`, `2>`, `&>`) — and the clobber `>|` whole —
// is spaced out to a mark, so the word after the last one is the file it reads or writes.
const REDIRECT = />\||[<>]/gu
const REDIRECT_MARK = '<'
// Programs that run their quoted argument as a script.
const SHELLS: ReadonlySet<string> = new Set(['bash', 'eval', 'sh', 'zsh'])
// The body of a `$(…)` (innermost) or a backtick command substitution.
const SUBSTITUTION = /\$\((?<dollar>[^()]*)\)|`(?<backtick>[^`]*)`/gu
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

function file_path_of(call: GuardedCall): string {
	if (!json_value.is_record(call.input)) return ''

	const value = call.input['file_path']

	return typeof value === 'string' ? value : ''
}

function is_environment_path(token: string): boolean {
	const name = path.basename(token.replaceAll(TOKEN_QUOTES, ''))

	if (TRACKED_VARIANTS.has(name)) return false

	return SECRET_FILES.has(name) || name.startsWith(ENVIRONMENT_VARIANT_PREFIX)
}

// A shell read reaches the same bytes a `Read` does, and a shell write changes the file an `Edit`
// would, so a segment that runs one of the programs (`cat .env`, `source .env`, `tee .env`) or
// redirects the file (`< .env`, `>> .env`) is refused too. Claude Code applies the `Read` deny rules to
// the readers it recognizes, but `source .env.local` passes them (measured on 2.1.289, kit #3602), so
// the variants are matched here as well.
//
// A quoted `>` is text (`git commit -m "x >> .env"`), so the marks are read on the quote-blanked
// segment, whose offsets match the original; a shell's quoted script (`sh -c "echo x > .env"`) runs,
// so its marks are read as written, as is a heredoc line, which `blanked` does not cut.
function redirect_marks_of(segment: string, program: string | undefined): string {
	if (program !== undefined && SHELLS.has(program)) return segment

	return time_shell.blanked(segment) ?? segment
}

function spaced_redirects(segment: string, program: string | undefined): string {
	const marks = redirect_marks_of(segment, program)

	return segment.replaceAll(REDIRECT, (mark, offset: number) =>
		marks.startsWith(mark, offset) ? ` ${REDIRECT_MARK} ` : mark,
	)
}

function is_environment_shell_segment(segment: string): boolean {
	const call = git_argv.program_of(segment)
	const words = spaced_redirects(segment, call?.name)
		.split(WHITESPACE)
		.filter((word) => word !== '')
	const is_redirected = words.some(
		(word, index) => word === REDIRECT_MARK && is_environment_path(words[index + 1] ?? ''),
	)

	if (is_redirected || call === undefined) return is_redirected

	return SHELL_PROGRAMS.has(call.name) && call.args.some((word) => is_environment_path(word))
}

// A shell's quoted script holds commands of its own (`bash -c "true; cat .env"`), so it is cut again
// without regard to quotes.
function script_commands_of(segment: string): Array<string> {
	const program = git_argv.program_of(segment)?.name

	if (program === undefined || !SHELLS.has(program)) return []

	return shell_segments.commands_of(segment)
}

// A command substitution runs even inside double quotes (`echo "$(echo x > .env)"`), which the
// quote-blanked reading takes for text, so its body is cut out as commands of their own.
function substitution_commands_of(segment: string): Array<string> {
	return [...segment.matchAll(SUBSTITUTION)].flatMap((match) =>
		shell_segments.commands_of(match.groups?.['dollar'] ?? match.groups?.['backtick'] ?? ''),
	)
}

function segments_of(command: string): Array<string> {
	return shell_segments
		.quote_aware_commands_of(command)
		.flatMap((segment) => [
			segment,
			...script_commands_of(segment),
			...substitution_commands_of(segment),
		])
}

function is_environment_shell_access(command: string): boolean {
	return segments_of(command).some((segment) => is_environment_shell_segment(segment))
}

// A `Read` lands the secret in the transcript; an `Edit` / `Write` could set a guard switch.
function is_environment_access(call: GuardedCall): boolean {
	if (call.name === READ_TOOL || EDIT_TOOLS.has(call.name)) {
		return is_environment_path(file_path_of(call))
	}

	return bash_triggers.on_bash_command(is_environment_shell_access)(call)
}

// The repository the settings file belongs to is two levels above it (`<root>/.claude/settings.json`).
function is_consumer_settings_edit(
	call: GuardedCall,
	is_kit_consumer: (root: string) => boolean,
): boolean {
	if (!EDIT_TOOLS.has(call.name)) return false

	const file_path = path.resolve(file_path_of(call))

	if (!file_path.endsWith(`${path.sep}${SETTINGS_FILE}`)) return false

	return is_kit_consumer(path.dirname(path.dirname(file_path)))
}

function is_protected_file_call(
	call: GuardedCall,
	is_kit_consumer: (root: string) => boolean = doctor_consumer.is_kit_consumer,
): boolean {
	return is_environment_access(call) || is_consumer_settings_edit(call, is_kit_consumer)
}

const PROTECTED_FILE_REASON =
	'⛔ protected file: `.env`, a `.env.*` variant and `.dev.vars` hold secrets and are written only ' +
	'by the person, and a consumer ' +
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
			'a `Read`, `Edit` or `Write` of `.env` (or a shell read or write of it), or an `Edit` / `Write` of `.claude/settings.json` outside kit. Every occurrence',
		quiet: "kit itself, or the user's `~/.claude/settings.json`",
	},
}

const protected_files = { ROW, is_protected_file_call }

export { protected_files }
