import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GateTree } from './gate-tree'
import { tree_verdict } from './tree-verdict'

// joshuafolkken/kit#5657: a related check re-run on a tree it already answered for ran again in full.

const SOURCE = 'scripts/a.ts'
const TREE: GateTree = { files: { [SOURCE]: 'digest-a' }, base: 'base-a' }
const CHANGED: GateTree = { ...TREE, files: { [SOURCE]: 'digest-b' } }
const GREEN = { before: TREE, exit_code: 0, tail: '\n✔ josh lint:related passed\n' }
const RED = { before: TREE, exit_code: 1, tail: '\n✘ josh lint:related failed: lint\n' }
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'tree-verdict-'))
const target = path.join(SCRATCH, 'record.json')

async function same_tree(): Promise<GateTree> {
	return TREE
}

async function moved_tree(): Promise<GateTree> {
	return CHANGED
}

beforeEach(() => {
	rmSync(target, { force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true })
})

describe('tree_verdict.read', () => {
	it('answers the verdict recorded on the same tree', async () => {
		await tree_verdict.record(GREEN, same_tree, target)

		expect(tree_verdict.read({ ...TREE }, target)).toMatchObject({ exit_code: 0, tail: GREEN.tail })
	})

	it('answers nothing once one file content changes', async () => {
		await tree_verdict.record(GREEN, same_tree, target)

		expect(tree_verdict.read(CHANGED, target)).toBeUndefined()
	})

	it('answers nothing on a moved base or an unread tree', async () => {
		await tree_verdict.record(GREEN, same_tree, target)

		expect(tree_verdict.read({ ...TREE, base: 'base-b' }, target)).toBeUndefined()
		expect(tree_verdict.read({ ...TREE, base: undefined }, target)).toBeUndefined()
		expect(tree_verdict.read(undefined, target)).toBeUndefined()
	})

	it('answers nothing once an environment value a check reads changes', async () => {
		vi.stubEnv('TZ', 'UTC')
		await tree_verdict.record(GREEN, same_tree, target)
		vi.stubEnv('TZ', 'Asia/Tokyo')

		expect(tree_verdict.read(TREE, target)).toBeUndefined()
	})
})

describe('tree_verdict.record', () => {
	it('keeps nothing when the tree moved while the check ran', async () => {
		await tree_verdict.record(GREEN, moved_tree, target)

		expect(tree_verdict.read(TREE, target)).toBeUndefined()
	})
})

describe('tree_verdict.replay', () => {
	it('prints the reuse line and the green tail, and answers the green exit code', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await tree_verdict.record(GREEN, same_tree, target)
		const kept = tree_verdict.read(TREE, target)

		expect(kept && tree_verdict.replay(kept, target)).toBe(0)
		expect(String(write.mock.calls[0]?.[0])).toMatch(
			/^reused: tree [\da-f]{12} green at \S+\n\n✔ josh lint:related passed\n$/u,
		)
	})

	it('prints a notice asked again between the reuse line and the kept tail', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await tree_verdict.record(GREEN, same_tree, target)
		const kept = tree_verdict.read(TREE, target)

		expect(kept && tree_verdict.replay(kept, target, 'live notice')).toBe(0)
		expect(String(write.mock.calls[0]?.[0])).toMatch(
			/^reused: tree [\da-f]{12} green at \S+\n\nlive notice\n\n✔ josh lint:related passed\n$/u,
		)
	})

	it('keeps a red verdict red, naming the record that re-runs it', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await tree_verdict.record(RED, same_tree, target)
		const kept = tree_verdict.read(TREE, target)

		expect(kept && tree_verdict.replay(kept, target)).toBe(1)
		expect(String(write.mock.calls[0]?.[0])).toContain(` red at `)
		expect(String(write.mock.calls[0]?.[0])).toContain(`remove ${target} to run it again`)
	})
})
