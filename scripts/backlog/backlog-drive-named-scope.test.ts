import { epic_busy, type BusyRead } from '#scripts/epic/epic-busy'
import { epic_solo_stale } from '#scripts/epic/epic-solo-stale'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state } from '#scripts/lane/lane-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_named_scope } from './backlog-drive-named-scope'
import { backlog_plan_comment } from './backlog-plan-comment'

// joshuafolkken/kit#8953: the gathered named issues are gated on what the pool's gate reads.

const REPO = 'joshuafolkken/kit'
const NAMED = 10
const IN_FLIGHT = 3
const BUSY: BusyRead = { kind: 'idle' }
const RELEASED: BusyRead = { kind: 'busy', issues: [] }
const DECLARED = new Map([[NAMED, new Set(['scripts/lane/lane-plan.ts'])]])
const HELD = new Map([[IN_FLIGHT, new Set(['scripts/lane/lane-state.ts'])]])
const LANES = new Map()

function readable(): ReturnType<typeof vi.spyOn> {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(epic_busy, 'read_repository').mockResolvedValue(BUSY)
	vi.spyOn(epic_solo_stale, 'release').mockResolvedValue({ read: RELEASED })
	vi.spyOn(lane_plan, 'with_holder_plans').mockReturnValue(HELD)
	vi.spyOn(lane_state, 'read_states').mockResolvedValue(LANES)

	return vi.spyOn(backlog_plan_comment, 'declared_of').mockResolvedValue(DECLARED)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_named_scope.read', () => {
	it('reads nothing past an unreadable repository', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(undefined)
		const busy = vi.spyOn(epic_busy, 'read_repository')

		expect(await backlog_drive_named_scope.read([NAMED], [])).toBeUndefined()
		expect(busy).not.toHaveBeenCalled()
	})

	it('reads the released busy listing, the declared paths with holder plans, and the lanes', async () => {
		const declared = readable()

		expect(await backlog_drive_named_scope.read([NAMED], [String(IN_FLIGHT)])).toStrictEqual({
			read: RELEASED,
			repo: REPO,
			declared: HELD,
			lanes: LANES,
		})
		expect(declared).toHaveBeenCalledWith([{ number: NAMED }, { number: IN_FLIGHT }], process.cwd())
		expect(lane_plan.with_holder_plans).toHaveBeenCalledWith(DECLARED, [], process.cwd())
		expect(lane_state.read_states).toHaveBeenCalledWith([String(NAMED)])
	})

	it('prints the notice of a stale solo holder it released', async () => {
		readable()
		vi.spyOn(epic_solo_stale, 'release').mockResolvedValue({ read: RELEASED, notice: 'released' })
		const error = vi.spyOn(console, 'error').mockImplementation(vi.fn())

		await backlog_drive_named_scope.read([NAMED], [])

		expect(error).toHaveBeenCalledWith('released')
	})
})
