import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { npm_acquisition } from './npm-acquisition'

const make_directory = temporary_directory()
const NPM = '@joshuafolkken:registry=https://registry.npmjs.org/\n'
const GITHUB = '@joshuafolkken:registry=https://npm.pkg.github.com/\n'
const OTHER = '@other:registry=https://npm.pkg.github.com/\n'
const AUTH = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n'
const CUSTOM = 'node custom-fix-gh-packages.js'
const COMMAND = init_logic.GUARDED_FIX_GH_PACKAGES_CMD
const PREPARE = init_logic.get_suggested_scripts()['prepare'] ?? ''
const LOCKFILE = 'pnpm-lock.yaml'
const HOOK_INSTALL = 'lefthook install'

function project(npmrc = ''): string {
	const root = make_directory('npm-acquisition-')

	writeFileSync(path.join(root, '.npmrc'), npmrc)

	return root
}

function manifest(prepare: string, key = 'prepare'): string {
	return JSON.stringify({ scripts: { [key]: prepare, build: 'tsc' } })
}

describe('npm acquisition project routing', () => {
	it('creates an explicit scope mapping for a new project and is idempotent', () => {
		const root = project()
		const once = init_logic.merge_npmrc(AUTH, root)

		expect(once).toBe(`${AUTH}${NPM}`)
		expect(init_logic.merge_npmrc(once, root)).toBe(once)
	})

	it('preserves an existing GitHub mapping and credentials', () => {
		const content = `${GITHUB}${AUTH}${OTHER}`

		expect(init_logic.merge_npmrc(content, project(content))).toBe(content)
	})
})

describe('npm acquisition existing dependencies', () => {
	it('leaves an existing workspace to the verified migration entry', () => {
		const root = project()

		writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')

		expect(init_logic.merge_npmrc('', root)).toBe('')
	})

	it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])(
		'refuses implicit migration with scoped %s even without a project mapping',
		(field) => {
			const root = project()

			writeFileSync(
				path.join(root, 'package.json'),
				JSON.stringify({
					[field]: { '@joshuafolkken/unpublished': '1.0.0' },
				}),
			)

			expect(init_logic.merge_npmrc(AUTH, root)).toBe(AUTH)
		},
	)

	it('refuses implicit migration of transitive scoped lock entries', () => {
		const root = project()

		writeFileSync(
			path.join(root, LOCKFILE),
			'packages:\n  "@joshuafolkken/unpublished@1.0.0":\n    resolution: {integrity: sha512-old}\n',
		)

		expect(init_logic.merge_npmrc('', root)).toBe('')
	})
})

describe('npm acquisition migrated routing', () => {
	it('does not treat an npm mapping with remaining GitHub artifacts as migrated', () => {
		const root = project(NPM)

		writeFileSync(
			path.join(root, LOCKFILE),
			'packages:\n  "@joshuafolkken/child@1.0.0":\n    resolution: {tarball: https://npm.pkg.github.com/old.tgz}\n',
		)

		expect(npm_acquisition.is_project_npm(root)).toBe(false)
		expect(npm_acquisition.is_npm_only(root)).toBe(false)
	})

	it('normalizes migrated mappings without changing other scopes or auth', () => {
		const content = `${AUTH}${OTHER}${NPM}`
		const root = project(content)

		expect(init_logic.merge_npmrc(content, root)).toBe(content)
		expect(readFileSync(path.join(root, '.npmrc'), 'utf8')).toBe(content)
	})

	it('uses the last project mapping when duplicate keys exist', () => {
		expect(npm_acquisition.is_npm(`${NPM}${GITHUB}`)).toBe(false)
		expect(npm_acquisition.is_npm(`${GITHUB}${NPM}`)).toBe(true)
	})
})

describe('npm acquisition managed lifecycle', () => {
	it.each(['prepare', 'postinstall'])('removes only the managed trailing clause in %s', (key) => {
		const root = project(NPM)
		const content = manifest(`${CUSTOM} && ${PREPARE}`, key)
		const once = npm_acquisition.merge_lifecycle(content, root, COMMAND)

		expect(once).toContain(CUSTOM)
		expect(once).toContain(HOOK_INSTALL)
		expect(once).not.toContain(COMMAND)
		expect(npm_acquisition.merge_lifecycle(once, root, COMMAND)).toBe(once)
	})

	it.each([GITHUB, `${NPM}${OTHER}`, ''])(
		'preserves repair when the routing needs it: %s',
		(npmrc) => {
			const content = manifest(PREPARE)

			expect(npm_acquisition.merge_lifecycle(content, project(npmrc), COMMAND)).toBe(content)
		},
	)
})

describe('npm acquisition custom lifecycle', () => {
	it('migrates a known legacy postinstall to prepare without removing custom prepare steps', () => {
		const legacy = `command -v lefthook >/dev/null 2>&1 && lefthook install; ${COMMAND}; true`
		const content = JSON.stringify({ scripts: { prepare: CUSTOM, postinstall: legacy } })
		const root = project(NPM)
		const once = init_logic.upgrade_npm_lifecycle(content, root)

		expect(once).not.toContain('postinstall')
		expect(once).toContain(CUSTOM)
		expect(once).toContain(HOOK_INSTALL)
		expect(once).not.toContain(COMMAND)
		expect(init_logic.upgrade_npm_lifecycle(once, root)).toBe(once)
	})

	it.each([CUSTOM, `echo '${PREPARE}'`, `${PREPARE} && node custom.js`])(
		'preserves commands outside the exact owned suffix: %s',
		(script) => {
			const content = manifest(script)

			expect(npm_acquisition.merge_lifecycle(content, project(NPM), COMMAND)).toBe(content)
		},
	)

	it('preserves a custom postinstall that also calls the published repair API', () => {
		const content = manifest(`${CUSTOM} && ${COMMAND}`, 'postinstall')

		expect(init_logic.strip_managed_postinstall(content)).toBe(content)
	})

	it('keeps repeated migrated init lifecycle merges byte-identical', () => {
		const suggested = init_logic.get_suggested_scripts_for_content('{}', true)
		const content = init_logic.merge_package_scripts('{}', suggested)
		const once = init_logic.merge_prepare_lifecycle_cmd(content, true)

		expect(once).not.toContain('fix-gh-packages')
		expect(init_logic.merge_prepare_lifecycle_cmd(once, true)).toBe(once)
	})
})
