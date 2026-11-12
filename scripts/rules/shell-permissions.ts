import { gh_api } from './gh-api'
import { gh_repo_selector } from './gh-repo-selector'
import { git_argv, type ProgramCall } from './git-argv'
import { interpreter_options } from './interpreter-options'
import { pr_merge } from './pr-merge'
import { third_party_write } from './third-party-write'

const FLAG_PREFIX = '-'
const ORIGIN = 'origin'
const PUSH = 'push'
const PUSH_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'--repo',
	'--receive-pack',
	'--exec',
	'-o',
	'--push-option',
])
const QUOTING = /["'\\]/gu
const PUSH_CONFIG = /^(?:remote\.|url\.|core\.(?:sshCommand|gitProxy))/iu
const CONFIG_ENVIRONMENT = /^GIT_CONFIG(?:_[A-Z0-9_]+)?=/u

function has_push_config(line: string): boolean {
	return git_argv
		.config_arguments_of(line)
		.some((word) => PUSH_CONFIG.test(word.replaceAll(QUOTING, '')))
}

function has_config_environment(segment: string, call: ProgramCall): boolean {
	const prefix = git_argv.words_of(segment).slice(0, -(call.args.length + 1))

	return prefix.some((word) => CONFIG_ENVIRONMENT.test(word.replaceAll(QUOTING, '')))
}

function has_push_override(
	segment: string,
	call: ProgramCall,
	args: ReadonlyArray<string>,
): boolean {
	const line = [call.name, ...call.args].join(' ')

	return (
		has_config_environment(segment, call) ||
		has_push_config(line) ||
		args.some((word) => PUSH_VALUE_FLAGS.has(word.split('=', 1)[0] ?? ''))
	)
}

function is_gh_write(call: ProgramCall): boolean {
	if (call.name !== 'gh') return false

	const line = [call.name, ...call.args].join(' ')

	if (pr_merge.is_graphql_call(call.name, call.args)) {
		return [pr_merge.is_pr_merge, third_party_write.writes_third_party].some((test) => test(line))
	}

	if (gh_api.is_gh_api(line)) return gh_api.is_write(line)

	return !/^gh (?:--help|--version|-h)$/u.test(line) && gh_repo_selector.is_write_call(call.args)
}

// A missing remote may resolve to a configured foreign push target. Only an explicit origin
// is accepted, and flags that replace a destination or remote executable are refused.
function is_foreign_push(segment: string, call: ProgramCall): boolean {
	const line = [call.name, ...call.args].join(' ')
	const parsed = git_argv.parse(line)

	if (parsed?.subcommand !== PUSH) return false
	if (has_push_override(segment, call, parsed.args)) return true

	const remote = parsed.args.find((word) => !word.startsWith(FLAG_PREFIX))

	return remote?.replaceAll(QUOTING, '') !== ORIGIN
}

function is_restricted(segment: string, call: ProgramCall): boolean {
	const plain = {
		name: call.name,
		args: call.args.map((word) => interpreter_options.syntax_word(word)),
	}

	return (
		interpreter_options.is_inline_execution(plain) ||
		is_gh_write(plain) ||
		is_foreign_push(segment, plain)
	)
}

const shell_permissions = { is_restricted }

export { shell_permissions }
