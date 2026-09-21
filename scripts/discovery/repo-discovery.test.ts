import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { repo_discovery } from './repo-discovery'

const KIT = 'kit'
const APP_KIT = 'app-kit'
const KIT_REMOTE = 'git@github.com:joshuafolkken/kit.git'
const APP_KIT_REMOTE = 'git@github.com:joshuafolkken/app-kit.git'
const APP_KIT_KEY = 'joshuafolkken/app-kit'
const KIT_KEY = 'joshuafolkken/kit'
const GIT = '.git'
const CONFIG = 'config'
const SELF_HOSTED_REMOTE = 'git@git.example.com:joshuafolkken/kit.git'
const KIT_WORKTREE = 'kit-worktree'
const FAR_PATH = '/Users/example/elsewhere/far'

const state = { workspace: '' }

// A directory holding a git work tree whose `.git/config` declares `origin_url`, or a work tree with
// no remote at all when the remote is omitted.
function make_repository(name: string, origin_url?: string): string {
	const repository_path = path.join(state.workspace, name)

	mkdirSync(path.join(repository_path, GIT), { recursive: true })
	const remote = origin_url === undefined ? '' : `[remote "origin"]\n\turl = ${origin_url}\n`

	writeFileSync(path.join(repository_path, GIT, CONFIG), `[core]\n\tbare = false\n${remote}`)

	return repository_path
}

// The layout `git worktree add` produces: the work tree holds a `.git` *file* pointing at
// `<main>/.git/worktrees/<name>`, and that directory holds no `config` — only a `commondir` naming
// the shared git directory the remotes actually live in.
function make_worktree(main_repository: string, name: string): string {
	const git_directory = path.join(main_repository, GIT, 'worktrees', name)
	const work_tree = path.join(state.workspace, name)

	mkdirSync(git_directory, { recursive: true })
	writeFileSync(path.join(git_directory, 'commondir'), '../..\n')
	mkdirSync(work_tree, { recursive: true })
	writeFileSync(path.join(work_tree, GIT), `gitdir: ${git_directory}\n`)

	return work_tree
}

// A linked work tree parked away from its main checkout, as a lane is: the work tree sits under
// `<main>/.kit-lanes/<name>`, so its own parent holds none of the repository's siblings — only the
// main tree's parent does. Its `.git` file points at `<main>/.git/worktrees/<name>`, whose
// `commondir` resolves back to `<main>/.git`, so discovery must walk up to `<main>` to find them.
function make_parked_worktree(main_repository: string, name: string): string {
	const git_directory = path.join(main_repository, GIT, 'worktrees', name)
	const work_tree = path.join(main_repository, '.kit-lanes', name)

	mkdirSync(git_directory, { recursive: true })
	writeFileSync(path.join(git_directory, 'commondir'), '../..\n')
	mkdirSync(work_tree, { recursive: true })
	writeFileSync(path.join(work_tree, GIT), `gitdir: ${git_directory}\n`)

	return work_tree
}

function keys_of(map: ReadonlyMap<string, string>): Array<string> {
	const keys: Array<string> = []

	for (const [key] of map) keys.push(key)

	return keys
}

beforeEach(() => {
	state.workspace = mkdtempSync(path.join(tmpdir(), 'repo-discovery-'))
})

afterEach(() => {
	rmSync(state.workspace, { recursive: true, force: true })
})

describe('repo_discovery.read_origin_url', () => {
	it('reads the origin of a work tree', () => {
		const repository = make_repository(KIT, KIT_REMOTE)

		expect(repo_discovery.read_origin_url(repository)).toBe(KIT_REMOTE)
	})

	it('reads the shared config of a linked worktree, which holds none of its own', () => {
		const linked = make_worktree(make_repository(KIT, KIT_REMOTE), KIT_WORKTREE)

		expect(repo_discovery.read_origin_url(linked)).toBe(KIT_REMOTE)
	})

	it('follows a .git file into a git directory that holds its own config, as a submodule does', () => {
		const embedded = path.join(state.workspace, 'embedded-git')
		const consumer = path.join(state.workspace, 'consumer')

		mkdirSync(embedded, { recursive: true })
		writeFileSync(path.join(embedded, CONFIG), `[remote "origin"]\n\turl = ${KIT_REMOTE}\n`)
		mkdirSync(consumer, { recursive: true })
		writeFileSync(path.join(consumer, GIT), `gitdir: ${embedded}\n`)

		expect(repo_discovery.read_origin_url(consumer)).toBe(KIT_REMOTE)
	})

	it('returns nothing for a directory that is not a work tree', () => {
		const plain = path.join(state.workspace, 'notes')

		mkdirSync(plain, { recursive: true })

		expect(repo_discovery.read_origin_url(plain)).toBeUndefined()
	})

	it('returns nothing for a work tree that declares no origin', () => {
		expect(repo_discovery.read_origin_url(make_repository('local-only'))).toBeUndefined()
	})
})

// Where to look for a repository's siblings. A linked work tree is parked wherever it was created —
// a lane lives among that repository's other lanes — so its own parent holds no sibling at all.
describe('repo_discovery.main_worktree', () => {
	it('is the given path for an ordinary checkout', () => {
		const kit = make_repository(KIT, KIT_REMOTE)

		expect(repo_discovery.main_worktree(kit)).toBe(kit)
	})

	it('is the main work tree for a linked one', () => {
		const kit = make_repository(KIT, KIT_REMOTE)

		expect(repo_discovery.main_worktree(make_worktree(kit, KIT_WORKTREE))).toBe(kit)
	})

	// A submodule resolves to `<super>/.git/modules/<path>`, whose parent is not a work tree, so the
	// given path is the only honest answer.
	it('is the given path for a submodule, whose git directory has no work tree for a parent', () => {
		const embedded = path.join(state.workspace, GIT, 'modules', 'vendor', KIT)
		const consumer = path.join(state.workspace, 'vendor', KIT)

		mkdirSync(embedded, { recursive: true })
		writeFileSync(path.join(embedded, CONFIG), `[remote "origin"]\n\turl = ${KIT_REMOTE}\n`)
		mkdirSync(consumer, { recursive: true })
		writeFileSync(path.join(consumer, GIT), `gitdir: ${embedded}\n`)

		expect(repo_discovery.main_worktree(consumer)).toBe(consumer)
	})

	it('is the given path for a directory that is not a work tree', () => {
		const plain = path.join(state.workspace, 'notes')

		mkdirSync(plain, { recursive: true })

		expect(repo_discovery.main_worktree(plain)).toBe(plain)
	})
})

describe('repo_discovery.resolve_current_owner', () => {
	it('takes the owner from the repository own origin', () => {
		expect(repo_discovery.resolve_current_owner(make_repository(KIT, KIT_REMOTE))).toBe(
			'joshuafolkken',
		)
	})

	it('cannot determine an owner without a GitHub origin', () => {
		expect(
			repo_discovery.resolve_current_owner(make_repository(KIT, SELF_HOSTED_REMOTE)),
		).toBeUndefined()
	})
})

describe('repo_discovery.discover_repositories — what the scan finds', () => {
	it('maps every sibling owned by the same account', () => {
		const kit = make_repository(KIT, KIT_REMOTE)
		const app_kit = make_repository(APP_KIT, 'https://github.com/joshuafolkken/app-kit.git')
		const map = repo_discovery.discover_repositories(kit, {})

		expect(map.get(KIT_KEY)).toBe(kit)
		expect(map.get(APP_KIT_KEY)).toBe(app_kit)
	})

	it('keys a checkout by its origin rather than by its directory name', () => {
		const kit = make_repository(KIT, KIT_REMOTE)
		const renamed = make_repository('kit-experiment', 'git@github.com:joshuafolkken/game-kit.git')

		expect(repo_discovery.discover_repositories(kit, {}).get('joshuafolkken/game-kit')).toBe(
			renamed,
		)
	})
})

// A lane is a linked work tree parked among its repository's other lanes, so scanning its own parent
// finds none of the siblings; discovery has to anchor on the main work tree, which is what every
// caller running in a lane (`doctor`, `propagate`, `backlog:next`, `epic:next`, `clone:scan`) relies
// on (joshuafolkken/kit#2233).
describe('repo_discovery.discover_repositories — called from within a lane', () => {
	it('finds the siblings beside the main work tree, not those beside the lane', () => {
		const kit = make_repository(KIT, KIT_REMOTE)
		const app_kit = make_repository(APP_KIT, APP_KIT_REMOTE)
		const lane = make_parked_worktree(kit, '2233')

		const map = repo_discovery.discover_repositories(lane, {})

		expect(map.get(KIT_KEY)).toBe(kit)
		expect(map.get(APP_KIT_KEY)).toBe(app_kit)
	})
})

describe('repo_discovery.discover_repositories — what the scan refuses', () => {
	it('excludes siblings owned by anyone else, whatever else shares the parent', () => {
		const kit = make_repository(KIT, KIT_REMOTE)

		make_repository('client-project', 'git@github.com:another-org/client-project.git')
		make_repository('self-hosted', SELF_HOSTED_REMOTE)
		make_repository('no-remote')

		expect(keys_of(repo_discovery.discover_repositories(kit, {}))).toEqual([KIT_KEY])
	})

	it('produces an empty map when the current repository own owner is unknown', () => {
		const repository = make_repository(KIT, SELF_HOSTED_REMOTE)

		make_repository(APP_KIT, APP_KIT_REMOTE)

		expect(repo_discovery.discover_repositories(repository, {}).size).toBe(0)
	})
})

describe('repo_discovery.discover_repositories — one repository, one entry', () => {
	// GitHub resolves owner and repository names case-insensitively, so a remote spelled differently
	// is the same repository. Two entries would mean an override no longer replaces what it names.
	it('does not add a second entry for a remote spelled with different casing', () => {
		const kit = make_repository(KIT, 'git@github.com:JoshuaFolkken/Kit.git')
		const environment = { [repo_discovery.OVERRIDE_ENV_KEY]: `${KIT_KEY}=${FAR_PATH}` }
		const map = repo_discovery.discover_repositories(kit, environment)

		expect(keys_of(map)).toEqual([KIT_KEY])
		expect(map.get(KIT_KEY)).toBe(FAR_PATH)
	})
})

describe('repo_discovery.discover_repositories — two checkouts of one repository', () => {
	// Which checkout wins must not depend on the order the filesystem hands the directories back in.
	it('keeps the last in name order, whichever the scan happened to reach first', () => {
		const first = make_repository('a-kit', KIT_REMOTE)
		const last = make_repository('z-kit', KIT_REMOTE)
		const map = repo_discovery.discover_repositories(first, {})

		expect(map.get(KIT_KEY)).toBe(last)
	})
})

describe('repo_discovery.discover_repositories — the override variable', () => {
	it('adds a repository the scan could not reach', () => {
		const kit = make_repository(KIT, KIT_REMOTE)
		const environment = { [repo_discovery.OVERRIDE_ENV_KEY]: `joshuafolkken/far=${FAR_PATH}` }

		expect(repo_discovery.discover_repositories(kit, environment).get('joshuafolkken/far')).toBe(
			FAR_PATH,
		)
	})

	it('refuses an entry naming another owner', () => {
		const kit = make_repository(KIT, KIT_REMOTE)
		const environment = { [repo_discovery.OVERRIDE_ENV_KEY]: `another-org/far=${FAR_PATH}` }

		expect(keys_of(repo_discovery.discover_repositories(kit, environment))).toEqual([KIT_KEY])
	})
})
