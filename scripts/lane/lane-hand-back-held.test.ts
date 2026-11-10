import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_hand_back_held } from './lane-hand-back-held'
import { lane_hand_back_hold } from './lane-hand-back-hold'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'

// joshuafolkken/kit#7121: a lane freed while no driver runs turns a full driver's hand-back mark into a
// hold with the mark's reason; with no mark — a running driver clears it — nothing is held.

const make_directory = temporary_directory('suite')
const scratch = make_directory('lane-hand-back-held-test-')
const REASON = 'hand-back:window'

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

function kinds(target: string): Array<string> {
	return lane_ledger.read_entries(target).map((entry) => entry.kind)
}

describe('lane_hand_back_held.record', () => {
	it('holds by the mark’s reason after the driver’s release, taking the mark', async () => {
		const target = ledger('marked')

		await lane_ledger_write.record_released(target)
		await lane_hand_back_hold.mark(REASON, target)
		await lane_hand_back_held.record(target)

		expect(lane_ledger.read_entries(target).at(-1)).toMatchObject({
			kind: 'held',
			reason: `${lane_hand_back_held.DRIVERLESS_PREFIX}${REASON}`,
		})
		expect(lane_hand_back_hold.read(target)).toBeUndefined()
	})

	it('holds nothing without a mark, as under a running driver on a full pool', async () => {
		const target = ledger('unmarked')

		await lane_ledger_write.record_released(target)
		await lane_hand_back_held.record(target)

		expect(kinds(target)).toStrictEqual(['released'])
	})

	it('leaves a hold already open standing, and takes the mark', async () => {
		const target = ledger('open')

		await lane_ledger_write.record_held({ reason: 'memory' }, target)
		await lane_hand_back_hold.mark(REASON, target)
		await lane_hand_back_held.record(target)

		expect(kinds(target)).toStrictEqual(['held'])
		expect(lane_hand_back_hold.read(target)).toBeUndefined()
	})

	it('writes nothing outside a repository ledger', async () => {
		await expect(lane_hand_back_held.record()).resolves.toBeUndefined()
	})
})
