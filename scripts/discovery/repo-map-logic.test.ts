import { describe, expect, it } from 'vitest'
import { repo_map_logic, type DiscoveredRepo } from './repo-map-logic'

const OWNER = 'joshuafolkken'
const DEVELOPMENT = '/Users/example/Development'
const KIT_PATH = `${DEVELOPMENT}/kit`
const APP_KIT_PATH = `${DEVELOPMENT}/app-kit`
const FOREIGN_PATH = `${DEVELOPMENT}/client-project`
const KIT_KEY = 'joshuafolkken/kit'
const APP_KIT_REMOTE = 'git@github.com:joshuafolkken/app-kit.git'
const KIT_REMOTE = 'git@github.com:joshuafolkken/kit.git'
const FOREIGN_REMOTE = 'git@github.com:another-org/client-project.git'
const FAR_PATH = '/Users/example/elsewhere/far'
const A_KEY = 'joshuafolkken/a'
const A_PATH = `${DEVELOPMENT}/a`

// Materialized with a plain loop rather than a spread: the lint preset routes iterator spreads to
// `Iterator#toArray()`, which the ES2023 lib this project targets does not declare.
function keys_of(map: ReadonlyMap<string, string>): Array<string> {
	const keys: Array<string> = []

	for (const [key] of map) keys.push(key)

	return keys
}

function discovered(repository_path: string, origin_url: string | undefined): DiscoveredRepo {
	return { path: repository_path, origin_url }
}

describe('repo_map_logic.build_repository_map — the owner restriction', () => {
	it('keeps a sibling owned by the same account', () => {
		const map = repo_map_logic.build_repository_map(
			[discovered(APP_KIT_PATH, APP_KIT_REMOTE)],
			OWNER,
		)

		expect(map.get('joshuafolkken/app-kit')).toBe(APP_KIT_PATH)
	})

	it('excludes a sibling owned by another account or organization', () => {
		const map = repo_map_logic.build_repository_map(
			[discovered(FOREIGN_PATH, FOREIGN_REMOTE)],
			OWNER,
		)

		expect(map.size).toBe(0)
	})

	it('excludes a sibling whose remote is not on GitHub', () => {
		const map = repo_map_logic.build_repository_map(
			[discovered(FOREIGN_PATH, 'git@git.example.com:joshuafolkken/kit.git')],
			OWNER,
		)

		expect(map.size).toBe(0)
	})

	it('excludes a directory with no remote at all', () => {
		const map = repo_map_logic.build_repository_map([discovered(FOREIGN_PATH, undefined)], OWNER)

		expect(map.size).toBe(0)
	})

	it('compares owners case-insensitively, as GitHub does', () => {
		const map = repo_map_logic.build_repository_map(
			[discovered(APP_KIT_PATH, 'git@github.com:JoshuaFolkken/app-kit.git')],
			OWNER,
		)

		expect(map.size).toBe(1)
	})
})

describe('repo_map_logic.build_repository_map — the key comes from origin', () => {
	it('uses the repository name the remote declares, not the directory name', () => {
		const renamed = `${DEVELOPMENT}/kit-experiment`
		const map = repo_map_logic.build_repository_map([discovered(renamed, KIT_REMOTE)], OWNER)

		expect(map.get(KIT_KEY)).toBe(renamed)
		expect(map.has('joshuafolkken/kit-experiment')).toBe(false)
	})
})

describe('repo_map_logic.build_repository_map — overrides', () => {
	it('adds a repository that is not a sibling', () => {
		const map = repo_map_logic.build_repository_map([], OWNER, `joshuafolkken/far=${FAR_PATH}`)

		expect(map.get('joshuafolkken/far')).toBe(FAR_PATH)
	})

	it('wins over the discovered path for the same repository', () => {
		const second = `${KIT_PATH}-second-checkout`
		const map = repo_map_logic.build_repository_map(
			[discovered(KIT_PATH, KIT_REMOTE)],
			OWNER,
			`${KIT_KEY}=${second}`,
		)

		expect(map.get(KIT_KEY)).toBe(second)
	})

	it('accepts several entries separated by commas', () => {
		const map = repo_map_logic.build_repository_map(
			[],
			OWNER,
			`${A_KEY}=${A_PATH},joshuafolkken/b=${DEVELOPMENT}/b`,
		)

		expect(map.size).toBe(2)
	})
})

describe('repo_map_logic.build_repository_map — an override cannot lift the restriction', () => {
	it('cannot add a repository owned by anyone else', () => {
		const map = repo_map_logic.build_repository_map([], OWNER, `another-org/client=${FAR_PATH}`)

		expect(map.size).toBe(0)
	})

	it('cannot smuggle another owner in behind a valid entry', () => {
		const map = repo_map_logic.build_repository_map(
			[],
			OWNER,
			`${A_KEY}=${A_PATH},another-org/b=${DEVELOPMENT}/b`,
		)

		expect(keys_of(map)).toEqual([A_KEY])
	})

	it('drops a malformed entry instead of failing the whole map', () => {
		const map = repo_map_logic.build_repository_map([], OWNER, `not-a-pair,${A_KEY}=${A_PATH}`)

		expect(keys_of(map)).toEqual([A_KEY])
	})

	it('ignores an unset override variable', () => {
		expect(repo_map_logic.build_repository_map([], OWNER).size).toBe(0)
	})
})

describe('repo_map_logic.is_same_owner', () => {
	it('accepts the current owner', () => {
		expect(repo_map_logic.is_same_owner({ owner: OWNER, repo: 'kit' }, OWNER)).toBe(true)
	})

	it('rejects every other owner', () => {
		expect(repo_map_logic.is_same_owner({ owner: 'another-org', repo: 'kit' }, OWNER)).toBe(false)
	})
})
