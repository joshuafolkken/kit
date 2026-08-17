import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PACKAGE_DIR } from './init/init-paths'
import { yaml_config_fixture } from './yaml-config-fixture'

// A guard built on this reader asserts that a shipped config declares something. If a truncated or
// malformed file quietly parsed to {}, every such assertion would pass while testing nothing — so
// the loud-failure path is the behavior worth locking in, not an incidental detail.
const DEPENDABOT_CONFIG = path.join('.github', 'dependabot.yml')
const MISSING_CONFIG = path.join('.github', 'does-not-exist.yml')
const NOT_A_MAPPING_MESSAGE = /did not parse as a YAML mapping document/u
const EMPTY_DOCUMENT_MESSAGE = /the input is empty/u

// Written under the OS temp directory and reached by a package-root-relative path: several suites
// in this repo assert on the repository's own file listing, so an orphaned fixture at the package
// root would break them rather than merely leave litter. mkdtempSync rather than a fixed name so
// a watch-mode run and a lefthook-triggered run cannot delete each other's directory.
const TEST_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'yaml-config-fixture-'))

function write_fixture(file_name: string, content: string): string {
	const absolute_path = path.join(TEST_DIRECTORY, file_name)

	writeFileSync(absolute_path, content, 'utf8')

	return path.relative(PACKAGE_DIR, absolute_path)
}

afterAll(() => {
	rmSync(TEST_DIRECTORY, { recursive: true, force: true })
})

describe('yaml_config_fixture.load_yaml_config', () => {
	it('parses a shipped config into a mapping', () => {
		expect(yaml_config_fixture.load_yaml_config(DEPENDABOT_CONFIG)).toMatchObject({ version: 2 })
	})

	// Resolved from the package root, so the file is found no matter where the runner started.
	it('resolves the path from the package root rather than the working directory', () => {
		const previous_cwd = process.cwd()

		// Anchored to PACKAGE_DIR, not to the current cwd: a test asserting cwd-independence must
		// not itself assume the runner started at the package root.
		process.chdir(path.join(PACKAGE_DIR, 'scripts'))

		try {
			expect(yaml_config_fixture.load_yaml_config(DEPENDABOT_CONFIG)).toBeDefined()
		} finally {
			process.chdir(previous_cwd)
		}
	})

	// The case yaml_document.parse_yaml would silently turn into {}. Matched on js-yaml's own
	// empty-document message rather than a bare toThrow(), so a path-resolution regression that
	// raises ENOENT cannot keep this green while the behavior under test goes unverified.
	it('throws for a comment-only document instead of yielding an empty config', () => {
		const target = write_fixture('comment-only.yml', '# nothing here\n')

		expect(() => yaml_config_fixture.load_yaml_config(target)).toThrow(EMPTY_DOCUMENT_MESSAGE)
	})

	it('throws for a document whose root is a sequence rather than a mapping', () => {
		const target = write_fixture('sequence.yml', '- a\n- b\n')

		expect(() => yaml_config_fixture.load_yaml_config(target)).toThrow(NOT_A_MAPPING_MESSAGE)
	})

	it('throws when the file is missing rather than reporting an empty config', () => {
		expect(() => yaml_config_fixture.load_yaml_config(MISSING_CONFIG)).toThrow()
	})
})
