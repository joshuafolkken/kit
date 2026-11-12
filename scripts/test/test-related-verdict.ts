import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { scoped_green } from '#scripts/gate/scoped-green'
import { tree_verdict, type TreeVerdict } from '#scripts/gate/tree-verdict'
import { verification_tail } from '#scripts/gate/verification-tail'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { test_related_touched } from './test-related-touched'
import { test_unit_guard } from './test-unit-guard'

interface RelatedVerdict {
	exit_code: number
	is_reused: boolean
}

function touched_target(): string {
	return tree_verdict.record_path('test-related-touched-review')
}

async function record_touched(
	given: ReadonlyArray<string>,
	before: GateTree | undefined,
	exit_code: number,
): Promise<void> {
	if (given.length !== 1 || given[0] !== test_related_touched.TOUCHED_FLAG) return
	await scoped_green.record_if_green(review_stamps.test_related_stamp, {
		before,
		exit_code,
		target: touched_target(),
	})
}

// Arguments belong to the identity too: an explicitly narrowed green never answers a bare run.
function target_of(given: ReadonlyArray<string>): string {
	const arguments_hash = input_fingerprint.of_entries([JSON.stringify([process.cwd(), given])])

	return tree_verdict.record_path(`test-related-${arguments_hash}`)
}

async function fresh_verdict(
	before: GateTree | undefined,
	target: string,
	fresh: (before: GateTree | undefined) => Promise<number>,
): Promise<RelatedVerdict> {
	const exit_code = await fresh(before)
	const tail = `${verification_tail.format_verdict('josh test:related', [])}\n`

	if (exit_code === 0) {
		await tree_verdict.record({ before, exit_code, tail }, gate_tree.read_gate_tree, target)
	}

	return { exit_code, is_reused: false }
}

function preserved_blobs(before: GateTree | undefined): Record<string, string> | undefined {
	if (before === undefined) return undefined
	const stamp = review_stamps.test_related_stamp.read()

	if (
		stamp === undefined ||
		!scoped_green.is_unmoved(before, { files: stamp.files, base: stamp.base }) ||
		!review_stamps.test_related_stamp.describes_inputs(stamp)
	) {
		return undefined
	}

	return stamp.blobs
}

async function reused_verdict(
	given: ReadonlyArray<string>,
	before: GateTree | undefined,
	target: string,
	kept: TreeVerdict,
): Promise<RelatedVerdict> {
	if (given.length === 0) {
		const blobs = preserved_blobs(before)

		await scoped_green.record_if_green(review_stamps.test_related_stamp, {
			before,
			exit_code: 0,
			...(blobs !== undefined && { blobs }),
		})
	}

	await record_touched(given, before, 0)

	return { exit_code: tree_verdict.replay(kept, target), is_reused: true }
}

async function checked(
	given: ReadonlyArray<string>,
	fresh: (before: GateTree | undefined) => Promise<number>,
): Promise<RelatedVerdict> {
	const before = await scoped_green.read_before([])
	const target = target_of(given)
	const kept = tree_verdict.read(before, target)

	if (kept?.exit_code === 0) return await reused_verdict(given, before, target, kept)

	const result = await fresh_verdict(before, target, fresh)

	await record_touched(given, before, result.exit_code)

	return result
}

async function run(
	given: ReadonlyArray<string>,
	fresh: (before: GateTree | undefined) => Promise<number>,
): Promise<number> {
	if (!test_unit_guard.is_running(process.cwd())) return await fresh(undefined)

	const outcome = await run_ship_lap.timed(
		'test:related',
		async () => await checked(given, fresh),
		{
			note_of: (result) => ({ is_reused: result.is_reused }),
		},
	)

	return outcome.exit_code
}

const test_related_verdict = { run, touched_target }

export { test_related_verdict }
