import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { layer_fixture } from './layer-fixture'
import { layer_hooks } from './layer-hooks'
import type { LayerStep } from './layer-step'

const PRE_COMMIT = 'pre-commit'
const PRE_PUSH = 'pre-push'
const PROJECT = 'project'
const BASE_RELATIVE = './lefthook/base.yml'
const TYPE_CHECK = 'type-check'
// Interpolated for the reason `layer-fixture.ts` interpolates its own: eslint reads a literal
// lefthook placeholder inside a template string as a mistyped interpolation.
const PUSH_FILES = '{push_files}'
const ALL_FILES = '{all_files}'
const STEPS = layer_hooks.hook_steps_from_yaml(layer_fixture.HOOKS_YAML)

function step_named(layer: string, name: string): LayerStep | undefined {
	return STEPS.find((step) => step.layer === layer && step.step === name)
}

// A checkout whose entry document extends the fixture, so `extends` is followed for real rather
// than asserted on a parsed path alone.
function write_extending_tree(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'layer-hooks-'))

	mkdirSync(path.join(root, 'lefthook'))
	writeFileSync(
		path.join(root, layer_hooks.LEFTHOOK_ENTRY),
		`extends:\n  - ${BASE_RELATIVE}\n${PRE_COMMIT}:\n  commands:\n    local:\n      run: pnpm josh audit\n`,
	)
	writeFileSync(path.join(root, 'lefthook', 'base.yml'), layer_fixture.HOOKS_YAML)

	return root
}

describe('layer_hooks — reading lefthook commands', () => {
	it('discovers a layer per hook section rather than from a fixed list', () => {
		expect([...new Set(STEPS.map((step) => step.layer))]).toStrictEqual([PRE_COMMIT, PRE_PUSH])
	})

	it('marks a command carrying the staged-files placeholder as staged-only', () => {
		expect(step_named(PRE_COMMIT, 'eslint')?.scope).toBe('staged')
	})

	it('marks a command without the placeholder as whole-project, even beside staged ones', () => {
		expect(step_named(PRE_COMMIT, TYPE_CHECK)?.scope).toBe(PROJECT)
	})

	it('reads the setup block, so a hook-level install is a step like any other', () => {
		expect(step_named(PRE_PUSH, 'setup')?.command).toBe('pnpm install')
	})

	it('marks a command carrying any lefthook file-list placeholder as staged', () => {
		const steps = layer_hooks.hook_steps_from_yaml(
			`${PRE_PUSH}:\n  commands:\n    a:\n      run: pnpm exec eslint ${PUSH_FILES}\n`,
		)

		expect(steps[0]?.scope).toBe('staged')
	})

	it('leaves an all-files command whole-project, since that is what it means', () => {
		const steps = layer_hooks.hook_steps_from_yaml(
			`${PRE_PUSH}:\n  commands:\n    a:\n      run: pnpm exec eslint ${ALL_FILES}\n`,
		)

		expect(steps[0]?.scope).toBe(PROJECT)
	})

	it('reads lefthook 2 jobs, including the ones nested in a group', () => {
		const steps = layer_hooks.hook_steps_from_yaml(
			`${PRE_COMMIT}:\n  jobs:\n    - name: lint\n      run: pnpm exec eslint .\n    - name: pack\n      group:\n        jobs:\n          - name: spell\n            run: pnpm exec cspell .\n`,
		)

		expect(steps.map((step) => step.step)).toStrictEqual(['lint', 'spell'])
	})

	it('reads no steps from an unparseable document instead of throwing', () => {
		expect(layer_hooks.hook_steps_from_yaml('pre-commit: [')).toStrictEqual([])
	})
})

describe('layer_hooks — following extends', () => {
	it('reads the entry document and everything it extends', () => {
		const names = layer_hooks.read_hook_steps(write_extending_tree()).map((step) => step.step)

		expect(names).toContain('local')
		expect(names).toContain(TYPE_CHECK)
	})

	it('resolves an extends path relative to the document that declared it', () => {
		const resolved = layer_hooks.extends_paths('extends:\n  - ./a/b.yml\n', '/repo/lefthook.yml')

		expect(resolved).toStrictEqual(['/repo/a/b.yml'])
	})

	it('reads nothing where the entry document is absent', () => {
		const empty = mkdtempSync(path.join(tmpdir(), 'layer-empty-'))

		expect(layer_hooks.read_hook_steps(empty)).toStrictEqual([])
	})
})
