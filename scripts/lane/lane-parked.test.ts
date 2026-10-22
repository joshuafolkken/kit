import { beforeEach, expect, it, vi } from 'vitest'
import { lane_parked } from './lane-parked'

const read_mock = vi.hoisted(() => vi.fn())
const ISSUE = '3878'

vi.mock('#scripts/issue/issue-state-cli', () => ({ issue_state_cli: { read_issue: read_mock } }))

function labelled(labels: ReadonlyArray<string>): void {
	read_mock.mockResolvedValue({ kind: 'state', state: { state: 'OPEN', labels } })
}

beforeEach(() => {
	read_mock.mockReset()
})

it('reads an issue labelled needs-decision as parked', async () => {
	labelled(['bug', 'needs-decision'])

	expect(await lane_parked.is_parked(ISSUE)).toBe(true)
	expect(read_mock).toHaveBeenCalledWith(ISSUE)
})

// joshuafolkken/kit#4102: a mechanical park is a park too.
it('reads an issue labelled run:stalled as parked', async () => {
	labelled(['run:stalled'])

	expect(await lane_parked.is_parked(ISSUE)).toBe(true)
})

it('reads an issue without needs-decision as not parked', async () => {
	labelled(['bug', 'in-progress'])

	expect(await lane_parked.is_parked(ISSUE)).toBe(false)
})

it.each([{ kind: 'missing' }, { kind: 'unreadable', reason: 'network' }])(
	'reads an issue whose state is $kind as not parked',
	async (read) => {
		read_mock.mockResolvedValue(read)

		expect(await lane_parked.is_parked(ISSUE)).toBe(false)
	},
)
