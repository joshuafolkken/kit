import { execaSync } from 'execa'
import { git_gh_api_path } from './git/git-gh-api-path'
import { PROJECT_ROOT } from './init/init-paths'

// The synchronous twin of `git_gh_repo.repo_get_name_with_owner`: same fact, read the same way, but
// through `execaSync` because `josh init` / `josh sync` / `josh doctor` decide before they can await.
// It asks REST for the same reason — `gh repo view` goes through GraphQL, which a cloud session is
// refused (403), and a repository that reads as unresolved makes `init` / `sync` skip
// `sonar-project.properties` outright (joshuafolkken/kit#1023). The path comes from the shared
// builder rather than being spelled out again here.
//
// `timeout` is spread in rather than passed as `undefined`: execa's options type does not admit an
// undefined value for it, and an explicit `undefined` would not mean "no timeout" anyway.
function fetch_repo_name(timeout_ms: number | undefined): string | undefined {
	const result = execaSync('gh', ['api', git_gh_api_path.repo_api_path(), '--jq', '.full_name'], {
		cwd: PROJECT_ROOT,
		reject: false,
		...(timeout_ms !== undefined && { timeout: timeout_ms }),
	})
	if (result.exitCode !== 0 || !result.stdout) return undefined

	return result.stdout.trim() || undefined
}

// The unbounded lookup, for callers whose *writes* depend on the answer. A timeout would surface as
// an unresolved repository, and `josh init` / `josh sync` react to that by skipping
// `sonar-project.properties` entirely — so a latency spike would silently leave a consumer's Sonar
// config stale. Waiting is the safer failure mode there (joshuafolkken/kit#805).
function get_repo_name_with_owner(): string | undefined {
	return fetch_repo_name(undefined)
}

// The bounded lookup, for callers that only report. Offered as a separate function rather than an
// optional argument so the choice is visible at every call site: waiting is the safer failure mode
// for `init` / `sync`, and returning promptly is the safer one for `doctor`, which writes nothing.
function get_repo_name_with_owner_within(timeout_ms: number): string | undefined {
	return fetch_repo_name(timeout_ms)
}

const gh_spawn = { get_repo_name_with_owner, get_repo_name_with_owner_within }

export { gh_spawn }
