import { randomUUID } from 'node:crypto'
import { durable_state } from '#scripts/josh/durable-state'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, expect, it, vi } from 'vitest'
import { run_ship_detach } from './run-ship-detach'

const ISSUE = '5473'
const DEAD_PID = 2_147_483_646
const INVOCATION = 'pnpm josh ship --detach --body-file body.md "Resume #5473"'

afterEach(() => vi.unstubAllEnvs())

it.each(['current', 'older'])(
	'keeps a stop invocation only for the current launch: %s',
	async (launch_id) => {
		const repository = `ship-stop-test-${randomUUID()}`
		const target = durable_state.path(`${durable_state.PREFIX.SHIP_RESULT}${ISSUE}-`, repository)

		stamp_file.replace_stamp(target, { pid: DEAD_PID, launch_id: 'current' })
		vi.stubEnv(run_ship_detach.LAUNCH_ID_KEY, launch_id)
		await run_ship_detach.mark_stop(repository, ISSUE, INVOCATION)
		await run_ship_detach.mark_result(repository, ISSUE, 1)
		expect(run_ship_detach.read_result(repository, ISSUE)?.stop_invocation).toBe(
			launch_id === 'current' ? INVOCATION : undefined,
		)
		stamp_file.remove_stamp(target)
	},
)
