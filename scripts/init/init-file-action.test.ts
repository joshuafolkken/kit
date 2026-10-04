import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileAction } from './init-actions'
import { init_file_action } from './init-file-action'

const DEST = 'playwright.config.ts'
const SAMPLE = "export const config = 'kit'\n"
const CUSTOM = "export const config = 'project'\n"
const UNCHANGED = `  ✔ unchanged ${DEST}`
const ADD_MANUALLY = `  ⚠ exists    ${DEST} — add manually:`

const fixture = { root: '' }

const create_only: FileAction = { dest: DEST, create: () => SAMPLE }

function write_existing(content: string): void {
	writeFileSync(path.join(fixture.root, DEST), content)
}

function read_existing(): string {
	return readFileSync(path.join(fixture.root, DEST), 'utf8')
}

beforeEach(() => {
	fixture.root = mkdtempSync(path.join(os.tmpdir(), 'init-file-action-'))
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
})

afterEach(() => {
	rmSync(fixture.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('execute_file_action — create-only file (regression #3069)', () => {
	it('creates the file when it is absent', () => {
		init_file_action.execute_file_action(create_only, fixture.root)

		expect(read_existing()).toBe(SAMPLE)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(`  ✔ created   ${DEST}`)
	})

	it('reports a file that already matches the sample as unchanged, without the sample', () => {
		write_existing(SAMPLE)

		init_file_action.execute_file_action(create_only, fixture.root)

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(UNCHANGED)
		expect(vi.mocked(console.info)).not.toHaveBeenCalledWith(ADD_MANUALLY)
	})

	it('shows the sample for a file the project changed, and leaves it untouched', () => {
		write_existing(CUSTOM)

		init_file_action.execute_file_action(create_only, fixture.root)

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(ADD_MANUALLY)
		expect(vi.mocked(console.info)).not.toHaveBeenCalledWith(UNCHANGED)
		expect(read_existing()).toBe(CUSTOM)
	})
})

describe('execute_file_action — merged file', () => {
	it('writes the merged content and reports it updated', () => {
		write_existing(CUSTOM)

		init_file_action.execute_file_action(
			{ dest: DEST, create: () => SAMPLE, merge: (existing) => `${existing}// merged\n` },
			fixture.root,
		)

		expect(read_existing()).toBe(`${CUSTOM}// merged\n`)
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(`  ✔ updated   ${DEST}`)
	})

	it('reports a merge that changes nothing as unchanged, even when it differs from the sample', () => {
		write_existing(CUSTOM)

		init_file_action.execute_file_action(
			{ dest: DEST, create: () => SAMPLE, merge: (existing) => existing },
			fixture.root,
		)

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(UNCHANGED)
	})
})
