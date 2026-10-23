import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan } from './gate-plan'
import { gate_tree, type GateTree } from './gate-tree'
import { since_green } from './since-green'

// joshuafolkken/kit#4393: a lane's ship retry re-ran the scoped pair and the gate's unit step over the
// whole branch diff. Each now reads only what moved since its last green run on this checkout — a main
// sync's own changes included — and the whole branch change wherever that cannot be told.

const PREFIX = 'since-green-test-'
const scratch = mkdtempSync(path.join(tmpdir(), PREFIX))
const stamp = file_map_stamp.create(PREFIX, scratch, () => 'inputs-a')
const other_inputs = file_map_stamp.create(PREFIX, scratch, () => 'inputs-b')
const FROM_MAIN = 'scripts/from-main.ts'
const MANIFEST = 'package.json'
const ESLINT_CONFIG = 'eslint.config.js'
const read_git = vi.spyOn(git_spawn, 'read')
const read_tree = vi.spyOn(gate_tree, 'read_gate_tree')
const SOURCE = 'scripts/a.ts'
const FIXED = 'scripts/b.ts'
const RECORDED: GateTree = { files: { [SOURCE]: 'digest-a', [FIXED]: 'digest-b' }, base: 'base-a' }
const LABEL = 'josh test:related'
const { LINT_LABEL, UNIT_LABEL } = gate_plan

function record_at(name: string, tree: GateTree = RECORDED, writer = stamp): string {
	const target = path.join(scratch, `${name}.json`)

	writer.write(tree.files, target, tree.base)

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

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('edited')),
		).resolves.toStrictEqual([FIXED])
	})

	it('includes what a main sync brought in when the merge base moved', async () => {
		tree_now({ [SOURCE]: 'digest-a', [FIXED]: 'digest-b2' }, 'base-b')
		base_moved(FROM_MAIN)

		const moved = await since_green.read_moved(stamp, LINT_LABEL, record_at('synced'))

		expect(moved).toStrictEqual([FIXED, FROM_MAIN])
		expect(read_git).toHaveBeenCalledWith(expect.arrayContaining(['base-a', 'base-b']))
	})

	// joshuafolkken/kit#4495: each check stops only on its own declared configuration.
	it('reads the unit step past a moved lint configuration', async () => {
		tree_now({ ...RECORDED.files, [ESLINT_CONFIG]: 'digest-e' })

		await expect(
			since_green.read_moved(stamp, UNIT_LABEL, record_at('unit-eslint')),
		).resolves.toStrictEqual([ESLINT_CONFIG])
	})
})

// joshuafolkken/kit#4465: `josh test:related` records how much of its input a main sync brought in.
describe('since_green.read_moved_parts — the main sync kept apart', () => {
	it('answers the edited files and what the main sync brought in as two lists', async () => {
		tree_now({ [SOURCE]: 'digest-a', [FIXED]: 'digest-b2' }, 'base-b')
		base_moved(FROM_MAIN)

		await expect(
			since_green.read_moved_parts(stamp, UNIT_LABEL, record_at('parts')),
		).resolves.toStrictEqual({
			changed: [FIXED],
			synced: [FROM_MAIN],
		})
	})

	it('answers undefined when the main sync brought in a toolchain file', async () => {
		tree_now(RECORDED.files, 'base-b')
		base_moved(MANIFEST)

		await expect(
			since_green.read_moved_parts(stamp, UNIT_LABEL, record_at('synced-manifest')),
		).resolves.toBeUndefined()
	})
})

describe('since_green.read_moved — when it reads the whole branch instead', () => {
	it('answers undefined with no green record', async () => {
		tree_now({ [FIXED]: 'digest-b2' })

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, path.join(scratch, 'absent.json')),
		).resolves.toBeUndefined()
	})

	it('answers an empty list, not undefined, when nothing moved since the record', async () => {
		tree_now(RECORDED.files)

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('unmoved')),
		).resolves.toStrictEqual([])
	})

	it('answers undefined when a moved file configures the toolchain', async () => {
		tree_now({ ...RECORDED.files, [MANIFEST]: 'digest-p' })

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('manifest')),
		).resolves.toBeUndefined()
	})

	it('answers undefined when a moved file configures the linters', async () => {
		tree_now({ ...RECORDED.files, [ESLINT_CONFIG]: 'digest-e' })

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('eslint')),
		).resolves.toBeUndefined()
	})
})

describe('since_green.read_moved — when the record cannot be compared', () => {
	// joshuafolkken/kit#4495: a record written under other tool versions or environment vouches for nothing.
	it('answers undefined when the record was written under other inputs', async () => {
		tree_now(RECORDED.files)

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('other-inputs', RECORDED, other_inputs)),
		).resolves.toBeUndefined()
	})

	it('answers undefined when the base diff cannot be read', async () => {
		tree_now(RECORDED.files, 'base-b')
		read_git.mockRejectedValue(new Error('bad revision'))

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('unreadable')),
		).resolves.toBeUndefined()
	})

	it('answers undefined when the current base could not be resolved', async () => {
		read_tree.mockResolvedValue({ files: { [FIXED]: 'digest-b2' }, base: undefined })

		await expect(
			since_green.read_moved(stamp, LINT_LABEL, record_at('no-base')),
		).resolves.toBeUndefined()
	})
})

describe('since_green.describe', () => {
	it('names the command and how many files it narrowed to', () => {
		expect(since_green.describe(LABEL, [SOURCE, FIXED])).toBe(
			'josh test:related: reading only the 2 file(s) changed since its last green run on this checkout.',
		)
	})
})
