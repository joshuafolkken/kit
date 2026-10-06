import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeAll, describe, expect, it } from 'vitest'
import { josh_harness } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const { GATE_TIMEOUT_MS, SETUP_TIMEOUT_MS } = josh_harness_fixture

const GATE_GREEN = 'Gate green'
const MARKER_WAIT_MS = 60_000

// The race runs in a kit environment of its own, so no ledger line another scenario writes is part
// of the tree its gate checks.
const environment = josh_harness_fixture.open_environments(['kit'])

// #2434: a join that polled while the gate was recording green and clearing its marker saw neither,
// and called a green gate red. The join is launched only once the gate has marked itself running, so
// the two overlap for the whole of the gate's run — the window the race lived in. The tree carries a
// change because a green record is reused only for a tree that differs from its base, as a run's does.
describe('josh harness — the gate and its join race (#2434)', () => {
	beforeAll(() => {
		writeFileSync(path.join(environment('kit').root, 'docs', 'change.md'), '# Change\n', 'utf8')
	}, SETUP_TIMEOUT_MS)

	it(
		'answers green when the join overlaps a gate that goes green',
		async () => {
			const kit = environment('kit')
			const marker = file_map_stamp.create(review_stamps.IN_FLIGHT_PREFIX, kit.root).stamp_path()
			const record = file_map_stamp.create(review_stamps.GATE_PREFIX, kit.root).stamp_path()
			const gate = josh_harness.run(kit, ['gate', '--force'], GATE_TIMEOUT_MS)
			const is_marked = await josh_harness.wait_for(() => existsSync(marker), MARKER_WAIT_MS)
			const join = await josh_harness.run(kit, ['run:review', '--join'], GATE_TIMEOUT_MS)
			const gate_result = await gate

			// A green gate that withheld its record reads red to every join, race or not — asserted
			// before the join so that failure is told from the race and carries the gate's own output.
			expect(
				{ is_marked, exit_code: gate_result.exit_code, is_recorded: existsSync(record) },
				gate_result.stdout,
			).toStrictEqual({ is_marked: true, exit_code: 0, is_recorded: true })
			expect(join.exit_code, join.stdout).toBe(0)
			expect(join.stdout).toContain(GATE_GREEN)
		},
		GATE_TIMEOUT_MS,
	)
})
