import { repo_party } from '#scripts/discovery/repo-party'
import { parse_json } from '#scripts/git/parse-json-array'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_etag_read } from './git-gh-etag-read'
import { gh_rate_limit } from './git-gh-rate-limit'

// `owner/repo` for the repository the session runs in.
//
// Resolved locally first (joshuafolkken/kit#6752): `gh` expands `{owner}/{repo}` from `GH_REPO` or the
// remotes, so reading it back cost one REST call per process. `current_repository` answers nothing
// where `gh`'s pick is ambiguous or unreadable; only then the REST read (not GraphQL, which a cloud
// session is refused), through the ETag layer. A failed read is `undefined`, except an exhausted rate
// limit, which is thrown rather than read as "no repository".
//
// The local slug is the remote as typed — another case, or a renamed repository's old name — so a
// caller matching it against a name GitHub returned reads `repo_get_canonical_name_with_owner`.

const repository_schema = z.object({ full_name: z.string() })

function local_name_with_owner(): string | undefined {
	const identity = repo_party.current_repository()

	return identity === undefined ? undefined : `${identity.owner}/${identity.repo}`
}

async function repo_get_canonical_name_with_owner(): Promise<string | undefined> {
	try {
		const body = await git_gh_etag_read.read(git_gh_api_path.repo_api_path())
		const name = parse_json
			.parse_json_object_or_undefined(body, repository_schema)
			?.full_name.trim()

		return name === '' ? undefined : name
	} catch (error) {
		if (gh_rate_limit.is_exhausted(error_text.message_of(error))) throw error
		error_text.trace_swallowed('git_gh_repo.repo_get_name_with_owner', error)

		return undefined
	}
}

async function repo_get_name_with_owner(): Promise<string | undefined> {
	return local_name_with_owner() ?? (await repo_get_canonical_name_with_owner())
}

const git_gh_repo = {
	repo_get_canonical_name_with_owner,
	repo_get_name_with_owner,
}

export { git_gh_repo }
