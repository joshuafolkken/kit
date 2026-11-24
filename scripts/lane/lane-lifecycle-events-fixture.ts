import type { LaneState } from '#scripts/lane/lane-state'
import { lane_state_record } from '#scripts/lane/lane-state-record'
import {
	lane_lifecycle_fixture as world_fixture,
	type LaneModel,
	type LaneOperation,
	type RunOperation,
	type World,
} from './lane-lifecycle-fixture'

// The lane operations joshuafolkken/kit#8771 adds to the lifecycle property test: adopt, hand-over,
// the dependency wait and its release, a human-review stop, a merge, a review resume, a withdraw, a lost
// work tree, and another run's hold on the primary checkout. Each writes through the path its command
// writes through — `lane_state.record_change` or `record_owner` — after the table's guards the
// command asks (`lane_transition_guards.rejection`), so a guard or rule taken off the table shows here.

const { KIND, emit, is_refused, lane_of, try_owner, try_write, write } = world_fixture
const { HUMAN_REVIEW } = lane_state_record
const RUNNING = 'running'
const DISPATCH = 'lane:dispatch'
const RELEASE = 'dependency-resume'
const REVIEW_RESUME = 'review-resume'

// The checkout's holder that is no lane of the world: a run started outside the backlog.
const OTHER_RUN = '9999'
const HELD: ReadonlyArray<LaneState> = ['open', RUNNING, 'paused', HUMAN_REVIEW]

function is_listed_in(lane: LaneModel, states: ReadonlyArray<LaneState>): boolean {
	return lane.is_listed && lane.state !== undefined && states.includes(lane.state)
}

function can_adopt(_world: World, lane: LaneModel): boolean {
	return !lane.is_listed
}

// `lane-adopt.ts` → `record_owner(issue, 'adopt')`: a stray lane's fresh `open` record, never over one.
async function adopt_lane(world: World, issue: string): Promise<void> {
	if (!(await try_owner(world, issue, 'adopt'))) return

	Object.assign(lane_of(world, issue), {
		is_alive: false,
		is_listed: true,
		launch_run: undefined,
		has_work_tree: true,
	})
}

// `backlog-drive-carried.ts` → `adopt_stopped`: a lane an ended run launched, under a run's carry.
function can_hand_over(world: World, lane: LaneModel): boolean {
	const is_earlier = lane.launch_run !== undefined && lane.launch_run !== world.run.id

	return world.run.has_carry && is_earlier && is_listed_in(lane, HELD)
}

// Its owner run has ended, so the table has to take the hand-over (joshuafolkken/kit#8455).
async function hand_over_lane(world: World, issue: string): Promise<void> {
	if (!(await try_owner(world, issue, 'hand-over'))) throw new Error(`hand-over refused`)

	lane_of(world, issue).launch_run = world.run.id
}

function can_wait(_world: World, lane: LaneModel): boolean {
	return is_listed_in(lane, ['open', RUNNING])
}

// `lane_dispatch_dependency.defer`: the lane waits on an unmerged dependency.
async function wait_lane(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: 'paused', command: 'lane:dependency-wait' })
	emit(world, KIND.LANE_STATE, `#${issue} lane:dependency-wait`)
}

function can_release(world: World, lane: LaneModel): boolean {
	return world.run.is_active && is_listed_in(lane, ['paused'])
}

// `lane_dispatch_dependency.begin`, then the dispatch it opens: offered on every paused lane, so a
// person's pause meets it too.
async function release_lane(world: World, issue: string): Promise<void> {
	if (
		(await is_refused(world, RELEASE, issue)) ||
		!(await try_write(world, { issue, state: RUNNING, command: DISPATCH })) ||
		(await is_refused(world, 'restart', issue))
	) {
		return
	}

	await write(world, { issue, state: RUNNING, command: DISPATCH, is_launch: true })
	Object.assign(lane_of(world, issue), { is_alive: true, launch_run: world.run.id })
	emit(world, KIND.CHILD_LAUNCH, `#${issue} lane:dispatch`)
}

function can_stop(_world: World, lane: LaneModel): boolean {
	return is_listed_in(lane, [RUNNING])
}

// `run:hold --human-review-stop`: the child stops for a person's review.
async function review_stop(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: HUMAN_REVIEW, command: 'run:hold --human-review-stop' })
	lane_of(world, issue).is_alive = false
}

function sync_checkout(world: World, claimant: string): void {
	const { checkout } = world

	checkout.holders.push(claimant)
	checkout.peak = Math.max(checkout.peak, checkout.holders.length)
	checkout.holders.pop()
}

function can_merge(_world: World, lane: LaneModel): boolean {
	return is_listed_in(lane, [RUNNING, HUMAN_REVIEW])
}

// `run-merge-human-review.ts` keeps the lane, then `run-merge-sync.ts` syncs the primary checkout.
async function merge_lane(world: World, issue: string): Promise<void> {
	const lane = lane_of(world, issue)

	if (lane.state !== HUMAN_REVIEW) {
		await write(world, { issue, state: HUMAN_REVIEW, command: 'run:merge' })
	}

	lane.is_alive = false
	if (!(await is_refused(world, 'merge', issue))) sync_checkout(world, issue)
}

function can_review_resume(world: World, lane: LaneModel): boolean {
	return world.run.is_active && is_listed_in(lane, [HUMAN_REVIEW])
}

// `run-halfrun-resume.ts`: the next half-run round resumes the reviewed lane, once its work tree passes.
async function review_resume(world: World, issue: string): Promise<void> {
	if (await is_refused(world, REVIEW_RESUME, issue)) return
	await write(world, { issue, state: RUNNING, command: 'run:entry' })
	lane_of(world, issue).is_alive = true
}

function can_withdraw(_world: World, lane: LaneModel): boolean {
	return is_listed_in(lane, HELD)
}

async function withdraw_lane(world: World, issue: string): Promise<void> {
	await write(world, { issue, state: 'ended', command: 'lane:withdraw' })
	Object.assign(lane_of(world, issue), { is_alive: false, is_listed: false })
}

function can_lose_tree(_world: World, lane: LaneModel): boolean {
	return lane.is_listed && lane.has_work_tree
}

// The lane's branch was deleted or its work tree removed under it (joshuafolkken/kit#7657).
function lose_tree(world: World, issue: string): void {
	lane_of(world, issue).has_work_tree = false
}

const LANE_OPERATIONS: ReadonlyArray<LaneOperation> = [
	{ name: 'adopt', can: can_adopt, apply: adopt_lane },
	{ name: 'hand-over', can: can_hand_over, apply: hand_over_lane },
	{ name: 'dependency-wait', can: can_wait, apply: wait_lane },
	{ name: RELEASE, can: can_release, apply: release_lane },
	{ name: HUMAN_REVIEW, can: can_stop, apply: review_stop },
	{ name: 'merge', can: can_merge, apply: merge_lane },
	{ name: REVIEW_RESUME, can: can_review_resume, apply: review_resume },
	{ name: 'withdraw', can: can_withdraw, apply: withdraw_lane, lifts_pause: true },
	{ name: 'lose work tree', can: can_lose_tree, apply: lose_tree },
]

function can_hold(world: World): boolean {
	return world.checkout.holders.length === 0
}

function can_release_hold(world: World): boolean {
	return world.checkout.holders.includes(OTHER_RUN)
}

function hold_checkout(world: World): void {
	world.checkout.holders.push(OTHER_RUN)
}

const RUN_OPERATIONS: ReadonlyArray<RunOperation> = [
	{
		name: 'checkout hold',
		can: can_hold,
		apply: hold_checkout,
	},
	{
		name: 'checkout release',
		can: can_release_hold,
		apply: (world) => world.checkout.holders.pop(),
	},
]

const lane_lifecycle_events = { LANE_OPERATIONS, RUN_OPERATIONS }

export { lane_lifecycle_events }
