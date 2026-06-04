import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { package_path } from './init/init-paths'

// Files removed because no distribution code path reads them:
// - templates/.npmrc: .npmrc is generated from NPMRC_LINES, never copied from this file.
// - templates/workflows/deploy-vps.yml: sync only patches an existing consumer file;
//   the template body is never read or copied.
const DEAD_TEMPLATE_FILES: ReadonlyArray<string> = [
	'templates/.npmrc',
	'templates/workflows/deploy-vps.yml',
]

// Files actually consumed at init / sync time.
const LIVE_TEMPLATE_FILES: ReadonlyArray<string> = [
	'templates/gitignore',
	'templates/workflows/ci.yml',
	'templates/sonar-project.properties',
]

describe('templates/ contents', () => {
	it('does not re-introduce dead template files', () => {
		for (const relative_path of DEAD_TEMPLATE_FILES) {
			expect(existsSync(package_path(relative_path)), relative_path).toBe(false)
		}
	})

	it('keeps every live template file', () => {
		for (const relative_path of LIVE_TEMPLATE_FILES) {
			expect(existsSync(package_path(relative_path)), relative_path).toBe(true)
		}
	})
})
