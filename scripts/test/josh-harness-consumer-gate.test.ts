import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run_carry } from '#scripts/run/run-carry'
import { run_review_steps } from '#scripts/run/run-review-steps'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { describe, expect, it, vi } from 'vitest'
import { josh_harness, type JoshEnvironment } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const { GATE_TIMEOUT_MS, carry_target } = josh_harness_fixture

const GATE_PASSED = 'verification gate passed'

const environment = josh_harness_fixture.open_environments(['kit', 'consumer'])

async function prepare_consumer_gate(
	consumer: JoshEnvironment,
	kit: JoshEnvironment,
): Promise<void> {
	writeFileSync(path.join(consumer.root, 'change.md'), '# Change\n', 'utf8')
	writeFileSync(path.join(kit.root, 'change.md'), '# Change\n', 'utf8')
	const linted = await josh_harness.run(consumer, ['lint:related'])
	const tested = await josh_harness.run(consumer, ['test:related'])

	expect([linted.exit_code, tested.exit_code]).toStrictEqual([0, 0])
}

// The detached gate leads a process group of its own, so the harness tracks it: a test that times out
// has it stopped rather than left writing into a workspace about to be removed (joshuafolkken/kit#3309).
// The nested mark is the one the harness gives its own children, so this gate reserves no cores either.
function launch_gate_from_hook(
	kit: JoshEnvironment,
	consumer: JoshEnvironment,
): ReturnType<typeof run_review_steps.launch_gate> {
	try {
		vi.stubEnv('GIT_DIR', path.join(kit.root, '.git'))
		vi.stubEnv('GIT_WORK_TREE', kit.root)
		vi.stubEnv(unit_worker_share.NESTED_KEY, unit_worker_share.NESTED_VALUE)
		const launched = run_review_steps.launch_gate(consumer.root)

		if (launched.kind === 'launched') josh_harness.track(launched.pid, 'detached josh gate')

		return launched
	} finally {
		vi.unstubAllEnvs()
	}
}

it('targets the fixture repository even when a push hook supplies GIT_DIR', async () => {
	const kit = environment('kit')
	const consumer = environment('consumer')

	try {
		vi.stubEnv('GIT_DIR', path.join(kit.root, '.git'))
		await expect(carry_target(consumer)).resolves.toBe(
			run_carry.carry_path(path.join(consumer.root, '.git')),
		)
	} finally {
		vi.unstubAllEnvs()
	}
})

// The gate's process group, not its log, says it has finished: the log says passed a moment before the
// gate exits, and what it wrote in that moment landed in a workspace already removed — so the scenario
// waits until the whole group has gone, and reads the log once nothing can still append to it.
async function has_exited(
	launched: ReturnType<typeof run_review_steps.launch_gate>,
): Promise<boolean> {
	if (launched.kind !== 'launched') return false

	return await josh_harness.wait_for(() => !josh_harness.is_running(launched.pid), GATE_TIMEOUT_MS)
}

describe('josh harness — detached consumer gate (#2573)', () => {
	it(
		'uses the consumer script when the lane has no kit source entry',
		async () => {
			const consumer = environment('consumer')
			const kit = environment('kit')

			expect(existsSync(path.join(consumer.root, 'scripts', 'josh', 'josh.ts'))).toBe(false)
			await prepare_consumer_gate(consumer, kit)
			const launched = launch_gate_from_hook(kit, consumer)
			const is_finished = await has_exited(launched)
			const log = readFileSync(run_review_steps.gate_log_path(consumer.root), 'utf8')

			expect(launched.kind).toBe('launched')
			expect(is_finished, log).toBe(true)
			expect(log).toContain(GATE_PASSED)
		},
		GATE_TIMEOUT_MS,
	)
})
