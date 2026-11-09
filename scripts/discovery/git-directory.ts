import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// A work tree's common git directory, read from the filesystem alone — no `git` process and no import
// beyond `node:` — so the vitest config can ask it at load (`unit-run-marker.ts`) without widening
// every `vitest related` run to the whole suite (joshuafolkken/kit#6916). `repo-discovery.ts` reads
// its siblings' configs through the same walk.

const GIT_DIRECTORY = '.git'
// A `.git` *file* points at the real git directory (`gitdir: …`), which is how worktrees and
// submodules are laid out. The pointer is relative to the work tree when it is not absolute.
const GITDIR_PREFIX = 'gitdir:'
// A linked worktree's git directory is `<main>/.git/worktrees/<name>`, which holds no `config` of
// its own — the shared one lives in the common directory that its `commondir` file names, relative
// to the worktree's git directory. A submodule's git directory has no `commondir` and holds its
// own `config`, which is why following the pointer alone appeared to work.
const COMMON_DIRECTORY_FILE = 'commondir'

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

const git_directory = {
	GIT_DIRECTORY,
	resolve_git_directory,
}

export { git_directory }
