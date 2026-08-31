import { repo_map_logic } from '#scripts/discovery/repo-map-logic'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { git_gh_api_path } from '#scripts/git/git-gh-api-path'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
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
const version_cache = new Map<string, ManifestAnswer>()

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
const VERSION_JQ = '.content | @base64d | fromjson | {version, private} | tojson'
const NOT_FOUND_STATUS = 404

// What the blocker repository's default branch says about what it ships.
//
// **`absent` is not `unreadable`, and joshuafolkken/kit#1129 is the difference.** A repository with no
// manifest, or one whose manifest says `private`, publishes nothing — so a closed blocker there has
// no release anyone could wait for, and waiting means waiting until the run's own eight-hour timeout
// with nothing an operator can edit to clear it. A read that merely failed says none of that.
//
// **It is read from the repository rather than from the registry, and that is the whole design.** The
// registry answers 404 both for a package that was never published *and* for one this token may not
// see — a renamed repository, a private package, a missing `read:packages` scope — so resolving on a
// registry 404 would start a consumer child before its blocker's release existed. The manifest is a
// fact about the repository we already have access to, and `private: true` is a positive statement
// rather than an inference from an absence.
type ManifestAnswer =
	| { kind: 'manifest'; version: string | undefined; is_private: boolean }
	| { kind: 'absent' }
	| { kind: 'unreadable' }

// The version another repository's default branch declares — the one its merge is about to publish.
//
// Read from GitHub rather than from a local checkout: a consumer's state is a GitHub fact, and the
// wait must work before anyone has cloned the repository. `josh bump minor` runs before the commit,
// so the version on the merged default branch is exactly the release that follows.
//
// Never "whatever is newest": a consumer several releases behind would be satisfied by any publish
// at all, including one that predates the change it is waiting for.
function manifest_path(repo: string): string {
	return `${git_gh_api_path.repo_api_path(repo)}/contents/package.json`
}

function to_manifest(stdout: string): ManifestAnswer {
	try {
		const parsed: unknown = JSON.parse(stdout.trim())
		if (typeof parsed !== 'object' || parsed === null) return { kind: 'unreadable' }
		const fields = parsed as { version?: unknown; private?: unknown }

		return {
			kind: 'manifest',
			version: typeof fields.version === 'string' ? fields.version : undefined,
			// Strictly the boolean, which is the only form npm defines. A looser test — a truthy string,
			// say — would call *more* repositories "ships nothing", and that is the unsafe direction here:
			// answering it wrongly resolves a dependency and starts a child before its blocker's release.
			// A manifest that misspells `private` therefore waits, which is the failure that is merely
			// slow rather than the one that is wrong.
			is_private: fields.private === true,
		}
	} catch {
		return { kind: 'unreadable' }
	}
}

// Why the read failed, asked only when it did. The status line is the protocol rather than prose, so
// a missing manifest is told from a rate limit by matching a contract instead of a message — through
// `git_gh_exec.parse_status_line` rather than a second copy of it.
//
// `git_gh_exec.exec_gh_api_status` asks the same question and is **not** reused: it is async, and
// every caller down to `resolve_cross_repo` is synchronous. What is worth sharing is the parser,
// which is shared; the spawn is four lines and duplicating it costs less than turning the
// classifier, the resolver and `epic_classify` async for one probe. A 404 here is trustworthy in a way
// a registry 404 is not: the repository's issues are already being read, so access is established and
// what is missing is the file.
function classify_manifest_failure(repo: string): ManifestAnswer {
	const probe = execaSync('gh', ['api', '--include', '--silent', manifest_path(repo)], {
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})

	return git_gh_exec.parse_status_line(probe.stdout) === NOT_FOUND_STATUS
		? { kind: 'absent' }
		: { kind: 'unreadable' }
}

function fetch_manifest(repo: string): ManifestAnswer {
	const result = execaSync('gh', ['api', manifest_path(repo), '--jq', VERSION_JQ], {
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})

	return result.exitCode === SUCCESS_EXIT_CODE
		? to_manifest(result.stdout)
		: classify_manifest_failure(repo)
}

// Read once per pass, for the reason `published_cache` holds the other half: every edge to one
// repository asks the same question, and joshuafolkken/kit#1121 made a pass run once per withheld
// candidate rather than once — so an uncached read is a blocking `gh` call multiplied by both.
function read_manifest(repo: string): ManifestAnswer {
	const cached = version_cache.get(repo)
	if (cached !== undefined) return cached
	const answer = fetch_manifest(repo)

	version_cache.set(repo, answer)

	return answer
}

// The version the default branch declares, for a caller that only wants that.
function read_default_branch_version(repo: string): string | undefined {
	const answer = read_manifest(repo)

	return answer.kind === 'manifest' ? answer.version : undefined
}

// Whether the repository ships no package at all: no manifest on its default branch, or one that
// declares itself private. Either way there is no release for a dependency to wait on.
//
// **The root manifest is the whole of what is read, and that is an assumption worth naming.** A
// workspace root is private by convention while its packages publish, so such a repository would be
// read as shipping nothing and its dependents would start early — the direction this module may not
// fail in. No first-party repository is shaped that way today — app-kit, game-kit and
// joshuafolkken-com were checked when this landed — and the package name this module derives is the
// repository's own, so a workspace would break the derivation before it reached here. Reading the
// workspace members is joshuafolkken/kit#1134's if one ever appears.
function publishes_nothing(repo: string): boolean {
	const answer = read_manifest(repo)

	return answer.kind === 'absent' || (answer.kind === 'manifest' && answer.is_private)
}

// A version that could not be read leaves the dependency waiting rather than resolved: not knowing
// what to wait for is not the same as having nothing to wait for.
//
// **"Ships nothing" is asked first, and it is a different question** (joshuafolkken/kit#1129, the
// state joshuafolkken/kit#1126 made reachable). Waiting is right only where something could still
// arrive; a closed blocker in a repository that publishes no package has no release for
// `is_published` to ever find, so it waited until the run's own eight-hour timeout with nothing an
// operator could edit to clear it. It is answered from that repository's own manifest and never from
// the registry, for the reason `ManifestAnswer` records: a registry 404 also means "this token may
// not see it", and resolving on one would start a consumer child before its blocker's release
// existed.
function publish_verdict(repo: string, version: string | undefined): DependencyVerdict {
	if (publishes_nothing(repo)) return 'resolved'
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
	publishes_nothing,
	read_manifest,
	read_default_branch_version,
	reset_publish_cache,
	package_name_for,
	is_published,
	resolve_cross_repo,
	owner_of,
	is_same_owner_repo,
}

export { epic_cross_repo }
