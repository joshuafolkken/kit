import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import type { FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { test_read_map, type ReadMap } from '#scripts/test/test-read-map'
import fc from 'fast-check'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { check_reuse } from './check-reuse'
import { gate_labels } from './gate-labels'
import type { GateStepResult } from './gate-report'
import { gate_skip } from './gate-skip'
import { gate_tree } from './gate-tree'
import { moved_paths } from './moved-paths'
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
const gate_record = path.join(scratch, 'gate.json')
const lint_record = path.join(scratch, 'lint-related.json')
const unit_record = path.join(scratch, 'test-related.json')

function check_record(label: string): string {
	return path.join(scratch, `check-${label}.json`)
}

const SCOPED_LABELS: ReadonlyArray<string> = [
	gate_labels.LINT_LABEL,
	gate_labels.TYPE_CHECK_LABEL,
	gate_labels.EXPORTS_LABEL,
	gate_labels.METRICS_LABEL,
	gate_labels.UNIT_LABEL,
]
// The kinds of path each scoped check reads, written from what the check does rather than from
// `verification-inputs.ts`: a module, a declaration and a config file are inputs of every check. The
// unit step reads beyond those only what a recorded test reads — here a test that reads every doc. A
// config file stops a check's since-green narrowing only when it configures that check: the lint
// configuration is a source of the unit step, not its configuration (joshuafolkken/kit#4495).
const SHARED_INPUTS: ReadonlyArray<Kind> = ['module', 'declaration', 'globals', 'config']
const INPUTS: ReadonlyMap<string, ReadonlySet<Kind>> = new Map([
	[gate_labels.LINT_LABEL, new Set<Kind>([...SHARED_INPUTS, 'doc', 'style'])],
	[gate_labels.TYPE_CHECK_LABEL, new Set<Kind>(SHARED_INPUTS)],
	[gate_labels.EXPORTS_LABEL, new Set<Kind>(SHARED_INPUTS)],
	[gate_labels.METRICS_LABEL, new Set<Kind>([...SHARED_INPUTS, 'doc'])],
	[gate_labels.UNIT_LABEL, new Set<Kind>([...SHARED_INPUTS, 'doc'])],
])
const CONFIGURES_OTHERS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
	[gate_labels.UNIT_LABEL, ['eslint.config.js']],
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
	change: [],
	directories: [],
	readers: Object.fromEntries(documents.map((relative) => [relative, [DOC_READER]])),
}
const walked: { world: World } = { world: reuse_world.create_world() }

interface Verdicts {
	gate_reused: boolean
	checks_reused: ReadonlyArray<string>
	lint_narrowed_to: ReadonlyArray<string> | undefined
	unit_narrowed_to: ReadonlyArray<string> | undefined
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
const read_changed_tree = vi.spyOn(review_tree, 'read_changed_tree')

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function passed(label: string): GateStepResult {
	return { label, command: `josh ${label}`, exit_code: 0, output: '', elapsed_ms: 1 }
}

// Each record is written by the stamp that reads it, so it carries that verification's inputs.
async function record_green(world: World): Promise<void> {
	const tree = current_tree(world)

	review_stamps.gate_stamp.write(tree.files, gate_record, tree.base)
	review_stamps.lint_related_stamp.write(tree.files, lint_record, tree.base)
	review_stamps.test_related_stamp.write(tree.files, unit_record, tree.base)
	read_changed_tree.mockResolvedValue(tree.files)
	const results = SCOPED_LABELS.map((label) => passed(label))

	await check_reuse.record_green_checks(results, tree, check_record)
}

async function read_narrowed(
	stamp: FileMapStampAccess,
	label: string,
	record: string,
): Promise<ReadonlyArray<string> | undefined> {
	const parts = await since_green.read_moved_parts(stamp, label, record)

	return parts === undefined ? undefined : moved_paths.union_of(parts).toSorted(reuse_world.by_name)
}

async function actual_verdicts(world: World): Promise<Verdicts> {
	const tree = current_tree(world)
	const gate = gate_skip.gate_reuse(tree.files, tree.base, gate_record)
	const checks = await check_reuse.reusable_checks(SCOPED_LABELS, tree, check_record)
	const { lint_related_stamp, test_related_stamp } = review_stamps
	const lint = await read_narrowed(lint_related_stamp, gate_labels.LINT_LABEL, lint_record)
	const unit = await read_narrowed(test_related_stamp, gate_labels.UNIT_LABEL, unit_record)

	return {
		gate_reused: 'stamp' in gate,
		checks_reused: [...checks.keys()].toSorted(reuse_world.by_name),
		lint_narrowed_to: lint,
		unit_narrowed_to: unit,
	}
}

function reads(label: string, relative: string): boolean {
	const inputs = INPUTS.get(label) ?? new Set()

	return inputs.has(reuse_world.kind_of(relative))
}

function configures(label: string, relative: string): boolean {
	const is_config = reuse_world.kind_of(relative) === 'config'

	return is_config && !(CONFIGURES_OTHERS.get(label) ?? []).includes(relative)
}

function narrowed_to(
	label: string,
	moved: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
	return moved.some((relative) => configures(label, relative)) ? undefined : moved
}

function expected_verdicts(world: World): Verdicts {
	const moved = reuse_world.moved(world)
	const labels = SCOPED_LABELS.filter((label) => moved.every((relative) => !reads(label, relative)))

	return {
		gate_reused: moved.length === 0,
		checks_reused: labels.toSorted(reuse_world.by_name),
		lint_narrowed_to: narrowed_to(gate_labels.LINT_LABEL, moved),
		unit_narrowed_to: narrowed_to(gate_labels.UNIT_LABEL, moved),
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
	if (step.name === RECORD) await record_green(world)

	expect(await actual_verdicts(world), `after ${trace.join(' → ')}`).toStrictEqual(
		expected_verdicts(world),
	)
}

async function walk(choices: ReadonlyArray<readonly [number, number]>): Promise<void> {
	const world = reuse_world.create_world()
	const trace: Array<string> = []

	walked.world = world
	await record_green(world)

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
