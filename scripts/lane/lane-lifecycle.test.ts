import { lane_state, type LaneRecords } from '#scripts/lane/lane-state'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { lane_lifecycle_fixture, type LaneModel, type World } from './lane-lifecycle-fixture'
import { lane_lifecycle_invariants, type StepRead } from './lane-lifecycle-invariants-fixture'
import { lane_lifecycle_operations, type Step } from './lane-lifecycle-operations-fixture'
import { lane_lifecycle_view } from './lane-lifecycle-view-fixture'

// joshuafolkken/kit#4274: #4198 added `lane:pause`, and #4201, #4241, #4246, #4260, #4263, #4265 and
// #4270 followed — pause × the next run, an earlier run's lane × a cut and a resume, pause × a resident
// process — each with every unit test green. The lane and run operations are combined here, and after
// every step `run:board`, the backlog's count and `run:liveness` have to answer what the model does.
//
// **Each choice picks among the operations the world allows at that step**, so every step runs one;
// a list of fixed commands would skip most of them as not applicable, and the long combinations — a
// pause in an earlier run's lane — would hardly be reached.
//
// joshuafolkken/kit#8771: adopt, hand-over, the dependency wait, human-review, merge, withdraw, a lost
// work tree and another run's checkout hold join them, and every step has to keep the invariants of
// `lane-lifecycle-invariants-fixture.ts`. #8472, #8455, #7716 and #7657 stay as fixed walks by step name.

const MAX_STEPS = 40
const NUM_RUNS = 150
// Open, start, launch, end, start, pause, resume: the minimized CI counterexample.
const RESUMED_IN_NEXT_RUN = [0, 2, 0, 6, 3, 0, 0]
const LAUNCHED = ['run start', 'open #9101', 'launch #9101']
const IN_NEXT_RUN = ['run end', 'run start', 'hand-over #9101']
const PAUSE = 'pause #9101'
const LOSE_TREE = 'lose work tree #9101'
const STEPS = { minLength: 1, maxLength: MAX_STEPS, size: 'max' } as const

type Pick = number | string
type StepsOf = (world: World) => Array<Step>
type Check = (world: World, step: Step, before: LaneRecords) => Promise<void>

async function expect_agreement(world: World, step: Step): Promise<void> {
	const read = await lane_lifecycle_view.read_world(world)

	for (const [issue, lane] of world.lanes) {
		if (lane.state === undefined) continue

		expect(
			lane_lifecycle_view.actual_view(world, read, issue),
			`lane #${issue} after ${step.name}`,
		).toStrictEqual(lane_lifecycle_view.expected_view(world, lane))
	}
}

function issues_where(world: World, is_match: (lane: LaneModel) => boolean): Set<string> {
	return new Set([...world.lanes].filter(([, lane]) => is_match(lane)).map(([issue]) => issue))
}

async function step_read(world: World, step: Step, before: LaneRecords): Promise<StepRead> {
	const { records, sorted } = await lane_lifecycle_view.read_world(world)
	const own = [...sorted.own.keys()].map(String)
	const earlier = [...sorted.earlier.keys()].map(String)

	return {
		step,
		before,
		after: records,
		board: new Set([...own, ...earlier]),
		own: new Set(own),
		current: issues_where(world, (lane) => lane.launch_run === world.run.id),
		treeless: issues_where(world, (lane) => !lane.has_work_tree),
		checkout_peak: world.checkout.peak,
	}
}

async function expect_invariants(world: World, step: Step, before: LaneRecords): Promise<void> {
	const read = await step_read(world, step, before)

	expect(lane_lifecycle_invariants.violations(read), step.name).toStrictEqual([])
}

function picked(steps: ReadonlyArray<Step>, pick: Pick, trace: ReadonlyArray<string>): Step {
	const step =
		typeof pick === 'string' ? steps.find((one) => one.name === pick) : steps[pick % steps.length]

	if (step === undefined) throw new Error(`${String(pick)} not offered after ${trace.join(' → ')}`)

	return step
}

async function take(world: World, step: Step, check: Check, trace: Array<string>): Promise<void> {
	const before = await lane_state.read_states([...world.lanes.keys()], world.directory)

	trace.push(step.name)
	await step.apply()
	await check(world, { ...step, name: trace.join(' → ') }, before)
}

function walker(steps_of: StepsOf, check: Check): (picks: ReadonlyArray<Pick>) => Promise<void> {
	return async (picks) => {
		const world = lane_lifecycle_fixture.create_world()
		const trace: Array<string> = []

		try {
			for (const pick of picks) {
				// eslint-disable-next-line no-await-in-loop -- each step is chosen from the world the one before it left
				await take(world, picked(steps_of(world), pick, trace), check, trace)
			}
		} finally {
			lane_lifecycle_fixture.dispose_world(world)
		}
	}
}

const walk = walker(lane_lifecycle_operations.steps_of, expect_agreement)
const walk_every = walker(lane_lifecycle_operations.every_step_of, expect_invariants)

// The invariants with no writer excused from the work-tree guard, collected: the #8829 gap shows here.
async function guarded_violations(steps: ReadonlyArray<Pick>): Promise<Array<string>> {
	const found: Array<string> = []

	async function collect(world: World, step: Step, before: LaneRecords): Promise<void> {
		const read = await step_read(world, { ...step, skips_tree_guard: false }, before)

		found.push(...lane_lifecycle_invariants.violations(read))
	}

	await walker(lane_lifecycle_operations.every_step_of, collect)(steps)

	return found
}

describe('lane and run lifecycle combinations — the readers agree at every step', () => {
	it('transfers a resumed lane from the ended run to the current run', async () => {
		await expect(walk(RESUMED_IN_NEXT_RUN)).resolves.toBeUndefined()
	})

	it('answers one state on run:board, in the backlog count and from run:liveness', async () => {
		const choices = fc.noBias(fc.array(fc.nat(), STEPS))

		await expect(
			fc.assert(fc.asyncProperty(choices, walk), { numRuns: NUM_RUNS }),
		).resolves.toBeUndefined()
	})
})

describe('lane lifecycle with every table event — the invariants hold at every step', () => {
	it('keeps a person pause through a dependency release and a hand-over (#8472)', async () => {
		const steps = [...LAUNCHED, PAUSE, 'dependency-resume #9101', ...IN_NEXT_RUN]

		await expect(walk_every(steps)).resolves.toBeUndefined()
	})

	it('draws a handed-over running lane as the current run row (#8455)', async () => {
		await expect(walk_every([...LAUNCHED, ...IN_NEXT_RUN])).resolves.toBeUndefined()
	})

	it('leaves the checkout another run holds alone on a merge (#7716)', async () => {
		const steps = [...LAUNCHED, 'checkout hold', 'merge #9101']

		await expect(walk_every(steps)).resolves.toBeUndefined()
	})

	// The known gap: `lane:resume` does not ask the work-tree guard yet. When #8829 lands, this goes red
	// and turns back into "resumes nothing in a lane whose work tree is gone".
	it('still resumes a lane whose work tree is gone until lane:resume asks the guard (#7657, #8829)', async () => {
		const steps = [...LAUNCHED, PAUSE, LOSE_TREE, 'resume #9101']

		await expect(guarded_violations(steps)).resolves.toStrictEqual([
			'#9101 ran with no branch or work tree',
		])
	})

	it('restarts nothing in a lane whose work tree is gone (#7657)', async () => {
		const steps = [...LAUNCHED, LOSE_TREE, 'restart #9101']

		await expect(walk_every(steps)).resolves.toBeUndefined()
	})

	it('keeps every invariant over random event sequences', async () => {
		const choices = fc.noBias(fc.array(fc.nat(), STEPS))

		await expect(
			fc.assert(fc.asyncProperty(choices, walk_every), { numRuns: NUM_RUNS }),
		).resolves.toBeUndefined()
	})
})
