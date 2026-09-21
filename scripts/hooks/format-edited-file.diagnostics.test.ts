import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { compose_context, format_edited_file, MAX_DIAGNOSTIC_CHARS } from './format-edited-file'
import {
	eslint_reporting_runner,
	make_directory_helpers,
	payload_for,
	recording_runner,
} from './format-edited-file-fixtures'

// Its own temp directory and teardown: vitest isolates test files, so this does not share the
// sibling suite's `mkdtemp` (see format-edited-file.test.ts for why it lives under the OS temp dir).
const TEST_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'format-edited-diagnostics-'))
const { write_fixture } = make_directory_helpers(TEST_DIRECTORY)

afterAll(() => {
	rmSync(TEST_DIRECTORY, { recursive: true, force: true })
})

async function returned_for(name: string, stdout: string): Promise<string | undefined> {
	return await format_edited_file(
		payload_for(write_fixture(name)),
		eslint_reporting_runner(stdout),
		TEST_DIRECTORY,
	)
}

// The problems eslint could not auto-fix are returned so the model sees them on this edit rather than
// at the gate (joshuafolkken/kit#2275). What eslint fixed is still applied silently.
describe('format_edited_file — the unfixed diagnostics', () => {
	const PROBLEM = 'app.ts\n  3:1  error  Unexpected var  no-var'

	it('returns the problems eslint could not fix, under a header', async () => {
		const returned = await returned_for('unfixed.ts', PROBLEM)

		expect(returned).toContain(PROBLEM)
		expect(returned).toContain('no-var')
	})

	// The ordinary edit — eslint fixed everything — must add nothing, so the harness parses nothing.
	it('returns nothing when eslint reports no unfixed problems', async () => {
		const payload = payload_for(write_fixture('clean.ts'))

		await expect(
			format_edited_file(payload, recording_runner([]), TEST_DIRECTORY),
		).resolves.toBeUndefined()
	})

	// prettier's stdout is the list of files it wrote, not diagnostics; a `.md` file runs prettier
	// alone, so nothing is ever returned from it.
	it('returns nothing for a file that runs prettier alone', async () => {
		await expect(returned_for('notes.md', PROBLEM)).resolves.toBeUndefined()
	})

	// additionalContext rides back on the edit, so a large lint dump is cut to the bound.
	it('truncates diagnostics past the bound and marks the cut', async () => {
		const oversized = 'x'.repeat(MAX_DIAGNOSTIC_CHARS + 500)
		const returned = await returned_for('oversized.ts', oversized)

		expect(returned).toContain('truncated')
		expect(returned?.length).toBeLessThan(oversized.length)
	})
})

// Both the density line and the lint problems reach the model as one additionalContext string, and
// returning the problems never sets `permissionDecision`, so the edit is not turned into a failure.
describe('compose_context', () => {
	const DENSITY = 'density line'
	const LINT = 'lint problems'

	it('joins both sides, names neither permissionDecision, when both are present', () => {
		const joined = compose_context(DENSITY, LINT)

		expect(joined).toContain(DENSITY)
		expect(joined).toContain(LINT)
		expect(joined).not.toContain('permissionDecision')
	})

	it.each([
		['neither is present, so the ordinary edit writes nothing', undefined, undefined, undefined],
		['only the diagnostics are present', undefined, LINT, LINT],
		['only the density line is present', DENSITY, undefined, DENSITY],
	])('is %s', (_label, notice, diagnostics, expected) => {
		expect(compose_context(notice, diagnostics)).toBe(expected)
	})
})
