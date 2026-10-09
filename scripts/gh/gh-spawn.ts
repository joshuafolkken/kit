import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'

// The synchronous twin of `git_gh_repo.repo_get_name_with_owner`: same fact, read the same way, but
// synchronously because `josh init` / `josh sync` / `josh doctor` decide before they can await.
// It asks REST for the same reason — `gh repo view` goes through GraphQL, which a cloud session is
// refused (403), and a repository that reads as unresolved makes `init` / `sync` skip
// `sonar-project.properties` outright. The path comes from the shared
// builder rather than being spelled out again here.
//
// An unbounded lookup asks for `NO_BUDGET`, execa's own "no timeout": the shared layer otherwise
// applies its default budget, which would change what `init` / `sync` wait for.
const NO_BUDGET = 0

function fetch_repo_name(timeout_ms: number | undefined): string | undefined {
	const stdout = git_gh_exec.read_gh_api_sync({
		path: git_gh_api_path.repo_api_path(),
		jq_filter: '.full_name',
		cwd: PROJECT_ROOT,
		timeout_ms: timeout_ms ?? NO_BUDGET,
	})

	const name = stdout?.trim()

	return name === '' ? undefined : name
}

// The unbounded lookup, for callers whose *writes* depend on the answer. A timeout would surface as
// an unresolved repository, and `josh init` / `josh sync` react to that by skipping
// `sonar-project.properties` entirely — so a latency spike would silently leave a consumer's Sonar
// config stale. Waiting is the safer failure mode there.
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
