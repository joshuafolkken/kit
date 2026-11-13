import { readFileSync } from 'node:fs'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related_imports } from './test-related-imports'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
vi.mock('#scripts/git/change-base', () => ({ change_base: { resolved_through_merge: vi.fn() } }))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const FILE = 'wide.ts'
const SOURCE = "import { x } from './leaf'\nexport const wide = x\n"

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(change_base.resolved_through_merge).mockResolvedValue('base')
	vi.mocked(git_spawn.read).mockResolvedValue(SOURCE)
	vi.mocked(readFileSync).mockReturnValue(SOURCE)
})

describe('test_related_imports.stable_files', () => {
	it('keeps the cap when only behavior changes with the same import targets', async () => {
		vi.mocked(readFileSync).mockReturnValue(`${SOURCE}\nexport const added = 1`)

		expect(await test_related_imports.stable_files('/repo', [FILE])).toEqual([FILE])
	})

	it.each([
		"import './new'",
		'',
		"export { x } from './other'",
		"await import('./dynamic')",
		"import { x, missing } from './leaf'",
		'function load(name: string) { return import(name) }',
		"const leaf = require('./leaf')",
	])('keeps full reach when import targets change to %s', async (source) => {
		vi.mocked(readFileSync).mockReturnValue(source)

		expect(await test_related_imports.stable_files('/repo', [FILE])).toEqual([])
	})

	it('keeps full reach for an added file or unreadable historical blob', async () => {
		vi.mocked(git_spawn.read).mockRejectedValue(new Error('missing blob'))

		expect(await test_related_imports.stable_files('/repo', [FILE])).toEqual([])
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('changed or unknown'))
	})

	it('keeps full reach when a file disappears during comparison', async () => {
		vi.mocked(readFileSync).mockImplementation(() => {
			throw new Error('gone')
		})

		expect(await test_related_imports.stable_files('/repo', [FILE])).toEqual([])
	})
})

describe('test_related_imports history boundaries', () => {
	it('keeps full reach for a component the TypeScript parser cannot vouch for', async () => {
		expect(await test_related_imports.stable_files('/repo', ['View.svelte'])).toEqual([])
	})

	it('keeps full reach when the comparison infrastructure fails', async () => {
		vi.mocked(change_base.resolved_through_merge).mockRejectedValue(new Error('unavailable'))

		expect(await test_related_imports.stable_files('/repo', [FILE])).toEqual([])
	})
	it('keeps full reach when the base is unknown', async () => {
		vi.mocked(change_base.resolved_through_merge).mockResolvedValue(undefined)

		expect(await test_related_imports.stable_files('/repo', [FILE])).toEqual([])
		expect(git_spawn.read).not.toHaveBeenCalled()
	})

	it('reads the current resolved base again after main moves', async () => {
		await test_related_imports.stable_files('/repo', [FILE])
		vi.mocked(change_base.resolved_through_merge).mockResolvedValue('new-base')
		await test_related_imports.stable_files('/repo', [FILE])

		expect(git_spawn.read).toHaveBeenLastCalledWith(['-C', '/repo', 'show', `new-base:${FILE}`])
	})

	it('reads no base for an empty candidate set', async () => {
		expect(await test_related_imports.stable_files('/repo', [])).toEqual([])
		expect(change_base.resolved_through_merge).not.toHaveBeenCalled()
	})
})
