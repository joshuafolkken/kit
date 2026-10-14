import { claude_lane_broker } from '#scripts/lane/claude-lane-broker'
import { poll } from '#scripts/lib/poll'
import { run_carry } from '#scripts/run/carry/run-carry'
import type { WakeContext } from './run-wake-describe'
import { run_wake_loop, type LoopPorts, type LoopStop } from './run-wake-loop'
import { run_wake_restart, type RestartPorts } from './run-wake-restart'

// The supervisor's whole life: the restarting loop (`run-wake-restart.ts`), with the Claude lanes
// brokered beside it.
//
// **The lanes are brokered for the supervisor's life, not one drive's**: a lane's ship asks for its
// reviewer or its relaunch whenever it gets there, a hand-back to a session included, and only this
// process holds the token those sessions sign in with (joshuafolkken/kit#3817, `claude-lane-broker.ts`).

interface SuperviseTarget {
	context: WakeContext
	ports: LoopPorts
	interval_ms: number
	note: (text: string) => void
}

function restart_ports(target: SuperviseTarget): RestartPorts {
	const { context, ports, interval_ms } = target

	return {
		pass: async () => await run_wake_loop.run_loop(context.wake_target, ports, interval_ms),
		is_resumable: () => run_carry.read_carry(context.carry_target).kind === 'carried',
		pause: async () => {
			await poll.sleep(interval_ms)
		},
		note: target.note,
	}
}

async function supervise(target: SuperviseTarget): Promise<LoopStop> {
	return await claude_lane_broker.serve_during(
		async () => await run_wake_restart.supervise(restart_ports(target)),
	)
}

const run_wake_supervise = { supervise }

export { run_wake_supervise }
export type { SuperviseTarget }
