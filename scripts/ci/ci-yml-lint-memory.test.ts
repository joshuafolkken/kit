import { execFileSync } from 'node:child_process'
import { buffered_process } from '#scripts/lib/buffered-process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

const STATIC_JOB = 'static-checks'
const GATE_COMMAND = 'pnpm josh gate'
const HEAP_OPTION = '--max-old-space-size=8192'
const HEAP_MIB = 8192
const MIB_BYTES = 1024 * 1024
const HEAP_HEADROOM_MIB = 128
const HEAP_PROBE = 'String(require("node:v8").getHeapStatistics().heap_size_limit)'

function lint_environment(job_name: string, command: string): Readonly<Record<string, string>> {
	const job = ci_yml_fixture.find_job(ci_yml_fixture.RUNTIME_CI_YML, job_name)
	const steps = job?.steps ?? []
	const step = steps.find((candidate) => ci_yml_fixture.step_run(candidate).startsWith(command))

	return step?.env ?? {}
}

function node_options(job_name: string, command: string, group: string): string {
	const environment = lint_environment(job_name, command)

	return workflow_expression_fixture.evaluate_template(environment['NODE_OPTIONS'] ?? '', {
		matrix: { group },
	})
}

function child_heap_limit(): number {
	const output = execFileSync(process.execPath, ['-p', HEAP_PROBE], {
		env: buffered_process.child_environment(),
		encoding: 'utf8',
	})

	return Number(output.trim())
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('CI whole-tree lint memory', () => {
	it.each([
		[STATIC_JOB, GATE_COMMAND],
		['warm-eslint-lineage', 'pnpm josh lint'],
	])('gives %s an eight-GiB child heap', (job_name, command) => {
		const options = node_options(job_name, command, 'lint')

		expect(options).toBe(HEAP_OPTION)
		vi.stubEnv('NODE_OPTIONS', options)
		const limit = child_heap_limit()

		expect(limit).toBeGreaterThanOrEqual(HEAP_MIB * MIB_BYTES)
		expect(limit).toBeLessThan((HEAP_MIB + HEAP_HEADROOM_MIB) * MIB_BYTES)
	})

	it.each(['types', 'rest'])('keeps the %s leg on its default heap', (group) => {
		expect(node_options(STATIC_JOB, GATE_COMMAND, group)).toBe('')
	})
})
