import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import { vi } from 'vitest'
import { backlog_drive_named_gate } from './backlog-drive-named-gate'

// A named launch reads each issue's blockers and the repository's solo / overlap scope
// (joshuafolkken/kit#8953). A suite that is not about either stubs both open: nothing blocks, and every
// plain named issue is admitted, so no case reaches `gh`.
function admit_all(): void {
	vi.spyOn(lane_dispatch_dependency, 'unfinished').mockResolvedValue([])
	vi.spyOn(backlog_drive_named_gate, 'admitted').mockImplementation(async (plain) =>
		plain.map((issue) => issue.number),
	)
}

export const backlog_drive_named_fixture = { admit_all }
