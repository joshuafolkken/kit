import { buffered_process } from '#scripts/lib/buffered-process'
import { test_unit_guard } from '#scripts/test/test-unit-guard'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gate_plan } from './gate-plan'
import { project_checks } from './project-checks'
import { verification_gate } from './verification-gate'

const NO_TYPE_FILES = 'no TypeScript files were found'

afterEach(() => vi.restoreAllMocks())

describe('static gate execution', () => {
	it('assigns the package root to a static project check', async () => {
		vi.spyOn(project_checks, 'is_static').mockReturnValue(true)
		vi.spyOn(project_checks, 'project_root').mockReturnValue('/project')

		const check = gate_plan.GATE_CHECKS.find((entry) => entry.label === 'lint')
		if (check === undefined) throw new Error('The gate has no lint step')

		const step = await verification_gate.build_gate_step(check, '/project/src')

		expect(step.cwd).toBe('/project')
	})

	it('passes the package root to the checker process', async () => {
		const run = vi.spyOn(buffered_process, 'run_buffered_process').mockResolvedValue({
			output: '',
			exit_code: 0,
			elapsed_ms: 0,
		})

		await verification_gate.run_gate_step({
			label: 'lint',
			command_args: ['josh', 'lint'],
			cwd: '/project',
		})
		expect(run).toHaveBeenCalledWith(['josh', 'lint'], { cwd: '/project' })
	})
})

describe('static gate checks with no target', () => {
	it('marks the default type-check step as skipped for a static project', async () => {
		const reason = vi.spyOn(project_checks, 'type_check_skip_reason').mockReturnValue(NO_TYPE_FILES)
		const check = gate_plan.GATE_CHECKS.find((entry) => entry.label === gate_plan.TYPE_CHECK_LABEL)
		if (check === undefined) throw new Error('The gate has no type-check step')

		const step = await verification_gate.build_gate_step(check, '/project')

		expect(step.skip_reason).toBe(NO_TYPE_FILES)
		reason.mockRestore()
	})

	it('reports a missing TypeScript target without starting the checker', async () => {
		const result = await verification_gate.run_gate_step({
			label: 'check',
			command_args: ['josh', 'check'],
			skip_reason: NO_TYPE_FILES,
		})

		expect(result.exit_code).toBe(0)
		expect(result.output).toContain(test_unit_guard.SKIP_MARKER)
		expect(result.output).toContain('no TypeScript files')
	})
})
