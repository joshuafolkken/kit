import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm_registry } from '#scripts/version/npm-registry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths_mock = vi.hoisted(() => ({ root: '' }))
const make_directory = temporary_directory()
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

vi.mock('./init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	PACKAGE_DIR: REPOSITORY_ROOT,
	package_path: (relative_path: string): string => path.join(REPOSITORY_ROOT, relative_path),
}))
vi.mock('#scripts/gh/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner: vi.fn() },
}))
vi.mock('./init-sonar', () => ({ init_sonar: { copy_sonar_with_template: vi.fn() } }))

const { init_ai_copy } = await import('./init-ai-copy')

const PUBLISH_WORKFLOW = '.github/workflows/publish.yml'
const PUBLISHED_PACKAGE = '@joshuafolkken/app-kit'

function project_file(name: string): string {
	return path.join(paths_mock.root, name)
}

beforeEach(() => {
	paths_mock.root = make_directory('init-publish-')
	writeFileSync(project_file('package.json'), JSON.stringify({ private: true }))
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'warn').mockImplementation(vi.fn())
})

afterEach(() => {
	vi.restoreAllMocks()
})

// `josh init` copies publish.yml only to a repository npm already carries under kit's scope; the
// registry answer is stubbed so the copy list, not the network, is under test.
describe('init_ai_copy.run_ai_copies — publish.yml', () => {
	it('copies kit publish.yml when npm already carries the package', () => {
		vi.spyOn(npm_registry, 'published_package_name').mockReturnValue(PUBLISHED_PACKAGE)

		init_ai_copy.run_ai_copies()

		// The copy gains the managed-workflow header above kit's file.
		expect(readFileSync(project_file(PUBLISH_WORKFLOW), 'utf8')).toContain(
			readFileSync(path.join(REPOSITORY_ROOT, PUBLISH_WORKFLOW), 'utf8'),
		)
	})

	it('leaves publish.yml out when npm does not carry the package', () => {
		vi.spyOn(npm_registry, 'published_package_name').mockReturnValue(undefined)

		init_ai_copy.run_ai_copies()

		expect(existsSync(project_file(PUBLISH_WORKFLOW))).toBe(false)
	})
})
