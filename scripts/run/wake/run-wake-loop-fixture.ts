import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { LoopPorts } from './run-wake-loop'
import type { LaunchResult } from './run-wake-session'

// The scripted ports the supervisor's loop tests run it against (`run-wake-loop*.test.ts`).

const NOW = new Date('2026-09-10T12:00:00.000Z')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const LAUNCHED: LaunchResult = { kind: 'launched', pid: 4242 }
const HANDOFF_MATERIAL = 'merge over #2500'
const HAND_OFF_CALL = 'hand_off'
const WAKE_CALL = 'wake'

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: INVOCATION,
		started_at: '2026-09-10T08:00:00.000Z',
		merged: 3,
		filed: 1,
		cuts: 2,
		failures: 0,
		outages: 0,
		...overrides,
	}
}

const HANDED_OFF: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }
const IN_FLIGHT: CarryRead = { kind: 'carried', carry: carry() }
const ENDED: CarryRead = { kind: 'none' }

interface Calls {
	wakes: Array<string>
	materials: Array<string>
	// The forced ids handed to `wake`, one per launch, deterministic so a test can assert exactly which
	// sessions the supervisor started (joshuafolkken/kit#2407).
	session_ids: Array<string>
	// Every hand-off and launch in call order, so a test can pin that the hand-off lands first
	// (joshuafolkken/kit#2437).
	order: Array<string>
}

interface Recorder extends Calls {
	ports: LoopPorts
}

async function settled(): Promise<void> {
	await Promise.resolve()
}

function wake_port(calls: Calls, launch: LaunchResult): LoopPorts['wake'] {
	return function wake(invocation: string, session_id: string, material: string): LaunchResult {
		calls.order.push(WAKE_CALL)
		calls.wakes.push(invocation)
		calls.materials.push(material)
		calls.session_ids.push(session_id)

		return launch
	}
}

function ports_of(remaining: Array<CarryRead>, calls: Calls, launch: LaunchResult): LoopPorts {
	return {
		read_carry: () => remaining.shift() ?? ENDED,
		// Liveness read from the record itself: a handed-off record's owner is the predecessor, whose
		// process is gone once `--cut` is its last write; a carried record no cut handed off is one a
		// live successor is spending. A test that needs a *dead* owner over a not-handed-off record —
		// the crash joshuafolkken/kit#2336 recovers — overrides this port with `() => false`.
		is_owner_live: (read) => read.kind === 'carried' && read.carry.is_handed_off !== true,
		// Work is there by default, so every test written before joshuafolkken/kit#2417 still sees
		// the record-only decision; the idle tests override this port.
		has_work: async () => true,
		new_session_id: () => `sid-${String(calls.session_ids.length + 1)}`,
		hand_off: () => {
			calls.order.push(HAND_OFF_CALL)
		},
		drive: async () => ({ kind: 'judgment', material: HANDOFF_MATERIAL }),
		wake: wake_port(calls, launch),
		sleep: settled,
		now: () => NOW,
		retry_closes: settled,
		is_code_stale: async () => false,
	}
}

// A scripted sequence of carry reads, one per pass, so a whole run of the supervisor is expressed as
// what the record said over time. Running past the end reads as the run having ended.
function recorder(reads: ReadonlyArray<CarryRead>, launch: LaunchResult = LAUNCHED): Recorder {
	const calls: Calls = { wakes: [], materials: [], session_ids: [], order: [] }

	return { ...calls, ports: ports_of([...reads], calls, launch) }
}

const run_wake_loop_fixture = {
	ENDED,
	HAND_OFF_CALL,
	HANDED_OFF,
	HANDOFF_MATERIAL,
	IN_FLIGHT,
	INVOCATION,
	NOW,
	WAKE_CALL,
	recorder,
}

export { run_wake_loop_fixture }
