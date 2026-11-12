import { gh_call_kind } from '#scripts/gh/gh-call-kind'
import { gh_usage_log } from '#scripts/gh/gh-usage-log'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { hook_tool_payload } from '#scripts/josh/hook-tool-payload'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { git_argv } from '#scripts/rules/git-argv'
import { nested_commands } from '#scripts/rules/nested-commands'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { hook_context, type HookContext } from './hook-context'

// The `gh` calls a session types into Bash, one gh usage line each (joshuafolkken/kit#6781). They never
// pass the exec layer `gh_request_tally` counts, so this hook is the only place that sees them. The
// line is `direct:<subcommand>`, so `josh gh:usage` (joshuafolkken/kit#6753) can tell them from the
// josh processes' own lines, and carries the call's kind under `endpoints` (joshuafolkken/kit#6867).
// `gh api rate_limit` is free and not counted. The write never changes the
// hook's verdict: a failure is swallowed, as `gh-usage-event.ts` swallows its own.

const PREFIX = 'direct:'
const API = 'api'
const FREE_ENDPOINT = 'rate_limit'
const LEADING_SLASH = /^\//u
const SUBCOMMAND_WORDS = 2

// The words after `gh` without its flags, or none when the segment does not run `gh`.
function gh_words(segment: string): Array<string> {
	return git_argv.arguments_of(segment, 'gh')?.filter((word) => !word.startsWith('-')) ?? []
}

// `gh api rate_limit`, `gh api /rate_limit` and `gh api --method GET rate_limit` alike.
function is_free(api_words: ReadonlyArray<string>): boolean {
	return api_words.some((word) => word.replace(LEADING_SLASH, '') === FREE_ENDPOINT)
}

// The subcommand a `gh` segment runs — `pr checks`, or `api` alone — or `undefined` when the segment
// is not a counted `gh` call.
function subcommand_of(segment: string): string | undefined {
	const words = gh_words(segment)
	const [head, ...rest] = words

	if (head === API) return is_free(rest) ? undefined : API

	return head === undefined ? undefined : words.slice(0, SUBCOMMAND_WORDS).join(' ')
}

// The line's command and the call's kind (joshuafolkken/kit#6867), so `josh gh:usage` sums a direct
// call under its endpoint like a josh process's own.
interface DirectCall {
	command: string
	kind: string
}

function direct_call_of(segment: string): DirectCall | undefined {
	const subcommand = subcommand_of(segment)
	if (subcommand === undefined) return undefined

	const kind = gh_call_kind.of(git_argv.arguments_of(segment, 'gh') ?? [])

	return { command: `${PREFIX}${subcommand}`, kind }
}

// One entry per `gh` the line launches, a substitution's or a `bash -c` script's included: a pipe
// into `jq` is one, `gh a && gh b` two.
function direct_calls(command: string): Array<DirectCall> {
	return nested_commands
		.commands_of(command)
		.map((segment) => direct_call_of(segment))
		.filter((call) => call !== undefined)
}

function calls_of(raw_payload: string): Array<DirectCall> {
	const payload = hook_tool_payload.parse(raw_payload)

	if (payload?.tool_name !== 'Bash') return []

	return direct_calls(time_shell.bash_command(payload.tool_input))
}

// `undefined` outside a repository and under a test run, so a hook suite never writes the real log.
function log_target(context: HookContext): string | undefined {
	if (context.env['VITEST'] !== undefined) return undefined

	const repository = git_common_directory.repository(context.cwd)

	return repository === undefined ? undefined : gh_usage_log.target_of(repository)
}

function append_all(
	target: string,
	calls: ReadonlyArray<DirectCall>,
	environment: HookContext['env'],
): void {
	const marked = lane_child_marker.marked_issue(environment)
	const issue = marked === undefined ? undefined : Number(marked)

	for (const { command, kind } of calls) {
		const at = new Date().toISOString()
		const endpoints = { [kind]: { calls: 1, not_modified: 0 } }

		gh_usage_log.append(target, {
			at,
			command,
			issue,
			calls: 1,
			not_modified: 0,
			elapsed_ms: 0,
			endpoints,
		})
	}
}

// Only a line that launches `gh` looks up the repository, so every other call stays as fast as it was.
// The log and the lane child's issue come from `context`, the call's cwd and environment.
async function record(
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	try {
		const calls = calls_of(raw_payload)
		const target = calls.length === 0 ? undefined : log_target(context)

		if (target !== undefined) append_all(target, calls, context.env)
	} catch (error) {
		error_text.trace_swallowed('direct_gh_usage.record', error)
	}
}

const direct_gh_usage = { record }

export { direct_gh_usage }
