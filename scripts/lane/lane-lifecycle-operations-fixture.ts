import { run_carry } from '#scripts/run/carry/run-carry'
import { lane_lifecycle_events } from './lane-lifecycle-events-fixture'
import {
	lane_lifecycle_fixture as world_fixture,
	type LaneModel,
	type LaneOperation,
	type RunOperation,
	type World,
} from './lane-lifecycle-fixture'

// The lane and run operations the lifecycle property test combines (joshuafolkken/kit#4274), each
// offered only where the real command acts — `lane:pause` signals a child that is there, a launch
// needs a run driving it — and each leaving what that command leaves. A launch and a restart ask the
// table's guards first, as `lane-dispatch-prepare.ts` does (joshuafolkken/kit#8777); `lane:resume` does
// not ask them yet (joshuafolkken/kit#8829), so neither does its model.

const { KIND, emit, is_refused, lane_of, try_write, write } = world_fixture

function is_running_child(lane: LaneModel): boolean {
	return lane.is_listed && lane.state === 'running' && lane.is_alive
}

function can_open(_world: World, lane: LaneModel): boolean {
	return !lane.is_listed
}

function can_launch(world: World, lane: LaneModel): boolean {
	const is_vacant = lane.state === 'open' || (lane.state === 'running' && !lane.is_alive)

	return world.run.is_active && lane.is_listed && is_vacant
}

function can_pause(_world: World, lane: LaneModel): boolean {
	return is_running_child(lane)
}

function can_resume(_world: World, lane: LaneModel): boolean {
	return lane.is_listed && lane.state === 'paused' && lane.is_alive
}

function can_cut(world: World, lane: LaneModel): boolean {
	return world.run.is_active && is_running_child(lane)
}

// `lane:restart` refuses a paused lane: the table has no launch from paused (joshuafolkken/kit#8775).
function can_restart(world: World, lane: LaneModel): boolean {
	return world.run.is_active && lane.is_listed && lane.state === 'running'
}

function can_close(_world: World, lane: LaneModel): boolean {
	return lane.is_listed
}

async function launched(world: World, issue: string, command: string, kind: string): Promise<void> {
	const event = lane_of(world, issue).state === 'running' ? 'restart' : 'launch'

	if (await is_refused(world, event, issue)) return

	await write(world, { issue, state: 'running', command, is_launch: true })
	Object.assign(lane_of(world, issue), { is_alive: true, launch_run: world.run.id })
	emit(world, kind, `#${issue} ${command}`)
}

async function open_lane(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: 'open', command: 'lane:open' })
	Object.assign(lane_of(world, issue), {
		is_alive: false,
		is_listed: true,
		has_work_tree: true,
		launch_run: undefined,
	})
}

async function dispatch_lane(world: World, issue: string): Promise<void> {
	await launched(world, issue, 'lane:dispatch', KIND.CHILD_LAUNCH)
}

async function restart_lane(world: World, issue: string): Promise<void> {
	await launched(world, issue, 'lane:restart', KIND.RESTART)
}

async function pause_lane(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: 'paused', command: 'lane:pause' })
	emit(world, KIND.LANE_STATE, `#${issue} lane:pause`)
}

// `lane:resume` skips its event and ledger lines when the table refuses the write (a dependency wait).
async function resume_lane(world: World, issue: string): Promise<void> {
	if (!(await try_write(world, { issue, state: 'running', command: 'lane:resume' }))) return

	emit(world, KIND.LANE_STATE, `#${issue} lane:resume`)
	if (world.run.has_carry) lane_of(world, issue).launch_run = world.run.id
}

// A lane child's pre-gate cut: its session ends and writes the cut; its record stays running.
function cut_lane(world: World, issue: string): void {
	lane_of(world, issue).is_alive = false
	emit(world, KIND.CUT, `#${issue} cut at the pre-gate boundary`)
}

async function close_lane(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: 'ended', command: 'lane:close' })
	Object.assign(lane_of(world, issue), { is_alive: false, is_listed: false })
}

const LANE_OPERATIONS: ReadonlyArray<LaneOperation> = [
	{ name: 'open', can: can_open, apply: open_lane },
	{ name: 'launch', can: can_launch, apply: dispatch_lane },
	{ name: 'pause', can: can_pause, apply: pause_lane },
	{
		name: 'resume',
		can: can_resume,
		apply: resume_lane,
		lifts_pause: true,
		skips_tree_guard: true,
	},
	{ name: 'cut', can: can_cut, apply: cut_lane },
	{ name: 'restart', can: can_restart, apply: restart_lane },
	{ name: 'close', can: can_close, apply: close_lane, lifts_pause: true },
]

function carry_path(world: World): string {
	return run_carry.carry_path(world.directory)
}

function start_run(world: World): void {
	const now = world_fixture.tick(world)
	const carry = run_carry.begin_carry(carry_path(world), world_fixture.INVOCATION, undefined, now)

	if (carry === undefined) throw new Error('run start: a carry already stands')

	Object.assign(world.run, { id: world.run.id + 1, started_ms: now.getTime(), is_active: true })
	world.run.has_carry = true
}

// The parent's session cut: the carry stands for the session that resumes it.
function stop_run(world: World): void {
	world.run.is_active = false
	emit(world, KIND.CUT, 'session cut')
}

function resume_run(world: World): void {
	const read = run_carry.read_carry(carry_path(world))
	const adopted =
		read.kind === 'carried' ? run_carry.adopt_carry(carry_path(world), read.carry) : undefined

	if (adopted === undefined) throw new Error(`run resume: the carry reads ${read.kind}`)

	world.run.is_active = true
	emit(world, KIND.RESUME, 'resumed')
}

function end_run(world: World): void {
	run_carry.end_carry(carry_path(world))
	Object.assign(world.run, { is_active: false, has_carry: false })
	emit(world, KIND.STOP, 'run stopped')
}

function can_start_run(world: World): boolean {
	return !world.run.has_carry
}

function can_stop_run(world: World): boolean {
	return world.run.is_active
}

function can_resume_run(world: World): boolean {
	return world.run.has_carry && !world.run.is_active
}

function can_end_run(world: World): boolean {
	return world.run.has_carry
}

const RUN_OPERATIONS: ReadonlyArray<RunOperation> = [
	{ name: 'run start', can: can_start_run, apply: start_run },
	{ name: 'run stop', can: can_stop_run, apply: stop_run },
	{ name: 'run resume', can: can_resume_run, apply: resume_run },
	{ name: 'run end', can: can_end_run, apply: end_run },
]

// One operation bound to the world it runs in, named as the failure trace prints it, with the lane it
// acts on, whether it is a person's own lift of a pause and whether its writer skips the work-tree guard
// (`lane-lifecycle-invariants-fixture.ts`).
interface Step {
	name: string
	issue: string | undefined
	lifts_pause: boolean
	skips_tree_guard: boolean
	apply: () => Promise<void> | void
}

interface Operations {
	lanes: ReadonlyArray<LaneOperation>
	runs: ReadonlyArray<RunOperation>
}

const BASIC: Operations = { lanes: LANE_OPERATIONS, runs: RUN_OPERATIONS }

// joshuafolkken/kit#8771: adopt, hand-over, the dependency wait, human-review, merge, withdraw, a lost
// work tree and another run's hold on the checkout, beside the operations above.
const EVERY: Operations = {
	lanes: [...LANE_OPERATIONS, ...lane_lifecycle_events.LANE_OPERATIONS],
	runs: [...RUN_OPERATIONS, ...lane_lifecycle_events.RUN_OPERATIONS],
}

function lane_steps(world: World, issue: string, operations: Operations): Array<Step> {
	const lane = lane_of(world, issue)

	return operations.lanes
		.filter((operation) => operation.can(world, lane))
		.map((operation) => ({
			name: `${operation.name} #${issue}`,
			issue,
			lifts_pause: operation.lifts_pause === true,
			skips_tree_guard: operation.skips_tree_guard === true,
			apply: operation.apply.bind(undefined, world, issue),
		}))
}

function steps_in(world: World, operations: Operations): Array<Step> {
	const runs = operations.runs
		.filter((operation) => operation.can(world))
		.map((operation) => ({
			name: operation.name,
			issue: undefined,
			lifts_pause: false,
			skips_tree_guard: false,
			apply: operation.apply.bind(undefined, world),
		}))
	const lanes = world_fixture.ISSUES.flatMap((issue) => lane_steps(world, issue, operations))

	return [...lanes, ...runs]
}

/** Every basic operation the world allows now — never none, as a run either starts or ends. */
function steps_of(world: World): Array<Step> {
	return steps_in(world, BASIC)
}

/** Every operation, the #8771 ones included, the world allows now. */
function every_step_of(world: World): Array<Step> {
	return steps_in(world, EVERY)
}

const lane_lifecycle_operations = { every_step_of, steps_of }

export { lane_lifecycle_operations }
export type { Step }
