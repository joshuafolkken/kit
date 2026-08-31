import { repo_map_logic } from '#scripts/discovery/repo-map-logic'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { git_gh_api_path } from '#scripts/git/git-gh-api-path'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { propagate_publish } from '#scripts/propagate/propagate-publish'
import { derive_versions_endpoint } from '#scripts/version/version-command-config'
import { execaSync } from 'execa'
import { load } from 'js-yaml'
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
const VERSION_JQ = '.content | @base64d | fromjson | {version, private, workspaces} | tojson'
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml'
const WORKSPACE_JQ = '.content | @base64d'
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
// **`private` alone does not settle it** (joshuafolkken/kit#1134). A workspace root is private by
// convention while the packages under it publish, so reading one as "ships nothing" would resolve a
// dependency before its blocker's release existed — the direction this module may not fail in.
// `is_workspace` is what keeps that case waiting.
type ManifestAnswer =
	| { kind: 'manifest'; version: string | undefined; is_private: boolean; is_workspace: boolean }
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

// What the layout question answered. `unreadable` is a third answer rather than a boolean's loser:
// a probe that failed says nothing about the layout, and laundering it into "is a workspace" turns
// one transient read into a permanent wait.
type WorkspaceCheck = 'workspace' | 'single' | 'unreadable'

// Whether `pnpm-workspace.yaml` actually declares members.
//
// **The file's existence proves nothing.** `josh sync` distributes it to every consumer regardless of
// layout — it carries `allowBuilds`, `overrides` and the like — so probing for its presence read every
// private first-party repository as a workspace and restored joshuafolkken/kit#1129's eight-hour wait
// for all of them. Measured: 20 of 20 private first-party checkouts have the file and none declares
// `packages:` (joshuafolkken/kit#1134). What makes a repository a workspace is a non-empty `packages`
// key, so that is what is read.
function declares_packages(yaml: string): boolean {
	try {
		const parsed: unknown = load(yaml)
		if (typeof parsed !== 'object' || parsed === null) return false
		const { packages } = parsed as { packages?: unknown }

		return Array.isArray(packages) && packages.length > 0
	} catch {
		return false
	}
}

function pnpm_workspace_path(repo: string): string {
	return `${git_gh_api_path.repo_api_path(repo)}/contents/${PNPM_WORKSPACE_FILE}`
}

// A read that failed for any reason other than a missing file leaves the layout unknown.
function classify_workspace_failure(repo: string): WorkspaceCheck {
	const probe = execaSync('gh', ['api', '--include', '--silent', pnpm_workspace_path(repo)], {
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})

	return git_gh_exec.parse_status_line(probe.stdout) === NOT_FOUND_STATUS ? 'single' : 'unreadable'
}

function read_pnpm_workspace(repo: string): WorkspaceCheck {
	const result = execaSync('gh', ['api', pnpm_workspace_path(repo), '--jq', WORKSPACE_JQ], {
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})
	if (result.exitCode !== SUCCESS_EXIT_CODE) return classify_workspace_failure(repo)

	return declares_packages(result.stdout) ? 'workspace' : 'single'
}

// Whether the repository declares a workspace. `workspaces` covers npm and yarn; pnpm keeps its
// members in `pnpm-workspace.yaml` and leaves the manifest without the field, so that file is read —
// but only in the one case where the answer can still change the verdict, which is a private root
// with no `workspaces` entries. A public root publishes, and a private non-workspace root does not,
// whatever the file would say.
//
// `null` counts as absent, not as a declaration: `jq`'s `{version, private, workspaces}` shorthand
// emits an explicit `"workspaces": null` for a manifest with no such key, so testing only against
// `undefined` read every private repository as a workspace.
// Whether the manifest's own `workspaces` field settles it. `null` counts as absent rather than as a
// declaration; an empty array is a workspace that lists nothing, which is not one.
function declared_workspaces(declared: unknown): WorkspaceCheck | undefined {
	if (declared === undefined || declared === null) return undefined
	if (Array.isArray(declared)) return declared.length > 0 ? 'workspace' : 'single'

	return 'workspace'
}

function workspace_check(repo: string, fields: { workspaces?: unknown }): WorkspaceCheck {
	return declared_workspaces(fields.workspaces) ?? read_pnpm_workspace(repo)
}

interface ManifestFields {
	version?: unknown
	private?: unknown
	workspaces?: unknown
}

// The fields read out of a manifest that parsed. `is_private` is strictly the boolean, which is the
// only form npm defines: a looser test — a truthy string, say — would call *more* repositories "ships
// nothing", and that is the unsafe direction here, because answering it wrongly resolves a dependency
// and starts a child before its blocker's release. A manifest that misspells `private` therefore
// waits, which is the failure that is merely slow rather than the one that is wrong.
function to_answer(repo: string, fields: ManifestFields): ManifestAnswer {
	const version = typeof fields.version === 'string' ? fields.version : undefined

	if (fields.private !== true) {
		return { kind: 'manifest', version, is_private: false, is_workspace: false }
	}

	const check = workspace_check(repo, fields)
	// A layout nobody could read is not a repository that ships nothing. Answering `unreadable` keeps
	// the dependency waiting, which is the direction that merely costs time.
	if (check === 'unreadable') return { kind: 'unreadable' }

	return { kind: 'manifest', version, is_private: true, is_workspace: check === 'workspace' }
}

function to_manifest(repo: string, stdout: string): ManifestAnswer {
	try {
		const parsed: unknown = JSON.parse(stdout.trim())
		if (typeof parsed !== 'object' || parsed === null) return { kind: 'unreadable' }

		return to_answer(repo, parsed)
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
		? to_manifest(repo, result.stdout)
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
// **A workspace root is excluded, and the exclusion is deliberately coarse** (joshuafolkken/kit#1134).
// Such a root is private by convention while its packages publish, so reading one as shipping nothing
// would start a dependent before its blocker's release existed. What is asked is only whether the
// repository *is* a workspace — the members are not enumerated and nothing looks for which of them
// publishes, so a workspace whose members are all private waits when it need not. That is the safe
// direction: waiting ends at the run's own timeout, resolving early does not end at all.
function publishes_nothing(repo: string): boolean {
	const answer = read_manifest(repo)

	if (answer.kind === 'absent') return true

	return answer.kind === 'manifest' && answer.is_private && !answer.is_workspace
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
