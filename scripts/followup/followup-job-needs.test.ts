import { describe, expect, it } from 'vitest'
import { followup_job_needs } from './followup-job-needs'

const WORKFLOW = [
	'jobs:',
	'  unit:',
	'    name: Unit Tests (${{ matrix.shard }}/6)',
	'  static-checks:',
	'    name: Static Checks',
	'  build:',
	'    name: Build',
	'  checks:',
	'    name: Checks',
	'    needs: [static-checks, unit]',
	'  deploy:',
	'    needs: build',
].join('\n')

const SHARD = 'Unit Tests (5/6)'

describe('followup_job_needs.is_waiting_on', () => {
	const graph = followup_job_needs.parse_graph(WORKFLOW)

	it('is true for a job that needs the matrix job a templated name matches', () => {
		expect(followup_job_needs.is_waiting_on(graph, 'Checks', [SHARD])).toBe(true)
	})

	it('is true for a job that needs a plain-named job carrying a matrix suffix', () => {
		expect(followup_job_needs.is_waiting_on(graph, 'deploy', ['Build (20)'])).toBe(true)
	})

	it.each([
		['a job that needs nothing', 'Static Checks'],
		['a job no workflow job is named', 'Lint'],
	])('is false for %s', (_label, job_name) => {
		expect(followup_job_needs.is_waiting_on(graph, job_name, [SHARD])).toBe(false)
	})
})

describe('followup_job_needs.parse_graph', () => {
	it('reads no job from a workflow whose jobs are not a mapping', () => {
		expect(followup_job_needs.parse_graph('name: CI\njobs: [unit]')).toStrictEqual([])
	})
})

describe('followup_job_needs.read_graph', () => {
	it('reads no job from a workflow file that is missing', async () => {
		await expect(
			followup_job_needs.read_graph('.github/workflows/missing.yml'),
		).resolves.toStrictEqual([])
	})
})
