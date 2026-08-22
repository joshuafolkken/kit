import { execaSync } from 'execa'
import { PROJECT_ROOT } from './init/init-paths'
import { read_spawn_stdout } from './spawn-exit'

// The shared half of every "report a GitHub repository setting kit cannot write" check.
//
// Two such checks exist — `automated-security-fixes` (joshuafolkken/kit#805) and `allow_auto_merge`
// (joshuafolkken/kit#834) — and they agree on everything that is not wording: the same bounded
// `gh api` call, the same rule that an answer which cannot be read is never reported as a negative
// answer, and the same blank-line-separated report block. That agreement is the contract, so it
// lives here once rather than being re-derived per setting.
type RepoSettingStatus = 'enabled' | 'disabled' | 'unreadable'

// Bounded, unlike the repository lookup: these calls only decide what a report *says*, never what
// gets written, so a timeout degrades to `could not be read` and costs nothing. `josh doctor` made
// no network calls at all before joshuafolkken/kit#805, and this keeps it prompt.
const GH_TIMEOUT_MS = 5000

// A literal `<owner>/<repo>` would be unusable when pasted into a shell, where `<` redirects — but
// it is still the honest rendering when the repository could not be resolved at all.
const REPO_PLACEHOLDER = '<owner>/<repo>'
const UNKNOWN_REPOSITORY = 'unknown repository'

interface RepoApiResult {
	exit_code: number
	stdout: string
}

// One `gh api` call. Never throws and never propagates a non-zero exit: an unreadable answer is a
// reported status, not a command failure.
function query_repo_api(api_path: string): RepoApiResult {
	const result = execaSync('gh', ['api', api_path], {
		cwd: PROJECT_ROOT,
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})

	return { exit_code: result.exitCode ?? 1, stdout: read_spawn_stdout(result) }
}

// The response body as an object, or nothing. A non-zero exit covers every case where the answer
// cannot be trusted — a 404 on a repository that never had the setting, a token without the scope,
// no network — and they collapse together with unparseable output because none of them proves the
// setting is off.
function parse_payload(exit_code: number, stdout: string): object | undefined {
	if (exit_code !== 0) return undefined

	try {
		const parsed: unknown = JSON.parse(stdout)

		return typeof parsed === 'object' && parsed !== null ? parsed : undefined
	} catch {
		return undefined
	}
}

// Read one field off a parsed body. `Reflect.get` rather than an index signature: the body is
// external JSON, so declaring it as a record would need a type assertion to claim a shape the
// response never promised.
function read_field(payload: object | undefined, field: string): unknown {
	return payload === undefined ? undefined : Reflect.get(payload, field)
}

// A missing payload, a missing field, or a field that is not a boolean are all unreadable: a
// missing answer is not a negative answer, and reporting one as `disabled` would raise a false
// alarm — the failure mode both settings exist to remove.
function classify_boolean_setting(payload: object | undefined, field: string): RepoSettingStatus {
	const value = read_field(payload, field)
	if (typeof value !== 'boolean') return 'unreadable'

	return value ? 'enabled' : 'disabled'
}

// The repository a remediation command should address. Falls back to the placeholder rather than to
// prose, because this value is pasted into a shell.
function command_target(repo: string | undefined): string {
	return repo ?? REPO_PLACEHOLDER
}

// The repository a status line should name. Falls back to prose rather than to the placeholder,
// because this value is read, not pasted.
function report_target(repo: string | undefined): string {
	return repo ?? UNKNOWN_REPOSITORY
}

// The blank-line-separated report block, shared by every caller so the separator and the ordering
// contract live in one place.
function print_section(lines: ReadonlyArray<string>): void {
	console.info('')

	for (const line of lines) {
		console.info(line)
	}
}

const repo_setting = {
	GH_TIMEOUT_MS,
	REPO_PLACEHOLDER,
	UNKNOWN_REPOSITORY,
	query_repo_api,
	parse_payload,
	read_field,
	classify_boolean_setting,
	command_target,
	report_target,
	print_section,
}

export type { RepoApiResult, RepoSettingStatus }
export { repo_setting }
