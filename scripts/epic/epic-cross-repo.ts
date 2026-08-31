import { repo_map_logic } from '#scripts/discovery/repo-map-logic'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { git_gh_api_path } from '#scripts/git/git-gh-api-path'
import { propagate_publish } from '#scripts/propagate/propagate-publish'
import { derive_versions_endpoint } from '#scripts/version/version-command-config'
import { execaSync } from 'execa'
import type { DependencyVerdict } from './epic-classify'
import type { EpicChild } from './epic-graph'

// Resolving a dependency that crosses a repository boundary.
//
// `blocked-by` is satisfied the moment the blocking issue closes, and across repositories that is
// too early. Merging kit's issue does not publish kit — the merge, the auto-tag and the publish run
// one after another — so a consumer child told it may start at that moment either fails to install
// the version it needs or, worse, installs the previous one and implements against it. That failure
// shows up as "it breaks sometimes", which is the hardest kind to diagnose (joshuafolkken/kit#864).
//
// The publish check itself is joshuafolkken/kit#863's, imported rather than restated: two
// implementations of "has this version appeared" would drift, and the looser one would decide.

// The package a repository distributes, by convention: the npm scope is the GitHub owner and the
// package name is the repository name. Every first-party repository follows it, and the version
// command already derives its registry endpoint the same way.
function package_name_for(repo: string): string | undefined {
	const identity = repo_origin.parse_origin_url(`https://${repo_origin.GITHUB_HOST}/${repo}`)
	if (identity === undefined) return undefined

	return `@${identity.owner}/${identity.repo}`
}

// The registry answer per repository, for one classification pass. Several children commonly depend
// on the same blocker, and each edge would otherwise spawn its own blocking `gh` call for an answer
// that cannot have changed in between.
const published_cache = new Map<string, ReadonlyArray<string> | undefined>()

function fetch_versions_for(repo: string): ReadonlyArray<string> | undefined {
	const package_name = package_name_for(repo)
	if (package_name === undefined) return undefined

	return propagate_publish.fetch_published_versions(derive_versions_endpoint(package_name))
}

function published_versions(repo: string): ReadonlyArray<string> | undefined {
	if (published_cache.has(repo)) return published_cache.get(repo)
	const versions = fetch_versions_for(repo)

	published_cache.set(repo, versions)

	return versions
}

// The default-branch version per repository — the other half of the answer `published_cache` holds,
// cached for the same reason and cleared with it.
const version_cache = new Map<string, string | undefined>()

// Discard the cached registry and manifest answers. A long-lived process — an `epicrun` polling every
// minute — must see a release that appeared since its last round.
function reset_publish_cache(): void {
	published_cache.clear()
	version_cache.clear()
}

// Whether a version of the blocker's package has appeared in the registry.
function is_published(repo: string, version: string): boolean {
	const versions = published_versions(repo)
	if (versions === undefined) return false

	return propagate_publish.is_version_published(versions, version)
}

const GH_TIMEOUT_MS = 20_000
const SUCCESS_EXIT_CODE = 0
// The manifest arrives base64-encoded in the API's `content` field; `jq` decodes and reads it.
const VERSION_JQ = '.content | @base64d | fromjson | .version'

// The version another repository's default branch declares — the one its merge is about to publish.
//
// Read from GitHub rather than from a local checkout: a consumer's state is a GitHub fact, and the
// wait must work before anyone has cloned the repository. `josh bump minor` runs before the commit,
// so the version on the merged default branch is exactly the release that follows.
//
// Never "whatever is newest": a consumer several releases behind would be satisfied by any publish
// at all, including one that predates the change it is waiting for.
function fetch_default_branch_version(repo: string): string | undefined {
	const result = execaSync(
		'gh',
		['api', `${git_gh_api_path.repo_api_path(repo)}/contents/package.json`, '--jq', VERSION_JQ],
		{ reject: false, timeout: GH_TIMEOUT_MS },
	)
	if (result.exitCode !== SUCCESS_EXIT_CODE) return undefined
	const version = result.stdout.trim()

	return version === '' || version === 'null' ? undefined : version
}

// Read once per pass, for the reason `published_cache` holds the other half: every edge to one
// repository asks the same question, and joshuafolkken/kit#1121 made a pass run once per withheld
// candidate rather than once — so an uncached read is a blocking `gh` call multiplied by both.
function read_default_branch_version(repo: string): string | undefined {
	if (version_cache.has(repo)) return version_cache.get(repo)
	const version = fetch_default_branch_version(repo)

	version_cache.set(repo, version)

	return version
}

// A version that could not be read leaves the dependency waiting rather than resolved: not knowing
// what to wait for is not the same as having nothing to wait for.
//
// One gap this leaves is joshuafolkken/kit#1129's, and it opened when joshuafolkken/kit#1126 made this
// branch reachable at all: a closed blocker in a repository that ships no npm package waits forever,
// because there is no release for `is_published` to ever find. It is not fixed here because the
// registry read cannot tell "this package does not exist" from "the registry could not be read" —
// both arrive as `undefined` — and reading the second as the first would resolve a dependency on a
// rate limit, which is the one direction this guard may not fail in, since that answer starts work.
function publish_verdict(repo: string, version: string | undefined): DependencyVerdict {
	if (version === undefined) return 'time'

	return is_published(repo, version) ? 'resolved' : 'time'
}

// What a cross-repository dependency needs, and in what order it is asked.
//
// The evaluation is an AND, and the order matters: while the blocker is still open the registry is
// never consulted. An epic therefore never sits waiting on a publish from the moment it starts — the
// wait is "the previous child finished, now wait for its release", which is the only moment the
// question is meaningful.
function resolve_cross_repo(
	blocker: EpicChild,
	blocked: EpicChild,
	read_target_version: (repo: string) => string | undefined = read_default_branch_version,
): DependencyVerdict {
	if (blocker.state !== 'CLOSED') return 'inherit'
	if (blocker.repo === blocked.repo) return 'resolved'

	return publish_verdict(blocker.repo, read_target_version(blocker.repo))
}

// The owner half of an `owner/repo`, in the one place that splits it. Read straight off the string
// rather than through a URL parse: the callers need something to hand `is_same_owner_repo`, and a
// repository name that does not parse fails there rather than here.
function owner_of(repo: string): string {
	return repo.split('/', 1)[0] ?? ''
}

// Whether a repository may be depended on at all. Inherited from joshuafolkken/kit#869's
// restriction rather than restated: a child in a repository this owner does not own is not something
// to wait for, dispatch to, or write into — nor, since joshuafolkken/kit#1014, an issue reference to
// resolve: a body that mentions a third party's issue must not send this command to their tracker.
function is_same_owner_repo(repo: string, current_owner: string): boolean {
	const identity = repo_origin.parse_origin_url(`https://${repo_origin.GITHUB_HOST}/${repo}`)
	if (identity === undefined) return false

	return repo_map_logic.is_same_owner(identity, current_owner)
}

const epic_cross_repo = {
	read_default_branch_version,
	reset_publish_cache,
	package_name_for,
	is_published,
	resolve_cross_repo,
	owner_of,
	is_same_owner_repo,
}

export { epic_cross_repo }
