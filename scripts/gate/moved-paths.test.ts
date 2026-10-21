import { git_spawn } from '#scripts/git/git-spawn'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moved_paths } from './moved-paths'

// What moved since a green record: the branch's own edits and what a main sync moved the base over,
// shared by the gate's per-check reuse and the scoped checks' since-green narrowing.

const read_git = vi.spyOn(git_spawn, 'read')
const SOURCE = 'scripts/a.ts'
const FROM_MAIN = 'scripts/from-main.ts'
const BASE_A = 'base-a'
const BASE_B = 'base-b'
const RECORD: FileMapStamp = {
	taken_at: '2026-10-21T00:00:00.000Z',
	files: { [SOURCE]: 'd1' },
	base: BASE_A,
}

beforeEach(() => {
	read_git.mockReset()
})

describe('moved_paths.moved_since', () => {
	it('answers the branch edits alone without asking git when the base did not move', async () => {
		const moved = await moved_paths.moved_since(RECORD, { files: { [SOURCE]: 'd2' }, base: BASE_A })

		expect(moved).toStrictEqual([SOURCE])
		expect(read_git).not.toHaveBeenCalled()
	})

	it('joins the base diff once, without repeating a path both halves name', async () => {
		read_git.mockResolvedValue(`${SOURCE}\0${FROM_MAIN}\0`)

		const moved = await moved_paths.moved_since(RECORD, { files: { [SOURCE]: 'd2' }, base: BASE_B })

		expect(moved).toStrictEqual([SOURCE, FROM_MAIN])
	})

	it('answers undefined when the record has no base', async () => {
		const baseless: FileMapStamp = { taken_at: RECORD.taken_at, files: RECORD.files }

		await expect(
			moved_paths.moved_since(baseless, { files: RECORD.files, base: BASE_A }),
		).resolves.toBeUndefined()
	})

	it('answers undefined when the tree map came back empty', async () => {
		await expect(
			moved_paths.moved_since(RECORD, { files: {}, base: BASE_A }),
		).resolves.toBeUndefined()
	})
})
