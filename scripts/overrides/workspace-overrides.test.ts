import { readFileSync } from 'node:fs'
import { init_logic_workspace } from '#scripts/init/init-logic-workspace'
import { package_path } from '#scripts/init/init-paths'
import { yaml_config_fixture } from '#scripts/lib/yaml-config-fixture'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

interface WorkspaceYaml {
	overrides?: Record<string, string>
}

const MINIMATCH_FLOOR_MAJOR = 11
const WORKSPACE_YAML = 'pnpm-workspace.yaml'

function load_overrides(): Record<string, string> {
	const workspace = yaml_config_fixture.load_yaml_config(WORKSPACE_YAML) as WorkspaceYaml

	return workspace.overrides ?? {}
}

function locked_majors(package_name: string): Array<number> {
	const lockfile = readFileSync(package_path('pnpm-lock.yaml'), 'utf8')
	const pattern = new RegExp(String.raw`^ {2}${package_name}@(\d+)\.`, 'gmu')

	return [...lockfile.matchAll(pattern)].map((match) => Number(match[1]))
}

// joshuafolkken/kit#5500: GHSA-g3hv-75wg-m249 is fixed only in minimatch 11, which ESLint and its
// plugins do not yet accept. Remove these with the override and the import-x patch (#5507).
describe('pnpm-workspace.yaml advisory overrides', () => {
	it('floors minimatch at the release clearing GHSA-g3hv-75wg-m249', () => {
		expect(load_overrides()['minimatch']).toBe('^11.0.1')
	})

	it('resolves every locked minimatch to the fixed major', () => {
		const majors = locked_majors('minimatch')

		expect(majors.length).toBeGreaterThan(0)
		expect(majors.every((major) => major >= MINIMATCH_FLOOR_MAJOR)).toBe(true)
	})

	it('loads eslint-plugin-import-x under minimatch 11 and matches its forbid globs', async () => {
		const { default: import_x } = await import('eslint-plugin-import-x')
		const linter = new Linter({ configType: 'flat' })
		const messages = linter.verify("import x from './feature/internal/x.js'\nexport { x }\n", {
			plugins: { 'import-x': import_x },
			rules: { 'import-x/no-internal-modules': ['error', { forbid: ['**/internal/**'] }] },
			languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
		})

		expect(messages.map((message) => message.ruleId)).toEqual(['import-x/no-internal-modules'])
	})

	it('keeps the override and the unpublished patch out of what josh sync distributes', () => {
		const workspace = readFileSync(package_path(WORKSPACE_YAML), 'utf8')
		const distributed = init_logic_workspace.drop_kit_only_regions(workspace)

		expect(workspace).toContain('patchedDependencies:')
		expect(distributed).not.toMatch(/minimatch|patchedDependencies|kit-only/u)
		expect(distributed).toContain('vite: ^8.0.16')
	})
})
