import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { kit_development_versions } from './kit-development-versions'

const KIT_MANIFEST = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { peerDependencies: Record<string, string>; devDependencies: Record<string, string> }
const TYPESCRIPT = 'typescript'
const ESLINT = 'eslint'

describe('versions_of', () => {
	// kit runs TypeScript 6 under an alias whose bin is `tsc6`; a consumer needs the bare package's `tsc`.
	it('gives a name kit installs under an npm alias the range kit publishes as a peer', () => {
		const version = kit_development_versions.versions_of([TYPESCRIPT])[TYPESCRIPT]

		expect(KIT_MANIFEST.devDependencies[TYPESCRIPT]).toMatch(/^npm:/u)
		expect(version).toBe(KIT_MANIFEST.peerDependencies[TYPESCRIPT])
		expect(version).not.toMatch(/^npm:/u)
	})

	it('gives a name kit installs as itself the range kit develops against', () => {
		expect(kit_development_versions.versions_of([ESLINT])[ESLINT]).toBe(
			KIT_MANIFEST.devDependencies[ESLINT],
		)
	})

	it('throws for a name kit does not develop against', () => {
		expect(() => kit_development_versions.versions_of(['not-a-kit-dependency'])).toThrow(
			'Missing development version for not-a-kit-dependency',
		)
	})
})
