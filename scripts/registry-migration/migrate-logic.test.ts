import { describe, expect, it } from 'vitest'
import { migrate_logic } from './migrate-logic'

const GH = '@joshuafolkken:registry=https://npm.pkg.github.com\n'
const GH_HOST = 'npm.pkg.github.com'
const NPM_MAPPING = '@joshuafolkken:registry=https://registry.npmjs.org/'
const KIT_ID = '@joshuafolkken/kit@1.2.3'
const PUBLIC_INTEGRITY = 'sha512-public'
const NPM_INTEGRITIES = new Map([[KIT_ID, PUBLIC_INTEGRITY]])
const LOCKFILE = `lockfileVersion: '9.0'\npackages:\n  '${KIT_ID}':\n    resolution:\n      integrity: sha512-example\n      tarball: https://npm.pkg.github.com/download/@joshuafolkken/kit/1.2.3/example\n`

describe('registry migration planning', () => {
	it('changes only the scoped mapping and preserves other settings', () => {
		const original = `engine-strict=true\n${GH}@other:registry=https://example.com\n`
		const plan = migrate_logic.plan(original, '', LOCKFILE)

		expect(plan.content).toContain('engine-strict=true')
		expect(plan.content).toContain('@other:registry=https://example.com')
		expect(plan.content).toContain(NPM_MAPPING)
		expect(migrate_logic.plan(plan.content, '', LOCKFILE).content).toBe(plan.content)
	})

	it('overrides a user mapping in the project without editing user settings', () => {
		const plan = migrate_logic.plan('', GH, LOCKFILE)

		expect(plan.content).toBe(`${NPM_MAPPING}\n`)
		expect(plan.change).toContain(GH_HOST)
	})

	it('replaces a CRLF mapping without changing its line endings', () => {
		const original = `${GH.trimEnd()}\r\n`
		const plan = migrate_logic.plan(original, '', LOCKFILE)

		expect(plan.content).toBe(`${NPM_MAPPING}\r\n`)
	})

	// joshuafolkken/kit#3107: publication is checked per version by `migrate`, not refused by name.
	it('leaves other scoped packages to the version check and detects GitHub tarballs', () => {
		const lockfile = `${LOCKFILE}  '@joshuafolkken/app-kit@1.0.0':\n    resolution:\n      integrity: sha512-other\n`
		const plan = migrate_logic.plan(GH, '', lockfile)

		expect(plan.blocked).toEqual([])
		expect(plan.packages).toEqual(['@joshuafolkken/kit', '@joshuafolkken/app-kit'])
		expect(migrate_logic.github_tarballs(LOCKFILE)).toEqual([KIT_ID])
	})

	it('does not mistake a URL with GitHub in its path for the GitHub registry', () => {
		const lockfile = LOCKFILE.replace(
			'https://npm.pkg.github.com/download/',
			'https://example.com/npm.pkg.github.com/',
		)

		expect(migrate_logic.github_tarballs(lockfile)).toEqual([])
	})
})

describe('registry migration lockfile', () => {
	it('removes only scoped GitHub tarballs before public resolution', () => {
		const other = `  '@other/pkg@1.0.0':\n    resolution: {integrity: sha512-x, tarball: https://npm.pkg.github.com/other}\n`
		const lockfile = `${LOCKFILE}${other}`
		const stripped = migrate_logic.rewrite_scoped_lockfile(lockfile, NPM_INTEGRITIES)

		expect(migrate_logic.github_tarballs(stripped)).toEqual([])
		expect(stripped).toContain(`integrity: ${PUBLIC_INTEGRITY}`)
		expect(stripped).toContain(other)
	})

	it('removes a flow-style GitHub tarball while retaining integrity', () => {
		const lockfile = `packages:\n  '${KIT_ID}':\n    resolution: {integrity: sha512-example, tarball: https://npm.pkg.github.com/download/kit}\n`
		const stripped = migrate_logic.rewrite_scoped_lockfile(lockfile, NPM_INTEGRITIES)

		expect(stripped).toContain(`resolution: {integrity: ${PUBLIC_INTEGRITY}}`)
		expect(stripped).not.toContain(GH_HOST)
	})

	// joshuafolkken/kit#3107: app-kit is rewritten like kit, and a shared version keeps each integrity.
	it('rewrites every scoped package with its own integrity when versions coincide', () => {
		const app_kit = `  '@joshuafolkken/app-kit@1.2.3':\n    resolution: {integrity: sha512-app, tarball: https://npm.pkg.github.com/download/app-kit}\n`
		const integrities = new Map([
			[KIT_ID, PUBLIC_INTEGRITY],
			['@joshuafolkken/app-kit@1.2.3', 'sha512-app-public'],
		])
		const stripped = migrate_logic.rewrite_scoped_lockfile(`${LOCKFILE}${app_kit}`, integrities)

		expect(stripped).toContain(`integrity: ${PUBLIC_INTEGRITY}\n`)
		expect(stripped).toContain('resolution: {integrity: sha512-app-public}')
		expect(stripped).not.toContain(GH_HOST)
	})

	it('blocks ambiguous duplicate mappings', () => {
		expect(migrate_logic.plan(`${GH}${GH}`, '', LOCKFILE).blocked).toContain(
			'duplicate registry mappings',
		)
	})
})
