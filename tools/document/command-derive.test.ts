import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { command_derive } from './command-derive'
import { derived_artifacts } from './derived-artifacts'
import { CATALOG_FILE, generate_catalog } from './generate-catalog'
import { generate_command_usage } from './generate-command-usage'
import { generate_lint_prose } from './generate-lint-prose'

vi.mock('node:fs', async (import_original) => {
	const original = await import_original<{
		readFileSync: typeof readFileSync
		writeFileSync: typeof writeFileSync
	}>()

	return { ...original, readFileSync: vi.fn(original.readFileSync), writeFileSync: vi.fn() }
})

vi.mock('execa', () => ({
	execa: vi.fn(() => {
		throw new Error('command derivation must not start a snapshot test runner')
	}),
}))

const CHECK_ARGV = [derived_artifacts.CHECK_FLAG]
const CATALOG_PAGE = 'docs/josh-command-catalog.md'
const read_from_disk = vi.mocked(readFileSync).getMockImplementation() ?? readFileSync

afterEach(() => {
	vi.mocked(readFileSync).mockImplementation(read_from_disk)
	vi.mocked(writeFileSync).mockClear()
	vi.restoreAllMocks()
})

describe('command derivation', () => {
	it('writes the current catalog without running snapshot tests', () => {
		expect(command_derive.main([])).toBe(0)
		expect(writeFileSync).toHaveBeenCalledWith(CATALOG_FILE, generate_catalog())
	})

	it.each(generate_lint_prose.LINT_PROSE_PAGES)('writes the lint prose spans of %s', (page) => {
		const path = generate_command_usage.page_path(page)

		expect(command_derive.main([])).toBe(0)
		expect(writeFileSync).toHaveBeenCalledWith(
			path,
			generate_lint_prose.fill_lint_spans(readFileSync(path, 'utf8')),
		)
	})
})

describe('command derivation --check', () => {
	it('passes and writes nothing when every generated page matches its derivation', () => {
		expect(command_derive.main(CHECK_ARGV)).toBe(0)
		expect(writeFileSync).not.toHaveBeenCalled()
	})

	it('names a hand-edited generated page and writes nothing', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.mocked(readFileSync).mockImplementation((path, options) =>
			path === CATALOG_FILE ? 'a hand edit' : read_from_disk(path, options),
		)

		expect(command_derive.main(CHECK_ARGV)).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(CATALOG_PAGE))
		expect(writeFileSync).not.toHaveBeenCalled()
	})
})
