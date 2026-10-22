import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { lane_lifecycle_fixture, type World } from './lane-lifecycle-fixture'
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

const MAX_STEPS = 40
const NUM_RUNS = 150

async function expect_agreement(world: World, trace: ReadonlyArray<string>): Promise<void> {
	const read = await lane_lifecycle_view.read_world(world)

	for (const [issue, lane] of world.lanes) {
		if (lane.state === undefined) continue

		expect(
			lane_lifecycle_view.actual_view(world, read, issue),
			`lane #${issue} after ${trace.join(' → ')}`,
		).toStrictEqual(lane_lifecycle_view.expected_view(world, lane))
	}
}

function chosen(world: World, choice: number): Step {
	const steps = lane_lifecycle_operations.steps_of(world)
	const step = steps[choice % steps.length]

	if (step === undefined) throw new Error('no operation applies')

	return step
}

async function take(world: World, choice: number, trace: Array<string>): Promise<void> {
	const step = chosen(world, choice)

	trace.push(step.name)
	await step.apply()
	await expect_agreement(world, trace)
}

async function walk(choices: ReadonlyArray<number>): Promise<void> {
	const world = lane_lifecycle_fixture.create_world()
	const trace: Array<string> = []

	try {
		for (const choice of choices) {
			// eslint-disable-next-line no-await-in-loop -- each step is chosen from the world the one before it left
			await take(world, choice, trace)
		}
	} finally {
		lane_lifecycle_fixture.dispose_world(world)
	}
}

describe('lane and run lifecycle combinations — the readers agree at every step', () => {
	it('answers one state on run:board, in the backlog count and from run:liveness', async () => {
		const steps = { minLength: 1, maxLength: MAX_STEPS, size: 'max' } as const
		const choices = fc.noBias(fc.array(fc.nat(), steps))

		await expect(
			fc.assert(fc.asyncProperty(choices, walk), { numRuns: NUM_RUNS }),
		).resolves.toBeUndefined()
	})
})
