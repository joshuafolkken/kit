import { eslint_daemon } from '#scripts/lint/eslint-daemon'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { format_edited_file } from './format-edited-file'
import {
	make_directory_helpers,
	payload_for,
	recording_runner,
} from './format-edited-file-fixtures'

// Its own temp directory and teardown, for the reason format-edited-file.diagnostics.test.ts gives.
const make_directory = temporary_directory('suite')
const TEST_DIRECTORY = make_directory('format-edited-daemon-refresh-')
const { write_fixture } = make_directory_helpers(TEST_DIRECTORY)

afterEach(() => {
	vi.restoreAllMocks()
})

// Only a file eslint linted was read fresh by the daemon, so only its fingerprint entry may be
// refreshed; a `.json` module prettier alone formats keeps its old entry and restarts the daemon
// (joshuafolkken/kit#4867).
const LINTED_FILE = 'refreshed.ts'
const FORMATTED_FILE = 'formatted.json'

describe('format_edited_file — the daemon fingerprint refresh', () => {
	it.each([
		['a .ts edit eslint linted', LINTED_FILE, LINTED_FILE],
		['a .json edit only prettier formatted', FORMATTED_FILE, undefined],
	])('names %s', async (_label, name, expected) => {
		const remember = vi.spyOn(eslint_daemon, 'remember_after_edit').mockReturnValue()

		await format_edited_file(payload_for(write_fixture(name)), recording_runner([]), TEST_DIRECTORY)

		expect(remember).toHaveBeenCalledWith(TEST_DIRECTORY, expect.anything(), expected)
	})

	// joshuafolkken/kit#7245: an edit eslint linted is one file fed to the daemon.
	it.each([
		['records', LINTED_FILE, 1],
		['records nothing for', FORMATTED_FILE, 0],
	])('%s the call of an edit to %s', async (_label, name, calls) => {
		vi.spyOn(eslint_daemon, 'remember_after_edit').mockReturnValue()
		const record_call = vi.spyOn(eslint_daemon, 'record_call').mockReturnValue()

		await format_edited_file(payload_for(write_fixture(name)), recording_runner([]), TEST_DIRECTORY)

		expect(record_call.mock.calls).toEqual(
			calls === 0 ? [] : [[TEST_DIRECTORY, { caller: 'edit-hook', files: 1 }]],
		)
	})
})
