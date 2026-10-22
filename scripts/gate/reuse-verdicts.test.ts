import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_read_map, type ReadMap } from '#scripts/test/test-read-map'
import fc from 'fast-check'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { check_reuse } from './check-reuse'
import { gate_plan } from './gate-plan'
import { gate_skip } from './gate-skip'
import { gate_tree } from './gate-tree'
import { RECORD, reuse_operations } from './reuse-operations-fixture'
import { BASE_PREFIX, reuse_world, type Kind, type World } from './reuse-world-fixture'
import { since_green } from './since-green'

// joshuafolkken/kit#4494: reusing a green verification result went wrong in one combination of edits
// after another — #4393, #4407, #4415, #4423, #4425, #4443, #4457 — each with every unit test green.
// Edits, a main sync and a green record are combined here, and after every step the gate's whole-run
// reuse, each check's reuse and the since-green narrowing have to answer what the reference model in
// `reuse-world-fixture.ts` does: reuse only what none of the moved paths is an input of.

const MAX_STEPS = 30
const NUM_RUNS = 60
const scratch = mkdtempSync(path.join(tmpdir(), 'reuse-verdicts-'))
const green_record = path.join(scratch, 'green.json')
const SCOPED_LABELS: ReadonlyArray<string> = [
	gate_plan.LINT_LABEL,
	gate_plan.TYPE_CHECK_LABEL,
	gate_plan.EXPORTS_LABEL,
	gate_plan.METRICS_LABEL,
	gate_plan.UNIT_LABEL,
]
// The kinds of path each scoped check reads, written from what the check does rather than from
// `check-inputs.ts`: a module, a declaration and a config file are inputs of every check. The unit
// step reads beyond those only what a recorded test reads — here a test that reads every doc.
const SHARED_INPUTS: ReadonlyArray<Kind> = ['module', 'declaration', 'globals', 'config']
const INPUTS: ReadonlyMap<string, ReadonlySet<Kind>> = new Map([
	[gate_plan.LINT_LABEL, new Set<Kind>([...SHARED_INPUTS, 'doc', 'style'])],
	[gate_plan.TYPE_CHECK_LABEL, new Set<Kind>(SHARED_INPUTS)],
	[gate_plan.EXPORTS_LABEL, new Set<Kind>(SHARED_INPUTS)],
	[gate_plan.METRICS_LABEL, new Set<Kind>([...SHARED_INPUTS, 'doc'])],
	[gate_plan.UNIT_LABEL, new Set<Kind>([...SHARED_INPUTS, 'doc'])],
])
const DOC_READER = 'src/guide.test.ts'
const documents = [...reuse_world.create_world().contents.keys()].filter(
	(relative) => reuse_world.kind_of(relative) === 'doc',
)
// Recorded with every path of the world present, so an unread path is one no test reads.
const READ_MAP: ReadMap = {
	version: test_read_map.MAP_VERSION,
	commit: 'f00dcafe',
	dirty: {},
	directories: [],
	readers: Object.fromEntries(documents.map((relative) => [relative, [DOC_READER]])),
}
const walked: { world: World } = { world: reuse_world.create_world() }

interface Verdicts {
	gate_reused: boolean
	checks_reused: ReadonlyArray<string>
	narrowed_to: ReadonlyArray<string> | undefined
}

function synced_between(arguments_: ReadonlyArray<string>): string {
	const bases = arguments_
		.filter((argument) => argument.startsWith(BASE_PREFIX))
		.map((argument) => Number(argument.slice(BASE_PREFIX.length)))
	const [from = 0, to = 0] = bases

	return reuse_world
		.upstream_between(walked.world, from, to)
		.map((relative) => `${relative}\0`)
		.join('')
}

function current_tree(world: World): { files: Record<string, string>; base: string } {
	return { files: reuse_world.tree_of(world), base: reuse_world.base_name(world.upstream.length) }
}

vi.spyOn(git_command, 'repository_root').mockResolvedValue(scratch)
vi.spyOn(git_spawn, 'read').mockImplementation(async (arguments_) => synced_between(arguments_))
vi.spyOn(gate_tree, 'read_gate_tree').mockImplementation(async () => current_tree(walked.world))
vi.spyOn(test_read_map, 'read_map').mockReturnValue(READ_MAP)
vi.spyOn(changed_paths, 'read_changed_since').mockResolvedValue([])
vi.spyOn(changed_paths, 'read_held_at').mockImplementation(async (_commit, files) => [...files])

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function record_green(world: World): void {
	const tree = current_tree(world)

	review_stamps.gate_stamp.write(tree.files, green_record, tree.base)
}

async function actual_verdicts(world: World): Promise<Verdicts> {
	const tree = current_tree(world)
	const gate = gate_skip.gate_reuse(tree.files, tree.base, green_record)
	const checks = await check_reuse.reusable_checks(SCOPED_LABELS, tree, () => green_record)
	const narrowed = await since_green.read_moved(review_stamps.gate_stamp, green_record)

	return {
		gate_reused: 'stamp' in gate,
		checks_reused: [...checks.keys()].toSorted(reuse_world.by_name),
		narrowed_to: narrowed?.toSorted(reuse_world.by_name),
	}
}

function reads_none_of(label: string, moved_kinds: ReadonlyArray<Kind>): boolean {
	const inputs = INPUTS.get(label) ?? new Set()

	return moved_kinds.every((kind) => !inputs.has(kind))
}

function expected_verdicts(world: World): Verdicts {
	const moved = reuse_world.moved(world)
	const kinds = moved.map((relative) => reuse_world.kind_of(relative))
	const labels = SCOPED_LABELS.filter((label) => reads_none_of(label, kinds))

	return {
		gate_reused: moved.length === 0,
		checks_reused: labels.toSorted(reuse_world.by_name),
		narrowed_to: kinds.includes('config') ? undefined : moved,
	}
}

async function take(
	world: World,
	choice: readonly [number, number],
	trace: Array<string>,
): Promise<void> {
	const step = reuse_operations.step_of(world, choice)

	trace.push(step.name)
	step.apply()
	if (step.name === RECORD) record_green(world)

	expect(await actual_verdicts(world), `after ${trace.join(' → ')}`).toStrictEqual(
		expected_verdicts(world),
	)
}

async function walk(choices: ReadonlyArray<readonly [number, number]>): Promise<void> {
	const world = reuse_world.create_world()
	const trace: Array<string> = []

	walked.world = world
	record_green(world)

	for (const choice of choices) {
		// eslint-disable-next-line no-await-in-loop -- each step is chosen from the world the one before it left
		await take(world, choice, trace)
	}
}

describe('reusing a green result — every verdict agrees with the reference model at every step', () => {
	it('reuses the gate, a check and the since-green narrowing only where nothing it reads moved', async () => {
		const steps = { minLength: 1, maxLength: MAX_STEPS, size: 'max' } as const
		const step = fc.tuple(fc.nat(), fc.nat())
		const choices = fc.noBias(fc.array(step, steps))

		await expect(
			fc.assert(fc.asyncProperty(choices, walk), { numRuns: NUM_RUNS }),
		).resolves.toBeUndefined()
	})
})
