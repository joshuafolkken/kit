import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { layer_ci } from './layer-ci'
import { layer_fixture } from './layer-fixture'

const CI_STEPS = layer_ci.ci_steps_from_yaml('ci.yml', layer_fixture.PULL_REQUEST_WORKFLOW)

describe('layer_ci — which workflows count as a layer', () => {
	it('reads a workflow a pull request triggers', () => {
		expect(CI_STEPS.length).toBeGreaterThan(0)
	})

	it('reads nothing from a push-only workflow, which no pull request waits for', () => {
		expect(
			layer_ci.ci_steps_from_yaml('publish.yml', layer_fixture.PUSH_ONLY_WORKFLOW),
		).toStrictEqual([])
	})

	it('reads a workflow whose triggers are written as a bare list', () => {
		const steps = layer_ci.ci_steps_from_yaml(
			'lint.yml',
			'on: [pull_request]\njobs:\n  a:\n    steps:\n      - run: pnpm exec eslint .\n',
		)

		expect(steps).toHaveLength(1)
	})

	it('reads a workflow whose on key was folded into the YAML 1.1 boolean', () => {
		const steps = layer_ci.ci_steps_from_yaml(
			'lint.yml',
			'true:\n  pull_request:\njobs:\n  a:\n    steps:\n      - run: pnpm exec eslint .\n',
		)

		expect(steps).toHaveLength(1)
	})
})

describe('layer_ci — what a step contributes', () => {
	it('labels a step by workflow, job and name so the row says where to edit it', () => {
		expect(CI_STEPS.map((step) => step.step)).toContain('ci.yml/checks/Run verification gate')
	})

	it('keeps an action-only step, since an action is as much a check as a shell line', () => {
		const checkout = CI_STEPS.find((step) => step.step.endsWith('Checkout code'))

		expect(checkout?.command).toBe('actions/checkout@v7')
	})

	it('treats every CI step as whole-project: CI has no staged file list', () => {
		expect(CI_STEPS.every((step) => step.scope === 'project')).toBe(true)
	})

	it('reads this repository own workflows without throwing', () => {
		expect(layer_ci.read_ci_steps(process.cwd()).length).toBeGreaterThan(0)
	})

	it('skips a directory named like a workflow instead of crashing on the read', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'layer-ci-'))

		mkdirSync(path.join(root, layer_ci.WORKFLOW_DIRECTORY, 'trap.yml'), { recursive: true })

		expect(layer_ci.read_ci_steps(root)).toStrictEqual([])
	})
})
