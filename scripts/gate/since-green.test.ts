import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_tree, type GateTree } from './gate-tree'
import { since_green } from './since-green'

// joshuafolkken/kit#4393: a lane's ship retry re-ran the scoped pair and the gate's unit step over the
// whole branch diff. Each now reads only what moved since its last green run on this checkout — a main
// sync's own changes included — and the whole branch change wherever that cannot be told.

const PREFIX = 'since-green-test-'
const scratch = mkdtempSync(path.join(tmpdir(), PREFIX))
const stamp = file_map_stamp.create(PREFIX, scratch)
const FROM_MAIN = 'scripts/from-main.ts'
const MANIFEST = 'package.json'
const ESLINT_CONFIG = 'eslint.config.js'
const read_git = vi.spyOn(git_spawn, 'read')
const read_tree = vi.spyOn(gate_tree, 'read_gate_tree')
const SOURCE = 'scripts/a.ts'
const FIXED = 'scripts/b.ts'
const RECORDED: GateTree = { files: { [SOURCE]: 'digest-a', [FIXED]: 'digest-b' }, base: 'base-a' }
const LABEL = 'josh test:related'

function record_at(name: string, tree: GateTree = RECORDED): string {
	const target = path.join(scratch, `${name}.json`)

	stamp.write(tree.files, target, tree.base)

	return target
}

function tree_now(files: Record<string, string>, base = 'base-a'): void {
	read_tree.mockResolvedValue({ files, base })
}

function base_moved(...paths: ReadonlyArray<string>): void {
	read_git.mockResolvedValue(paths.map((name) => `${name}\0`).join(''))
}

beforeEach(() => {
	read_git.mockReset()
	read_tree.mockReset()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('since_green.read_moved — what it narrows to', () => {
	it('answers only the file edited since the green record', async () => {
		tree_now({ [SOURCE]: 'digest-a', [FIXED]: 'digest-b2' })

		await expect(since_green.read_moved(stamp, record_at('edited'))).resolves.toStrictEqual([FIXED])
	})

	it('includes what a main sync brought in when the merge base moved', async () => {
		tree_now({ [SOURCE]: 'digest-a', [FIXED]: 'digest-b2' }, 'base-b')
		base_moved(FROM_MAIN)

		const moved = await since_green.read_moved(stamp, record_at('synced'))

		expect(moved).toStrictEqual([FIXED, FROM_MAIN])
		expect(read_git).toHaveBeenCalledWith(expect.arrayContaining(['base-a', 'base-b']))
	})
})

// joshuafolkken/kit#4465: `josh test:related` records how much of its input a main sync brought in.
describe('since_green.read_moved_parts — the main sync kept apart', () => {
	it('answers the edited files and what the main sync brought in as two lists', async () => {
		tree_now({ [SOURCE]: 'digest-a', [FIXED]: 'digest-b2' }, 'base-b')
		base_moved(FROM_MAIN)

		await expect(since_green.read_moved_parts(stamp, record_at('parts'))).resolves.toStrictEqual({
			changed: [FIXED],
			synced: [FROM_MAIN],
		})
	})

	it('answers undefined when the main sync brought in a toolchain file', async () => {
		tree_now(RECORDED.files, 'base-b')
		base_moved(MANIFEST)

		await expect(
			since_green.read_moved_parts(stamp, record_at('synced-manifest')),
		).resolves.toBeUndefined()
	})
})

describe('since_green.read_moved — when it reads the whole branch instead', () => {
	it('answers undefined with no green record', async () => {
		tree_now({ [FIXED]: 'digest-b2' })

		await expect(
			since_green.read_moved(stamp, path.join(scratch, 'absent.json')),
		).resolves.toBeUndefined()
	})

	it('answers an empty list, not undefined, when nothing moved since the record', async () => {
		tree_now(RECORDED.files)

		await expect(since_green.read_moved(stamp, record_at('unmoved'))).resolves.toStrictEqual([])
	})

	it('answers undefined when a moved file configures the toolchain', async () => {
		tree_now({ ...RECORDED.files, [MANIFEST]: 'digest-p' })

		await expect(since_green.read_moved(stamp, record_at('manifest'))).resolves.toBeUndefined()
	})

	it('answers undefined when a moved file configures the linters', async () => {
		tree_now({ ...RECORDED.files, [ESLINT_CONFIG]: 'digest-e' })

		await expect(since_green.read_moved(stamp, record_at('eslint'))).resolves.toBeUndefined()
	})

	it('answers undefined when the base diff cannot be read', async () => {
		tree_now(RECORDED.files, 'base-b')
		read_git.mockRejectedValue(new Error('bad revision'))

		await expect(since_green.read_moved(stamp, record_at('unreadable'))).resolves.toBeUndefined()
	})

	it('answers undefined when the current base could not be resolved', async () => {
		read_tree.mockResolvedValue({ files: { [FIXED]: 'digest-b2' }, base: undefined })

		await expect(since_green.read_moved(stamp, record_at('no-base'))).resolves.toBeUndefined()
	})
})

describe('since_green.describe', () => {
	it('names the command and how many files it narrowed to', () => {
		expect(since_green.describe(LABEL, [SOURCE, FIXED])).toBe(
			'josh test:related: reading only the 2 file(s) changed since its last green run on this checkout.',
		)
	})
})
