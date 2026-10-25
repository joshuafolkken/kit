import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eslint_daemon } from '#scripts/lint/eslint-daemon'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { format_edited_file } from './format-edited-file'
import {
	make_directory_helpers,
	payload_for,
	recording_runner,
} from './format-edited-file-fixtures'

// Its own temp directory and teardown, for the reason format-edited-file.diagnostics.test.ts gives.
const TEST_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'format-edited-daemon-refresh-'))
const { write_fixture } = make_directory_helpers(TEST_DIRECTORY)

afterAll(() => {
	rmSync(TEST_DIRECTORY, { recursive: true, force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
})

// Only a file eslint linted was read fresh by the daemon, so only its fingerprint entry may be
// refreshed; a `.json` module prettier alone formats keeps its old entry and restarts the daemon
// (joshuafolkken/kit#4867).
const LINTED_FILE = 'refreshed.ts'

describe('format_edited_file — the daemon fingerprint refresh', () => {
	it.each([
		['a .ts edit eslint linted', LINTED_FILE, LINTED_FILE],
		['a .json edit only prettier formatted', 'formatted.json', undefined],
	])('names %s', async (_label, name, expected) => {
		const remember = vi.spyOn(eslint_daemon, 'remember_after_edit').mockReturnValue()

		await format_edited_file(payload_for(write_fixture(name)), recording_runner([]), TEST_DIRECTORY)

		expect(remember).toHaveBeenCalledWith(TEST_DIRECTORY, expect.anything(), expected)
	})
})
