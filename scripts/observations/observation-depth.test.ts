import { describe, expect, it } from 'vitest'
import { observation_depth } from './observation-depth'

// joshuafolkken/kit#5850: each row of the depth test's table, read off the subject path.

const ORCHESTRATION = 'The run orchestration that executes an Issue'

describe('observation_depth.of — depth 2, what measures a run', () => {
	it.each([
		'scripts/cost-runtime/cost-main.ts',
		'scripts/time-runtime/time-background.ts',
		'tools/cost/report.ts',
		'tools/cost-audit/cost-audit-main.ts',
		'tools/time/time-cli.ts',
		'tools/metrics/collect.ts',
	])('answers d2 for %s', (subject_path) => {
		expect(observation_depth.of(subject_path)).toMatchObject({
			depth: 'd2',
			subject: 'What measures a run',
		})
	})
})

describe('observation_depth.of — depth 1, the run orchestration', () => {
	it.each([
		'.claude/skills/workflow-commands/fullrun.md',
		'scripts/backlog/backlog-next-size.ts',
		'scripts/delegation/delegation-policy.ts',
		'scripts/epic/epic-add-body.ts',
		'scripts/issue/issue-file-main.ts',
		'scripts/lane/lane-plan.ts',
		'scripts/observations/observation-record.ts',
		'scripts/run/run-report-cli.ts',
		'scripts/split/split-assess.ts',
	])('answers d1 for %s', (subject_path) => {
		expect(observation_depth.of(subject_path)).toMatchObject({
			depth: 'd1',
			subject: ORCHESTRATION,
		})
	})
})

describe('observation_depth.of — depth 0, what a consumer touches', () => {
	it.each([
		'scripts/git/git-commit.ts',
		'scripts/issue/issue-read.ts',
		'prompts/review.md',
		'eslint.config.js',
	])('answers d0 for %s, matching no deeper row', (subject_path) => {
		expect(observation_depth.of(subject_path)).toStrictEqual({
			depth: 'd0',
			subject: 'What a consumer of this package touches',
			matched: undefined,
		})
	})
})

describe('observation_depth.of — the path form', () => {
	it('reads a leading ./ as the same path and names the prefix it matched', () => {
		expect(observation_depth.of('./scripts/run/run-step.ts')).toStrictEqual({
			depth: 'd1',
			subject: ORCHESTRATION,
			matched: 'scripts/run/',
		})
	})
})
