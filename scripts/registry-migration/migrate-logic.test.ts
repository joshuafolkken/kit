import { describe, expect, it } from 'vitest'
import { migrate_logic } from './migrate-logic'

const GH = '@joshuafolkken:registry=https://npm.pkg.github.com\n'
const GH_HOST = 'npm.pkg.github.com'
const NPM_MAPPING = '@joshuafolkken:registry=https://registry.npmjs.org/'
const NPM_INTEGRITIES = new Map([['1.2.3', 'sha512-public']])
const LOCKFILE = `lockfileVersion: '9.0'\npackages:\n  '@joshuafolkken/kit@1.2.3':\n    resolution:\n      integrity: sha512-example\n      tarball: https://npm.pkg.github.com/download/@joshuafolkken/kit/1.2.3/example\n`

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
		const original = GH.replace('\n', '\r\n')
		const plan = migrate_logic.plan(original, '', LOCKFILE)

		expect(plan.content).toBe(`${NPM_MAPPING}\r\n`)
	})

	it('blocks other scoped packages and detects GitHub tarballs', () => {
		const lockfile = `${LOCKFILE}  '@joshuafolkken/game-kit@1.0.0':\n    resolution:\n      integrity: sha512-other\n`

		expect(migrate_logic.plan(GH, '', lockfile).blocked).toContain('@joshuafolkken/game-kit')
		expect(migrate_logic.github_tarballs(LOCKFILE)).toEqual(['@joshuafolkken/kit@1.2.3'])
	})
})

describe('registry migration lockfile', () => {
	it('removes only kit GitHub tarballs before public resolution', () => {
		const other = `  '@other/pkg@1.0.0':\n    resolution: {integrity: sha512-x, tarball: https://npm.pkg.github.com/other}\n`
		const lockfile = `${LOCKFILE}${other}`
		const stripped = migrate_logic.rewrite_kit_lockfile(lockfile, NPM_INTEGRITIES)

		expect(migrate_logic.github_tarballs(stripped)).toEqual([])
		expect(stripped).toContain('integrity: sha512-public')
		expect(stripped).toContain(other)
	})

	it('removes a flow-style GitHub tarball while retaining integrity', () => {
		const lockfile = `packages:\n  '@joshuafolkken/kit@1.2.3':\n    resolution: {integrity: sha512-example, tarball: https://npm.pkg.github.com/download/kit}\n`
		const stripped = migrate_logic.rewrite_kit_lockfile(lockfile, NPM_INTEGRITIES)

		expect(stripped).toContain('resolution: {integrity: sha512-public}')
		expect(stripped).not.toContain(GH_HOST)
	})

	it('blocks ambiguous duplicate mappings', () => {
		expect(migrate_logic.plan(`${GH}${GH}`, '', LOCKFILE).blocked).toContain(
			'duplicate registry mappings',
		)
	})
})
