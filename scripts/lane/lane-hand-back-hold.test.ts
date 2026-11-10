import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_hand_back_hold } from './lane-hand-back-hold'

// joshuafolkken/kit#7159: a driver handing back a full pool leaves `<ledger>.hand-back` with its reason,
// and clears it on its next ledger line.

const make_directory = temporary_directory('suite')
const scratch = make_directory('lane-hand-back-hold-test-')
const REASON = 'hand-back:window'

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

describe('lane_hand_back_hold', () => {
	it('writes the hand-back reason beside the ledger', async () => {
		const target = ledger('mark')

		await lane_hand_back_hold.mark(REASON, target)

		expect(lane_hand_back_hold.read(target)).toBe(REASON)
	})

	it('clears the mark', async () => {
		const target = ledger('clear')

		await lane_hand_back_hold.mark(REASON, target)
		await lane_hand_back_hold.clear(target)

		expect(lane_hand_back_hold.read(target)).toBeUndefined()
	})

	it('clears quietly where no mark stands', async () => {
		await expect(lane_hand_back_hold.clear(ledger('absent'))).resolves.toBeUndefined()
	})

	it('swallows a mark that cannot be written', async () => {
		const unwritable = path.join(scratch, 'missing-directory', 'ledger.jsonl')

		await lane_hand_back_hold.mark(REASON, unwritable)

		expect(lane_hand_back_hold.read(unwritable)).toBeUndefined()
	})
})
