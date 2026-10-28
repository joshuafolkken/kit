import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { import_graph } from '#scripts/lint/import-graph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_wake_code, type CodeSource } from './run-wake-code'

// joshuafolkken/kit#4509: whether the supervisor still runs the code on disk.

const HEAD_A = 'aaaaaaa'
const HEAD_B = 'bbbbbbb'
const CLOSURE_A = 'closure-a'
const CLOSURE_B = 'closure-b'
const ENTRY = 'entry.ts'
const IMPORTED = 'a.ts'
const UNRELATED = 'unrelated.ts'
const TSCONFIG = JSON.stringify({
	compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
	include: ['*.ts'],
})

const roots: Array<string> = []

// A source whose answers are scripted, one per read; the last answer repeats.
function scripted(
	heads: Array<string | undefined>,
	closures: Array<string | undefined>,
): CodeSource & { closure: ReturnType<typeof vi.fn> } {
	return {
		head: async () => (heads.length > 1 ? heads.shift() : heads[0]),
		closure: vi.fn(async () => (closures.length > 1 ? closures.shift() : closures[0])),
	}
}

function write_project(): string {
	const created = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-code-test-'))
	const root = realpathSync(created)

	roots.push(root)
	writeFileSync(path.join(root, 'tsconfig.json'), TSCONFIG)
	writeFileSync(path.join(root, ENTRY), "import { a } from './a'\n\nexport const entry = a\n")
	writeFileSync(path.join(root, IMPORTED), 'export const a = 1\n')
	writeFileSync(path.join(root, UNRELATED), 'export const unrelated = 1\n')

	return root
}

afterEach(() => {
	vi.restoreAllMocks()
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('run_wake_code.watch', () => {
	it('is not stale and does not re-hash while the commit stays', async () => {
		const source = scripted([HEAD_A], [CLOSURE_A])
		const is_stale = await run_wake_code.watch(source)

		expect(await is_stale()).toBe(false)
		expect(source.closure).toHaveBeenCalledTimes(1)
	})

	it('is not stale when the commit moved but the closure did not', async () => {
		const is_stale = await run_wake_code.watch(scripted([HEAD_A, HEAD_B], [CLOSURE_A]))

		expect(await is_stale()).toBe(false)
	})

	it('is stale when the commit moved and the closure changed', async () => {
		const is_stale = await run_wake_code.watch(scripted([HEAD_A, HEAD_B], [CLOSURE_A, CLOSURE_B]))

		expect(await is_stale()).toBe(true)
	})

	it('is never stale when the closure cannot be hashed', async () => {
		const is_stale = await run_wake_code.watch(scripted([HEAD_A, HEAD_B], [undefined, CLOSURE_B]))

		expect(await is_stale()).toBe(false)
	})
})

// joshuafolkken/kit#4714: a supervisor whose broker refused a ship's request is suspected of old code.
describe('run_wake_code.watch — a suspected supervisor', () => {
	it('re-hashes an unmoved commit once suspected, stale on a changed closure', async () => {
		const is_stale = await run_wake_code.watch(
			scripted([HEAD_A], [CLOSURE_A, CLOSURE_B]),
			() => true,
		)

		expect(await is_stale()).toBe(true)
	})

	it('is not stale when suspected but the closure is unchanged', async () => {
		const source = scripted([HEAD_A], [CLOSURE_A])
		const is_stale = await run_wake_code.watch(source, () => true)

		expect(await is_stale()).toBe(false)
		expect(source.closure).toHaveBeenCalledTimes(2)
	})

	it('is stale when suspected and its start left no baseline', async () => {
		const is_stale = await run_wake_code.watch(
			scripted([HEAD_A], [undefined, CLOSURE_A]),
			() => true,
		)

		expect(await is_stale()).toBe(true)
	})

	it('keeps a suspicion for the next pass when its closure could not be hashed', async () => {
		const suspicions = [true, false]
		const source = scripted([HEAD_A], [CLOSURE_A, undefined, CLOSURE_B])
		const is_stale = await run_wake_code.watch(source, () => suspicions.shift() ?? false)

		expect([await is_stale(), await is_stale()]).toStrictEqual([false, true])
	})

	it('reads a move again at the next pass when its closure could not be hashed', async () => {
		const source = scripted([HEAD_A, HEAD_B], [CLOSURE_A, undefined, CLOSURE_B])
		const is_stale = await run_wake_code.watch(source)

		expect([await is_stale(), await is_stale()]).toStrictEqual([false, true])
	})
})

describe('run_wake_code.source_of — closure', () => {
	it('keeps the hash when a file the entry does not import changes', async () => {
		const root = write_project()
		const source = run_wake_code.source_of(root, path.join(root, ENTRY))
		const before = await source.closure()

		writeFileSync(path.join(root, UNRELATED), 'export const unrelated = 2\n')

		expect(before).toBeDefined()
		expect(await source.closure()).toBe(before)
	})

	it('answers no hash rather than throwing when the graph cannot be read', async () => {
		vi.spyOn(import_graph, 'create').mockRejectedValue(new Error('EACCES'))
		const source = run_wake_code.source_of(write_project(), ENTRY)

		expect(await source.closure()).toBeUndefined()
	})

	it('changes the hash when a file the entry imports changes', async () => {
		const root = write_project()
		const source = run_wake_code.source_of(root, path.join(root, ENTRY))
		const before = await source.closure()

		writeFileSync(path.join(root, IMPORTED), 'export const a = JSON.parse("2")\n')

		expect(await source.closure()).not.toBe(before)
	})
})
