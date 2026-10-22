import { run_carry } from '#scripts/run/carry/run-carry'
import {
	lane_lifecycle_fixture as world_fixture,
	type LaneModel,
	type World,
} from './lane-lifecycle-fixture'

// The lane and run operations the lifecycle property test combines (joshuafolkken/kit#4274), each
// offered only where the real command acts — `lane:pause` signals a child that is there, a launch
// needs a run driving it — and each leaving what that command leaves.

const { KIND, emit, lane_of, write } = world_fixture

interface LaneOperation {
	name: string
	can: (world: World, lane: LaneModel) => boolean
	apply: (world: World, issue: string) => Promise<void> | void
}

interface RunOperation {
	name: string
	can: (world: World) => boolean
	apply: (world: World) => void
}

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

function can_restart(world: World, lane: LaneModel): boolean {
	const is_held = lane.state === 'running' || lane.state === 'paused'

	return world.run.is_active && lane.is_listed && is_held
}

function can_close(_world: World, lane: LaneModel): boolean {
	return lane.is_listed
}

async function launched(world: World, issue: string, command: string, kind: string): Promise<void> {
	await write(world, { issue, state: 'running', command, is_launch: true })
	Object.assign(lane_of(world, issue), { is_alive: true, launch_run: world.run.id })
	emit(world, kind, `#${issue} ${command}`)
}

async function open_lane(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: 'open', command: 'lane:open' })
	Object.assign(lane_of(world, issue), { is_alive: false, is_listed: true, launch_run: undefined })
}

async function dispatch_lane(world: World, issue: string): Promise<void> {
	await launched(world, issue, 'lane:dispatch', KIND.CHILD_LAUNCH)
}

async function restart_lane(world: World, issue: string): Promise<void> {
	await launched(world, issue, 'lane:restart', KIND.RESTART)
}

async function signalled(world: World, issue: string, to: 'paused' | 'running'): Promise<void> {
	const command = to === 'paused' ? 'lane:pause' : 'lane:resume'

	await write(world, { issue, state: to, command })
	emit(world, KIND.LANE_STATE, `#${issue} ${command}`)
}

async function pause_lane(world: World, issue: string): Promise<void> {
	await signalled(world, issue, 'paused')
}

async function resume_lane(world: World, issue: string): Promise<void> {
	await signalled(world, issue, 'running')
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
	{ name: 'resume', can: can_resume, apply: resume_lane },
	{ name: 'cut', can: can_cut, apply: cut_lane },
	{ name: 'restart', can: can_restart, apply: restart_lane },
	{ name: 'close', can: can_close, apply: close_lane },
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

// One operation bound to the world it runs in, named as the failure trace prints it.
interface Step {
	name: string
	apply: () => Promise<void> | void
}

function lane_steps(world: World, issue: string): Array<Step> {
	const lane = lane_of(world, issue)

	return LANE_OPERATIONS.filter((operation) => operation.can(world, lane)).map((operation) => ({
		name: `${operation.name} #${issue}`,
		apply: operation.apply.bind(undefined, world, issue),
	}))
}

/** Every operation the world allows now — never none, as a run either starts or ends. */
function steps_of(world: World): Array<Step> {
	const runs = RUN_OPERATIONS.filter((operation) => operation.can(world)).map((operation) => ({
		name: operation.name,
		apply: operation.apply.bind(undefined, world),
	}))

	return [...world_fixture.ISSUES.flatMap((issue) => lane_steps(world, issue)), ...runs]
}

const lane_lifecycle_operations = { steps_of }

export { lane_lifecycle_operations }
export type { Step }
