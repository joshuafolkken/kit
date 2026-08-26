import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { repo_map_logic, type DiscoveredRepo, type RepoMap } from './repo-map-logic'
import { repo_origin } from './repo-origin'

// Finding which repositories sit next to this one, and where.
//
// Discovery is automatic by default rather than registered in a config file: on the machine this was
// written for, every first-party repository is a sibling of every other, so scanning the current
// repository's parent one level deep produces the same map from whichever of them the command runs
// in. `JOSH_REPO_PATHS` exists only for the exceptions (joshuafolkken/kit#869).

const GIT_DIRECTORY = '.git'
const GIT_CONFIG = 'config'
// A `.git` *file* points at the real git directory (`gitdir: …`), which is how worktrees and
// submodules are laid out. The pointer is relative to the work tree when it is not absolute.
const GITDIR_PREFIX = 'gitdir:'
// A linked worktree's git directory is `<main>/.git/worktrees/<name>`, which holds no `config` of
// its own — the shared one lives in the common directory that its `commondir` file names, relative
// to the worktree's git directory. A submodule's git directory has no `commondir` and holds its
// own `config`, which is why following the pointer alone appeared to work.
const COMMON_DIRECTORY_FILE = 'commondir'
const OVERRIDE_ENV_KEY = 'JOSH_REPO_PATHS'

// The directory a git directory's `config` actually lives in: itself, or the common directory a
// linked worktree points at.
function resolve_common_directory(git_directory: string): string {
	const pointer = path.join(git_directory, COMMON_DIRECTORY_FILE)
	if (!existsSync(pointer)) return git_directory

	try {
		return path.resolve(git_directory, readFileSync(pointer, 'utf8').trim())
	} catch {
		return git_directory
	}
}

// Where a `.git` file points. Relative pointers resolve against the work tree holding the file.
function follow_git_file(repository_path: string, git_file: string): string | undefined {
	const pointer = readFileSync(git_file, 'utf8').trim()
	if (!pointer.startsWith(GITDIR_PREFIX)) return undefined

	return path.resolve(repository_path, pointer.slice(GITDIR_PREFIX.length).trim())
}

// The directory holding the `config` for a work tree: `.git` itself, or — through a `.git` file and
// then through `commondir` — the shared git directory a linked worktree borrows its remotes from.
function resolve_git_directory(repository_path: string): string | undefined {
	const candidate = path.join(repository_path, GIT_DIRECTORY)
	if (!existsSync(candidate)) return undefined

	try {
		if (statSync(candidate).isDirectory()) return candidate
		const linked = follow_git_file(repository_path, candidate)

		return linked === undefined ? undefined : resolve_common_directory(linked)
	} catch {
		return undefined
	}
}

// The `origin` URL a work tree declares, or nothing when it has no `origin`, no readable config, or
// is not a work tree at all. Every failure reads as "no remote" so one unreadable sibling cannot
// fail a command whose contract is to report what it could find.
function read_origin_url(repository_path: string): string | undefined {
	const git_directory = resolve_git_directory(repository_path)
	if (git_directory === undefined) return undefined

	try {
		return repo_origin.parse_origin_from_config(
			readFileSync(path.join(git_directory, GIT_CONFIG), 'utf8'),
		)
	} catch {
		return undefined
	}
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

// The map for the repository at `repository_path`. Empty when that repository's own owner cannot be
// determined: without it there is nothing to compare siblings against, and a map built without the
// owner restriction is exactly what must never be produced.
function discover_repositories(repository_path: string, environment = process.env): RepoMap {
	const current_owner = resolve_current_owner(repository_path)
	if (current_owner === undefined) return new Map<string, string>()

	return repo_map_logic.build_repository_map(
		scan_siblings(path.dirname(repository_path)),
		current_owner,
		environment[OVERRIDE_ENV_KEY],
	)
}

const repo_discovery = {
	OVERRIDE_ENV_KEY,
	read_origin_url,
	resolve_current_owner,
	scan_siblings,
	discover_repositories,
}

export { repo_discovery }
