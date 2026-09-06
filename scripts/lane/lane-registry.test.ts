import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1490: the open lanes and their seats are read from git and from each lane's own
// `.env`, never from a ledger. That is what makes `git worktree remove` erase the record of a seat
// along with the tree that held it, and what stops a closed-and-reopened lane taking the seat a
// running lane is still using.

vi.mock('#scripts/git/git-command', () => ({ git_command: { worktree_list: vi.fn() } }))

const { git_command } = await import('#scripts/git/git-command')
const { lane_registry } = await import('./lane-registry')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-registry-test-'))
const MAIN_TREE = path.join(scratch, 'kit')
const LANE_ROOT = path.join(scratch, 'lanes')

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

const HEAD_LINE = 'HEAD 0000000000000000000000000000000000000000'

function lane_block(issue: string, extra: ReadonlyArray<string> = []): string {
	const directory = path.join(LANE_ROOT, issue)

	return [`worktree ${directory}`, HEAD_LINE, `branch refs/heads/lane/${issue}`, ...extra].join(
		'\n',
	)
}

function main_block(): string {
	return [`worktree ${MAIN_TREE}`, HEAD_LINE, 'branch refs/heads/main'].join('\n')
}

function open_on_disk(issue: string, seed: string | undefined): void {
	const directory = path.join(LANE_ROOT, issue)

	mkdirSync(directory, { recursive: true })

	if (seed !== undefined) writeFileSync(path.join(directory, '.env'), `PORT_SEED=${seed}\n`)
}

function list_of(...blocks: ReadonlyArray<string>): void {
	vi.mocked(git_command.worktree_list).mockResolvedValue(`${blocks.join('\n\n')}\n`)
}

beforeEach(() => {
	rmSync(LANE_ROOT, { force: true, recursive: true })
	mkdirSync(LANE_ROOT, { recursive: true })
})

describe('reading the open lanes', () => {
	it('reports the lane work trees and ignores the main one', async () => {
		open_on_disk('1490', '6')
		list_of(main_block(), lane_block('1490'))

		const lanes = await lane_registry.list_lanes()

		expect(lanes.map((lane) => lane.issue)).toStrictEqual(['1490'])
		expect(lanes[0]?.branch).toBe('lane/1490')
	})

	it('takes each seat from that lane own .env, which is the only place it is kept', async () => {
		open_on_disk('1490', '6')
		open_on_disk('1491', '8')
		list_of(main_block(), lane_block('1491'), lane_block('1490'))

		const lanes = await lane_registry.list_lanes()

		expect(lanes.map((lane) => lane.seed)).toStrictEqual([6, 8])
		expect(lane_registry.used_seeds(lanes)).toStrictEqual([6, 8])
	})

	// Stranded is the directory being gone, not git's `prunable` flag: git marks a registration
	// prunable for a damaged `.git` pointer too, and that lane's ports are still bound.
	it('reads a registration whose work tree is gone as stranded, holding no seat', async () => {
		list_of(lane_block('1491', ['prunable gitdir file points to non-existent location']))

		const lanes = await lane_registry.list_lanes()

		expect(lanes[0]?.is_stranded).toBe(true)
		expect(lane_registry.used_seeds(lanes)).toStrictEqual([])
	})

	// Read as free, the seat would be handed to the next lane while the ports it holds are still
	// bound — the silent failure `playwright.config.ts` refuses to add by dying on a busy port.
	it('reports a live lane whose .env cannot be read, rather than treating its seat as free', async () => {
		open_on_disk('1490', undefined)
		list_of(lane_block('1490'))

		const lanes = await lane_registry.list_lanes()

		expect(lanes[0]?.seed).toBeUndefined()
		expect(lane_registry.unreadable_lanes(lanes).map((lane) => lane.issue)).toStrictEqual(['1490'])
	})
})

describe('what does not count as a lane', () => {
	// Nothing reserves the `lane/` prefix, and `lane:close --all` deletes the directory of every lane
	// it is told about — so a hand-made branch under that prefix must not read as one.
	it('ignores a lane branch whose name is not an issue number', () => {
		const spike = [`worktree ${LANE_ROOT}/spike`, HEAD_LINE, 'branch refs/heads/lane/spike'].join(
			'\n',
		)

		expect(lane_registry.parse_block(spike)).toBeUndefined()
	})

	// `read_root_seed` answers 0 for a file with no seed line, and 0 is the main work tree's seat — so
	// a lane booked there would be treated as sharing it while it still runs on its own ports.
	it('reports a lane whose .env lost its seed line, rather than booking it on seat 0', async () => {
		open_on_disk('1490', undefined)
		writeFileSync(path.join(LANE_ROOT, '1490', '.env'), 'TELEGRAM_CHAT_ID=42\n')
		list_of(lane_block('1490'))

		const lanes = await lane_registry.list_lanes()

		expect(lanes[0]?.seed).toBeUndefined()
		expect(lane_registry.unreadable_lanes(lanes)).toHaveLength(1)
	})

	it('ignores a block with no branch line, such as a detached work tree', () => {
		const detached = ['worktree /somewhere', HEAD_LINE, 'detached'].join('\n')

		expect(lane_registry.parse_block(detached)).toBeUndefined()
	})
})

describe('finding one lane', () => {
	it('finds the lane for an issue, and answers undefined for one that has none', async () => {
		open_on_disk('1490', '6')
		list_of(lane_block('1490'))

		const lanes = await lane_registry.list_lanes()

		expect(lane_registry.find_lane(lanes, '1490')?.branch).toBe('lane/1490')
		expect(lane_registry.find_lane(lanes, '9999')).toBeUndefined()
	})
})
