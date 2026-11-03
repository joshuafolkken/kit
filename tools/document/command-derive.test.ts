import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { command_derive } from './command-derive'
import { CATALOG_FILE, generate_catalog } from './generate-catalog'
import { generate_command_usage } from './generate-command-usage'
import { generate_lint_prose } from './generate-lint-prose'

vi.mock('node:fs', async (import_original) => {
	const original = await import_original<{ writeFileSync: typeof writeFileSync }>()

	return { ...original, writeFileSync: vi.fn() }
})

vi.mock('execa', () => ({
	execa: vi.fn(() => {
		throw new Error('command derivation must not start a snapshot test runner')
	}),
}))

describe('command derivation', () => {
	it('writes the current catalog without running snapshot tests', () => {
		expect(command_derive.main()).toBe(0)
		expect(writeFileSync).toHaveBeenCalledWith(CATALOG_FILE, generate_catalog())
	})

	it.each(generate_lint_prose.LINT_PROSE_PAGES)('writes the lint prose spans of %s', (page) => {
		const path = generate_command_usage.page_path(page)

		expect(command_derive.main()).toBe(0)
		expect(writeFileSync).toHaveBeenCalledWith(
			path,
			generate_lint_prose.fill_lint_spans(readFileSync(path, 'utf8')),
		)
	})
})
