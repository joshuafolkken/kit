import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { git_directory } from './git-directory'
import { repo_map_logic, type DiscoveredRepo, type RepoMap } from './repo-map-logic'
import { repo_origin } from './repo-origin'

// Finding which repositories sit next to this one, and where.
//
// Discovery is automatic by default rather than registered in a config file: on the machine this was
// written for, every first-party repository is a sibling of every other, so scanning the current
// repository's parent one level deep produces the same map from whichever of them the command runs
// in. `JOSH_REPO_PATHS` exists only for the exceptions.

const { GIT_DIRECTORY, resolve_git_directory } = git_directory
const GIT_CONFIG = 'config'
const OVERRIDE_ENV_KEY = 'JOSH_REPO_PATHS'

function read_text(file: string): string | undefined {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return undefined
	}
}

// Each work tree's git directory and each config's text, read again only once the `.git` entry or the
// config itself has changed: `run:board` cites issues through the origin on every redraw
// (joshuafolkken/kit#4263).
const git_directories = stamped_memo.create<string | undefined>()
const configs = stamped_memo.create<string | undefined>()

// The work tree's git config text, or nothing when it is unreadable or not a work tree.
function read_config(repository_path: string): string | undefined {
	const git_entry = path.join(repository_path, GIT_DIRECTORY)
	const resolved = git_directories.of(repository_path, stamped_memo.file_stamp(git_entry), () =>
		resolve_git_directory(repository_path),
	)
	if (resolved === undefined) return undefined

	const config = path.join(resolved, GIT_CONFIG)

	return configs.of(config, stamped_memo.file_stamp(config), () => read_text(config))
}

// The `origin` URL a work tree declares, or nothing when it has no `origin`, no readable config, or
// is not a work tree at all. Every failure reads as "no remote" so one unreadable sibling cannot
// fail a command whose contract is to report what it could find.
function read_origin_url(repository_path: string): string | undefined {
	const config = read_config(repository_path)

	return config === undefined ? undefined : repo_origin.parse_origin_from_config(config)
}

// The `url` of every remote the work tree declares, with the same "unreadable reads as none" contract
// as `read_origin_url`.
function read_remote_urls(repository_path: string): Array<string> {
	const config = read_config(repository_path)

	return config === undefined ? [] : repo_origin.parse_remote_urls_from_config(config)
}

// Every immediate child directory of `parent`, in name order. An unreadable parent yields nothing
// rather than throwing: `josh doctor` reports what it could find, and a permission error on the
// parent is not a broken install.
//
// Sorted because the map keeps the last entry for a repository, and two directories can hold the
// same one — the second checkout the override variable exists for. Left in `readdir` order, which
// checkout won would depend on the filesystem, so the same machine could answer differently after a
// directory was renamed.
function sibling_directories(parent: string): Array<string> {
	try {
		return readdirSync(parent, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(parent, entry.name))
			.toSorted((left, right) => left.localeCompare(right))
	} catch {
		return []
	}
}

// Every immediate child of `parent` that holds a git work tree, paired with its `origin`. One level
// only: a deeper walk would cross into `node_modules` and vendored checkouts, which are not
// repositories anyone dispatches work to.
function scan_siblings(parent: string): Array<DiscoveredRepo> {
	return sibling_directories(parent).map((repository_path) => ({
		path: repository_path,
		origin_url: read_origin_url(repository_path),
	}))
}

// The owner half of a repository's own `origin`. Read locally rather than asked of `gh`, so the map
// is built without a network call and without an authenticated CLI.
function resolve_current_owner(repository_path: string): string | undefined {
	const origin_url = read_origin_url(repository_path)
	if (origin_url === undefined) return undefined

	return repo_origin.parse_origin_url(origin_url)?.owner
}

// The work tree a repository's siblings sit beside: the given path for an ordinary checkout, and the
// **main** work tree for a linked one. A linked work tree is parked wherever it was created — a lane
// lives under `.kit-lanes/`, whose only neighbors are that repository's other lanes — so taking the
// given path's parent as the place to look for siblings finds none of them. The common directory
// `resolve_git_directory` already follows is `<main>/.git`, so its parent is that main work tree.
//
// **Only when the resolved directory is itself a `.git`.** A submodule resolves to
// `<super>/.git/modules/<path>`, and a bare main repository to `<somewhere>/<name>.git`; neither has
// a work tree for a parent, so taking one would hand discovery a directory that is not a checkout at
// all — the very failure this function exists to close, moved somewhere else.
function main_worktree(repository_path: string): string {
	const resolved = resolve_git_directory(repository_path)

	if (resolved === undefined || path.basename(resolved) !== GIT_DIRECTORY) return repository_path

	return path.dirname(resolved)
}

// The map for the repository at `repository_path`. Empty when that repository's own owner cannot be
// determined: without it there is nothing to compare siblings against, and a map built without the
// owner restriction is exactly what must never be produced.
//
// **Discovery is anchored on the main work tree, resolved here rather than by each caller.** A linked
// work tree — a lane — is parked among that repository's other lanes, so scanning *its* parent finds
// none of the siblings; `main_worktree` turns the given path into the main checkout, whose parent
// holds them. Every command that discovers repositories (`doctor`, `propagate`, `backlog:next`,
// `epic:next`, `clone:scan`) goes through here, so the anchor lives in one place instead of being
// re-applied at each call site. For an ordinary checkout, a submodule or a non-repository the
// resolution is a no-op (`main_worktree` returns the given path), so nothing but a lane is affected.
function discover_repositories(repository_path: string, environment = process.env): RepoMap {
	const main = main_worktree(repository_path)
	const current_owner = resolve_current_owner(main)
	if (current_owner === undefined) return new Map<string, string>()

	return repo_map_logic.build_repository_map(
		scan_siblings(path.dirname(main)),
		current_owner,
		environment[OVERRIDE_ENV_KEY],
	)
}

const repo_discovery = {
	OVERRIDE_ENV_KEY,
	main_worktree,
	read_origin_url,
	read_remote_urls,
	resolve_current_owner,
	scan_siblings,
	discover_repositories,
}

export { repo_discovery }
