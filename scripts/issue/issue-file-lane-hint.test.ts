import { lane_net_read } from '#scripts/lane/lane-net-read'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_file_lane_hint } from './issue-file-lane-hint'

// joshuafolkken/kit#5225: a refused `--found-during <N>` filing prints the causing-lane line filled
// from `josh lane:net <N>`.

const ORIGIN = '5168'
const MINUTES = 35
const BARE_BODY = '## 背景\n\n- 種別: 非不具合\n'
const net_minutes_of = vi.spyOn(lane_net_read, 'net_minutes_of')

afterEach(() => {
	vi.clearAllMocks()
})

describe('issue_file_lane_hint.lines_of', () => {
	it("ends in the causing-lane line filled from the origin's net minutes", async () => {
		net_minutes_of.mockResolvedValue(MINUTES)

		const lines = await issue_file_lane_hint.lines_of(ORIGIN, BARE_BODY)

		expect(net_minutes_of).toHaveBeenCalledExactlyOnceWith(Number(ORIGIN))
		expect(lines.at(0)).toContain(`josh lane:net ${ORIGIN}`)
		expect(lines.at(-1)).toBe(`- 原因のレーン: ${String(MINUTES)} 分（#${ORIGIN}）`)
	})

	it('prints nothing when the ledger holds no dispatch and merge of the origin', async () => {
		net_minutes_of.mockResolvedValue(undefined)

		await expect(issue_file_lane_hint.lines_of(ORIGIN, BARE_BODY)).resolves.toEqual([])
	})

	it('reads nothing without --found-during or once the body declares a causing lane', async () => {
		const declared = `${BARE_BODY}- 原因のレーン: 12 分（#${ORIGIN}）\n`

		await expect(issue_file_lane_hint.lines_of(undefined, BARE_BODY)).resolves.toEqual([])
		await expect(issue_file_lane_hint.lines_of(ORIGIN, declared)).resolves.toEqual([])
		expect(net_minutes_of).not.toHaveBeenCalled()
	})
})
