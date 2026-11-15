import { git_command } from '#scripts/git/git-command'
import { file_reader } from '#scripts/lib/read-file'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { whole_suite_narrowing } from './whole-suite-narrowing'

// joshuafolkken/kit#5001 and joshuafolkken/kit#7538: a whole-suite file narrows by what moved in it
// against the change base.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { change_base: vi.fn(), show_file: vi.fn() },
}))

const ROOT = '/repo'
const BASE = 'b45e'
const PURE_FILES = 'tools/test/pure-files.ts'
const PACKAGE_FILE = 'package.json'
const KEPT = 'scripts/a/kept.test.ts'
const ADDED = 'scripts/b/added.test.ts'
const NO_BASE = new Error('bad object')

function list_of(entries: ReadonlyArray<string>): string {
	return ['const PURE_FILES = [', ...entries.map((entry) => `\t'${entry}',`), ']', ''].join('\n')
}

function manifest_of(version: string, scripts: Record<string, string> = {}): string {
	return JSON.stringify({ name: 'kit', version, scripts })
}

beforeEach(() => {
	vi.mocked(git_command.change_base).mockResolvedValue(BASE)
})

describe('whole_suite_narrowing.read_pure_entries', () => {
	beforeEach(() => {
		vi.mocked(git_command.show_file).mockResolvedValue(list_of([KEPT]))
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(list_of([KEPT, ADDED]))
	})

	it('answers the entries moved between the change base and the working tree', async () => {
		await expect(
			whole_suite_narrowing.read_pure_entries(ROOT, [PURE_FILES]),
		).resolves.toStrictEqual([ADDED])
		expect(git_command.show_file).toHaveBeenCalledWith(`${BASE}:${PURE_FILES}`)
		expect(file_reader.read_if_readable).toHaveBeenCalledWith(`${ROOT}/${PURE_FILES}`)
	})

	it('answers undefined when the change base cannot be read', async () => {
		vi.mocked(git_command.show_file).mockRejectedValue(NO_BASE)

		await expect(
			whole_suite_narrowing.read_pure_entries(ROOT, [PURE_FILES]),
		).resolves.toBeUndefined()
	})

	it('answers undefined when the working tree cannot be read', async () => {
		vi.mocked(file_reader.read_if_readable).mockReturnValue(undefined)

		await expect(
			whole_suite_narrowing.read_pure_entries(ROOT, [PURE_FILES]),
		).resolves.toBeUndefined()
	})

	it('answers undefined when the list is not among the changed files, or the change is unread', async () => {
		await expect(whole_suite_narrowing.read_pure_entries(ROOT, [KEPT])).resolves.toBeUndefined()
		await expect(whole_suite_narrowing.read_pure_entries(ROOT, undefined)).resolves.toBeUndefined()
	})
})

describe('whole_suite_narrowing.read_version_only', () => {
	beforeEach(() => {
		vi.mocked(git_command.show_file).mockResolvedValue(manifest_of('1.0.0'))
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(manifest_of('1.1.0'))
	})

	it('holds package.json when only its version moved', async () => {
		await expect(
			whole_suite_narrowing.read_version_only(ROOT, [PACKAGE_FILE]),
		).resolves.toStrictEqual(new Set([PACKAGE_FILE]))
		expect(git_command.show_file).toHaveBeenCalledWith(`${BASE}:${PACKAGE_FILE}`)
	})

	it('holds nothing when a script moved with the version', async () => {
		vi.mocked(file_reader.read_if_readable).mockReturnValue(manifest_of('1.1.0', { a: 'b' }))

		await expect(
			whole_suite_narrowing.read_version_only(ROOT, [PACKAGE_FILE]),
		).resolves.toStrictEqual(new Set())
	})

	it('holds nothing when the change base has no package.json', async () => {
		vi.mocked(git_command.show_file).mockRejectedValue(NO_BASE)

		await expect(
			whole_suite_narrowing.read_version_only(ROOT, [PACKAGE_FILE]),
		).resolves.toStrictEqual(new Set())
	})

	it('holds nothing when package.json did not change', async () => {
		await expect(whole_suite_narrowing.read_version_only(ROOT, [KEPT])).resolves.toStrictEqual(
			new Set(),
		)
	})
})

describe('whole_suite_narrowing.read', () => {
	it('answers both readings at once', async () => {
		vi.mocked(git_command.show_file).mockResolvedValue(manifest_of('1.0.0'))
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(manifest_of('1.1.0'))

		await expect(whole_suite_narrowing.read(ROOT, [PACKAGE_FILE])).resolves.toStrictEqual({
			pure_entries: undefined,
			version_only: new Set([PACKAGE_FILE]),
		})
	})
})
