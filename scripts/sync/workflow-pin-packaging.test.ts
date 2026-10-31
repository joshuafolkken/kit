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

// Init and sync resolve consumer workflow pins from .github/workflows in the installed package.
// The published files list must include that directory even when source-checkout tests can read it.
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
