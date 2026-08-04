import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logged_lines } from './logged-lines-fixture'

// kit #740: `josh latest` derived its capped-package exclusions from `pnpm.overrides` in
// package.json alone, so overrides declared in pnpm-workspace.yaml were invisible to it and the
// post-update verdict was left to whoever remembered to open the right file afterwards. These
// tests run the real overrides readers against a mocked filesystem.

const WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'
const LOCKFILE_PATH = 'pnpm-lock.yaml'
const UNCHANGED_NOTICE = 'overrides unchanged'

const PACKAGE_JSON = JSON.stringify({
	name: 'app-kit',
	dependencies: { svelte: '^5.55.7' },
	devDependencies: { vitest: '^4.0.0' },
})
// A version-cap override — the shape `pnpm update --latest` must skip, since updating past the cap
// makes the tree unresolvable.
const CAPPED_KEY = 'svelte@>=6'
const WORKSPACE_WITH_CAP = `overrides:\n  "${CAPPED_KEY}": ^5.55.7\n`

const tree = { package_json: PACKAGE_JSON, workspace_yaml: WORKSPACE_WITH_CAP }

const execa_sync_mock = vi.hoisted(() => vi.fn().mockReturnValue({ exitCode: 0 }))
const sync_mock = vi.hoisted(() => vi.fn())
const read_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({ readFileSync: read_mock, writeFileSync: vi.fn() }))
vi.mock('./preinstall-version-update', () => ({
	preinstall_version_update: { sync: sync_mock },
}))

const { latest_update } = await import('./latest-update')

function read_tree_file(path: string): string {
	if (path === WORKSPACE_YAML_PATH) return tree.workspace_yaml
	if (path === LOCKFILE_PATH) return ''

	return tree.package_json
}

beforeEach(() => {
	vi.clearAllMocks()
	tree.package_json = PACKAGE_JSON
	tree.workspace_yaml = WORKSPACE_WITH_CAP
	read_mock.mockImplementation(read_tree_file)
	execa_sync_mock.mockReturnValue({ exitCode: 0 })
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'warn').mockImplementation(vi.fn())
})

describe('latest_update.main — overrides declared in pnpm-workspace.yaml', () => {
	it('excludes a package capped by a workspace override from the update targets', () => {
		latest_update.main()

		expect(
			logged_lines.find_logged(console.info, 'Skipping held-back / overridden packages'),
		).toContain('svelte')
	})

	it('reports the overrides verdict naming the file they were read from', () => {
		latest_update.main()

		expect(logged_lines.find_logged(console.info, UNCHANGED_NOTICE)).toContain(
			'1 from pnpm-workspace.yaml',
		)
	})

	it('names both files when no overrides exist anywhere', () => {
		tree.workspace_yaml = ''
		latest_update.main()

		expect(logged_lines.find_logged(console.info, UNCHANGED_NOTICE)).toContain(
			'no overrides found in pnpm-workspace.yaml or package.json',
		)
	})

	it('warns when an override disappears during the update', () => {
		execa_sync_mock.mockImplementation(() => {
			tree.workspace_yaml = ''

			return { exitCode: 0 }
		})
		latest_update.main()

		expect(logged_lines.find_logged(console.warn, 'overrides changed')).toBeDefined()
		expect(logged_lines.find_logged(console.warn, `removed: ${CAPPED_KEY}`)).toBeDefined()
	})
})
