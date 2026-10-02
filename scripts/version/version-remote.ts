import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { safe_json_parse } from './parse-json'
import { release_age } from './release-age'

// Enough history to reach past a quarantine window into the newest release that has aged out of it.
// The endpoint's default page is a single entry, so it is widened to the API's maximum rather than
// paged through: a page that cannot span the window resolves no aged release at all, which silently
// drops the explanation and leaves the unexplained `⚠` this exists to remove. At the maximum, a
// week-long window still needs more than 14 releases a day to overflow (joshuafolkken/kit#808).
const TIMES_PAGE_SIZE = 100
// Reduce the endpoint's version objects to the version → publish-date map the selector expects.
const TIMES_JQ = '[.[] | {(.name): .created_at}] | add'

// Guard an undefined/empty endpoint before it reaches `gh api` — otherwise the CLI would run
// `gh api undefined` and surface a raw 404 ExecaSyncError. Narrows to a concrete string.
function require_endpoint(versions_endpoint: string | undefined, package_name: string): string {
	if (versions_endpoint !== undefined && versions_endpoint.trim() !== '') return versions_endpoint

	throw new Error(
		`Could not derive a versions endpoint for ${package_name}; check its version-command config.`,
	)
}

// Fetch the latest published version from a GitHub Packages versions endpoint. The endpoint is
// supplied per package (e.g. `/users/joshuafolkken/packages/npm/kit/versions?per_page=1`) so the
// same fetcher serves kit, jgame, and app-kit. Guards an undefined/empty endpoint and wraps
// `gh api` failures with an actionable message instead of a raw ExecaSyncError stack. The detail is
// the shared layer's failure text: gh's own stderr (e.g. "gh: Not Found (HTTP 404)") when it wrote
// one, execa's message otherwise, followed by any JSON error body gh wrote to stdout.
function fetch_latest_version(versions_endpoint: string | undefined, package_name: string): string {
	const endpoint = require_endpoint(versions_endpoint, package_name)

	try {
		return git_gh_exec.exec_gh_api_sync({ path: endpoint, jq_filter: '.[0].name' }).trim()
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)

		throw new Error(
			`Failed to fetch latest version for ${package_name} via ${endpoint}: ${detail}`,
			{
				cause: error,
			},
		)
	}
}

// Rewrite the endpoint's page size. The endpoint is consumer-overridable, so `per_page` is set
// through a query parser rather than by substituting the literal the default happens to carry.
function with_page_size(endpoint: string, page_size: number): string {
	// Cut at the first `?` rather than `split`, whose limit truncates: a query carrying a second `?`
	// would otherwise lose everything after it.
	const separator = endpoint.indexOf('?')
	const path_part = separator === -1 ? endpoint : endpoint.slice(0, separator)
	const query = new URLSearchParams(separator === -1 ? '' : endpoint.slice(separator + 1))

	query.set('per_page', String(page_size))

	return `${path_part}?${query.toString()}`
}

// Publish timestamps for the package's recent releases, or nothing. Unlike `fetch_latest_version`
// this never throws: the timestamps only enrich an explanation, so a package whose history cannot be
// read keeps the report it had before (joshuafolkken/kit#808).
function fetch_release_times(
	versions_endpoint: string | undefined,
): Record<string, string> | undefined {
	if (versions_endpoint === undefined || versions_endpoint.trim() === '') return undefined
	const endpoint = with_page_size(versions_endpoint, TIMES_PAGE_SIZE)
	const stdout = git_gh_exec.read_gh_api_sync({ path: endpoint, jq_filter: TIMES_JQ })
	if (stdout === undefined) return undefined
	const parsed = release_age.release_times_schema.safeParse(safe_json_parse(stdout))

	return parsed.success ? parsed.data : undefined
}

export { fetch_latest_version, fetch_release_times, with_page_size }
