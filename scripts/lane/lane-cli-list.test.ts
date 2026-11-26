import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'

// joshuafolkken/kit#9035: `lane:list` reads the state of each unlabelled lane's issue, so a lane
// left behind by a closed issue is named as cleanup rather than as a claim another session could take.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: vi.fn().mockResolvedValue('joshuafolkken/kit') },
}))
vi.mock('#scripts/epic/epic-busy', () => ({
	epic_busy: { read_repository: vi.fn().mockResolvedValue({ kind: 'idle' }) },
}))
vi.mock('./lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))
vi.mock('./lane-spent', () => ({ lane_spent: { is_issue_closed: vi.fn() } }))

const { lane_registry } = await import('./lane-registry')
const { lane_spent } = await import('./lane-spent')
const { lane_occupancy } = await import('./lane-occupancy')
const { lane_cli } = await import('./lane-cli')

const OPEN_ISSUE = '9001'
const CLOSED_ISSUE = '9002'
const CLAIM_WARNING = 'another session could claim the same issue'

function lane(issue: string): LaneInfo {
	return {
		issue,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		branch: `${issue}-lane`,
		directory: `/w/.kit-lanes/${issue}`,
		is_stranded: false,
	}
}

async function listed_errors(): Promise<Array<string>> {
	await lane_cli.run(['list'])

	return vi.mocked(console.error).mock.calls.flatMap((call) => String(call[0]).split('\n'))
}

beforeEach(() => {
	vi.spyOn(console, 'log').mockReturnValue(undefined)
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane(OPEN_ISSUE), lane(CLOSED_ISSUE)])
	vi.mocked(lane_spent.is_issue_closed).mockImplementation(async (issue) => issue === CLOSED_ISSUE)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane:list splits unlabelled lanes by their issue state', () => {
	it('warns of a claim only for the lane whose issue is open', async () => {
		const lines = await listed_errors()
		const claims = lines.filter((line) => line.includes(CLAIM_WARNING))

		expect(claims).toHaveLength(1)
		expect(claims[0]).toContain(`#${OPEN_ISSUE}`)
	})

	it('names the closed issue lane as leftover with the command that discards it', async () => {
		const lines = await listed_errors()
		const leftover = lines.find((line) => line.includes(lane_occupancy.LEFTOVER))

		expect(leftover).toContain(`#${CLOSED_ISSUE}`)
		expect(leftover).toContain(`lane:close ${CLOSED_ISSUE}`)
	})
})
