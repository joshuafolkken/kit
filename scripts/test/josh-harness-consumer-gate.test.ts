import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run_carry } from '#scripts/run/run-carry'
import { run_review_steps } from '#scripts/run/run-review-steps'
import { describe, expect, it, vi } from 'vitest'
import { josh_harness, type JoshEnvironment } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const { GATE_TIMEOUT_MS, carry_target } = josh_harness_fixture

const GATE_PASSED = 'verification gate passed'

const environment = josh_harness_fixture.open_environments(['kit', 'consumer'])

function prepare_consumer_gate(consumer: JoshEnvironment, kit: JoshEnvironment): void {
	writeFileSync(path.join(consumer.root, 'change.md'), '# Change\n', 'utf8')
	writeFileSync(path.join(kit.root, 'change.md'), '# Change\n', 'utf8')
	expect(josh_harness.run(consumer, ['lint:related']).exit_code).toBe(0)
	expect(josh_harness.run(consumer, ['test:related']).exit_code).toBe(0)
}

function launch_gate_from_hook(
	kit: JoshEnvironment,
	consumer: JoshEnvironment,
): ReturnType<typeof run_review_steps.launch_gate> {
	try {
		vi.stubEnv('GIT_DIR', path.join(kit.root, '.git'))
		vi.stubEnv('GIT_WORK_TREE', kit.root)

		return run_review_steps.launch_gate(consumer.root)
	} finally {
		vi.unstubAllEnvs()
	}
}

it('targets the fixture repository even when a push hook supplies GIT_DIR', () => {
	const kit = environment('kit')
	const consumer = environment('consumer')
	const previous = process.env['GIT_DIR']

	try {
		process.env['GIT_DIR'] = path.join(kit.root, '.git')
		expect(carry_target(consumer)).toBe(run_carry.carry_path(path.join(consumer.root, '.git')))
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, 'GIT_DIR')
		else process.env['GIT_DIR'] = previous
	}
})

describe('josh harness — detached consumer gate (#2573)', () => {
	it(
		'uses the consumer script when the lane has no kit source entry',
		async () => {
			const consumer = environment('consumer')
			const kit = environment('kit')

			expect(existsSync(path.join(consumer.root, 'scripts', 'josh', 'josh.ts'))).toBe(false)
			prepare_consumer_gate(consumer, kit)
			const launched = launch_gate_from_hook(kit, consumer)

			const log_path = run_review_steps.gate_log_path(consumer.root)
			const is_finished = await josh_harness.wait_for(
				() =>
					existsSync(log_path) &&
					/verification gate passed|verification gate failed|ELIFECYCLE/u.test(
						readFileSync(log_path, 'utf8'),
					),
				GATE_TIMEOUT_MS,
			)

			expect(launched.kind).toBe('launched')
			expect(is_finished, readFileSync(log_path, 'utf8')).toBe(true)
			expect(readFileSync(log_path, 'utf8')).toContain(GATE_PASSED)
		},
		GATE_TIMEOUT_MS,
	)
})
