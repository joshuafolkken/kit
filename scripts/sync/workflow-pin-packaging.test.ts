import { existsSync, readFileSync } from 'node:fs'
import { PACKAGE_DIR, package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { workflow_pin_logic } from './workflow-pin-logic'

const PACKAGE_JSON = 'package.json'
const GITHUB_DIRECTORY = '.github'

const manifest_schema = z.object({ files: z.array(z.string()) })

function read_published_files(): Array<string> {
	const manifest: unknown = JSON.parse(readFileSync(package_path(PACKAGE_JSON), 'utf8'))

	return manifest_schema.parse(manifest).files
}

// josh init / josh sync resolve consumer workflow pins by reading .github/workflows out of the
// INSTALLED package. That directory used to matter only to kit's own CI, so nothing stopped it
// from being dropped from the published `files` list — which would break pin resolution for every
// consumer while kit's own tests stayed green. These two assertions are that missing guard.
describe('workflow pin resolution packaging', () => {
	it('publishes .github so the canonical pins ship with the package', () => {
		expect(read_published_files()).toContain(GITHUB_DIRECTORY)
	})

	it('resolves canonical pins from a path inside the package root', () => {
		const workflows_directory = package_path(workflow_pin_logic.RUNTIME_WORKFLOWS_DIR)

		expect(existsSync(workflows_directory)).toBe(true)
		expect(workflows_directory.startsWith(PACKAGE_DIR)).toBe(true)
	})
})
