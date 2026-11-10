import { randomUUID } from 'node:crypto'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import type { JoshResult } from '#scripts/josh/josh-run'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { run_ship_preflight_reuse, type PreflightKey } from './run-ship-preflight-reuse'

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: vi.fn() } }))

const TREE: GateTree = { base: 'base-sha', files: { 'a.ts': 'digest-a' } }
const READY = { code: 0, out: 'ready' }
const REFUSED = { code: 1, out: 'refused' }
const MOVED_BASE = 'moved-base'

const KEY: PreflightKey = { issue: randomUUID(), inputs: 'title #1\nbody' }

function asked(result: JoshResult): Mock<() => Promise<JoshResult>> {
	return vi.fn(async () => await result)
}

async function pass_once(): Promise<void> {
	await run_ship_preflight_reuse.run(KEY, asked(READY))
}

beforeEach(() => {
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
})

afterEach(() => {
	run_ship_preflight_reuse.stamp(KEY).remove()
})

describe('run_ship_preflight_reuse.run — a passed preflight', () => {
	it('skips the second preflight on the same tree, base, title and body', async () => {
		await pass_once()
		const ask = asked(READY)
		const result = await run_ship_preflight_reuse.run(KEY, ask)

		expect(ask).not.toHaveBeenCalled()
		expect(result).toEqual({ code: 0, out: run_ship_preflight_reuse.REUSED })
	})

	it.each<GateTree>([
		{ base: 'base-sha', files: { 'a.ts': 'digest-b' } },
		{ base: MOVED_BASE, files: { 'a.ts': 'digest-a' } },
		{ base: 'base-sha', files: { 'a.ts': 'digest-a', 'b.ts': 'digest-c' } },
	])('asks again when the tree or base moved: %j', async (moved) => {
		await pass_once()
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(moved)
		const ask = asked(READY)

		await run_ship_preflight_reuse.run(KEY, ask)

		expect(ask).toHaveBeenCalledOnce()
	})

	it('asks again when the title or the body changed', async () => {
		await pass_once()
		const ask = asked(READY)

		await run_ship_preflight_reuse.run({ ...KEY, inputs: 'title #1\nbody with evidence' }, ask)

		expect(ask).toHaveBeenCalledOnce()
	})
})

describe('run_ship_preflight_reuse.run — no pass to reuse', () => {
	it('never reuses a refused preflight', async () => {
		await run_ship_preflight_reuse.run(KEY, asked(REFUSED))
		const ask = asked(READY)

		await run_ship_preflight_reuse.run(KEY, ask)

		expect(ask).toHaveBeenCalledOnce()
	})

	it('asks every time when no issue keys the record', async () => {
		const ask = asked(READY)

		await run_ship_preflight_reuse.run(undefined, ask)
		await run_ship_preflight_reuse.run(undefined, ask)

		expect(ask).toHaveBeenCalledTimes(2)
	})

	it('records the tree read before the preflight, not edits made during it', async () => {
		const ask = vi.fn(async () => {
			vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({
				...TREE,
				files: { 'a.ts': 'edited' },
			})

			return await READY
		})

		await run_ship_preflight_reuse.run(KEY, ask)
		const again = asked(READY)

		await run_ship_preflight_reuse.run(KEY, again)

		expect(again).toHaveBeenCalledOnce()
	})
})

describe('run_ship_preflight_reuse.run — a refused preflight after a pass', () => {
	it('drops the older pass, so the passed tree is asked again', async () => {
		await pass_once()
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({ ...TREE, base: MOVED_BASE })
		await run_ship_preflight_reuse.run(KEY, asked(REFUSED))
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
		const ask = asked(READY)

		await run_ship_preflight_reuse.run(KEY, ask)

		expect(ask).toHaveBeenCalledOnce()
	})
})
