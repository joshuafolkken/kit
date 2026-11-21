import path from 'node:path'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { core_wait_record } from './core-wait-record'
import { gate_labels } from './gate-labels'
import { gate_tree } from './gate-tree'
import { scoped_green } from './scoped-green'
import { since_green } from './since-green'

const make_directory = temporary_directory()
const PREFIX = 'verification-record-options-'
const SOURCE = 'scripts/source.ts'
const FILES = { [SOURCE]: 'digest-a' }
const TREE = { files: FILES, base: 'base-a' }
const BLOBS = { [SOURCE]: 'input-a' }
const CLAIMED_AT = 1000
const ADMITTED_AT = 4000
const WAITED_MS = ADMITTED_AT - CLAIMED_AT

afterEach(() => {
	vi.restoreAllMocks()
})

describe('core wait default record options', () => {
	it.each([undefined, { sink: undefined, admission: undefined }])(
		'uses the ledger with default options %j',
		async (options) => {
			const sink = vi.spyOn(lane_ledger_write, 'record_core_wait').mockResolvedValue(undefined)

			await core_wait_record.record_admitted(
				{ command: 'lint', wait_reason: 'cores', claimed_at: CLAIMED_AT },
				ADMITTED_AT,
				options,
			)

			expect(sink).toHaveBeenCalledExactlyOnceWith({ command: 'lint', waited_ms: WAITED_MS })
		},
	)
})

describe('file map stamp options', () => {
	it.each([undefined, { target: undefined, base: undefined, blobs: undefined }])(
		'writes default options %j without optional payload fields',
		(options) => {
			const stamp = file_map_stamp.create(PREFIX, make_directory(PREFIX))

			try {
				expect(stamp.write(FILES, options)).toBe(stamp.stamp_path())
				expect(stamp.read()).toMatchObject({ files: FILES })
				expect(stamp.read()).not.toHaveProperty('base')
				expect(stamp.read()).not.toHaveProperty('blobs')
			} finally {
				stamp.remove()
			}
		},
	)

	it('writes an explicit target, base and blobs without writing the default path', () => {
		const root = make_directory(PREFIX)
		const stamp = file_map_stamp.create(PREFIX, root, () => 'inputs-a')
		const target = path.join(root, 'explicit.json')

		expect(stamp.write(FILES, { target, base: TREE.base, blobs: BLOBS })).toBe(target)
		expect(stamp.read(target)).toMatchObject({ files: FILES, base: TREE.base, blobs: BLOBS })
		expect(stamp.read()).toBeUndefined()
	})
})

describe('scoped green default record options', () => {
	it.each([undefined, { target: undefined, blobs: undefined }])(
		'records green with default options %j and compares the current tree',
		async (options) => {
			const stamp = file_map_stamp.create(PREFIX, make_directory(PREFIX))
			const read = vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue(TREE)

			try {
				scoped_green.record_green(stamp, TREE, options)
				expect(stamp.read()?.base).toBe(TREE.base)
				await expect(
					since_green.read_verdict(stamp, gate_labels.LINT_LABEL, {
						source: undefined,
						tree: undefined,
					}),
				).resolves.toEqual({
					parts: { changed: [], synced: [] },
				})
				read.mockResolvedValue({ ...TREE, files: { [SOURCE]: 'digest-b' } })
				await expect(since_green.read_moved_parts(stamp, gate_labels.LINT_LABEL)).resolves.toEqual({
					changed: [SOURCE],
					synced: [],
				})
			} finally {
				stamp.remove()
			}
		},
	)
})

describe('scoped green explicit record options', () => {
	it('passes explicit green target and blobs and compares the supplied tree', async () => {
		const root = make_directory(PREFIX)
		const stamp = file_map_stamp.create(PREFIX, root)
		const target = path.join(root, 'green.json')
		const read = vi.spyOn(gate_tree, 'read_gate_tree')

		scoped_green.record_green(stamp, TREE, { target, blobs: BLOBS })
		expect(stamp.read(target)).toMatchObject({ files: FILES, base: TREE.base, blobs: BLOBS })
		await expect(
			since_green.read_moved_parts(stamp, gate_labels.LINT_LABEL, {
				source: target,
				tree: TREE,
			}),
		).resolves.toEqual({ changed: [], synced: [] })
		expect(read).not.toHaveBeenCalled()
		expect(stamp.read()).toBeUndefined()
	})
})
