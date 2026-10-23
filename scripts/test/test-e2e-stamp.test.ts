import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { afterAll, describe, expect, it } from 'vitest'
import { test_e2e_stamp } from './test-e2e-stamp'

const scratch = mkdtempSync(path.join(tmpdir(), 'test-e2e-stamp-test-'))
const BASE = 'base-commit'
const FILE_A = 'src/a.ts'
const FILE_B = 'src/b.ts'
const TREE: GateTree = { files: { [FILE_A]: 'digest-a' }, base: BASE }

function stamp_at(name: string): string {
	return path.join(scratch, `${name}.json`)
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('the record of a green test:e2e', () => {
	it('matches the tree it was taken on', () => {
		const target = stamp_at('same')

		test_e2e_stamp.record(TREE, target)

		expect(test_e2e_stamp.is_current(TREE, target)).toBe(true)
	})

	it.each([
		['an edited file', { ...TREE, files: { [FILE_A]: 'digest-b' } }],
		['an added file', { ...TREE, files: { ...TREE.files, [FILE_B]: 'digest-b' } }],
		['a moved base', { ...TREE, base: 'other-base' }],
		['an unread base', { ...TREE, base: undefined }],
	])('does not match after %s', (_label, moved: GateTree) => {
		const target = stamp_at('moved')

		test_e2e_stamp.record(TREE, target)

		expect(test_e2e_stamp.is_current(moved, target)).toBe(false)
	})

	it('does not match where no record was written', () => {
		expect(test_e2e_stamp.is_current(TREE, stamp_at('absent'))).toBe(false)
	})
})
