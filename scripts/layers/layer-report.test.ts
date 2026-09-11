import { describe, expect, it } from 'vitest'
import { layer_ci } from './layer-ci'
import { layer_fixture } from './layer-fixture'
import { layer_hooks } from './layer-hooks'
import { layer_report, type CheckRow, type LayerReport } from './layer-report'
import type { LayerStep } from './layer-step'

const GATE = 'gate'
const PRE_COMMIT = 'pre-commit'
const CI = 'ci'
const PROJECT = 'project'
const CSPELL = 'cspell'
const ESLINT = 'eslint'
const TYPE_CHECK = 'type-check'
const UNIT_TESTS = 'unit-tests'

// The known configuration of `layer-fixture.ts`, assembled the way `layer-sources.ts` assembles the
// real one: the gate first, then the hooks, then the pull-request workflows.
const KNOWN_STEPS: ReadonlyArray<LayerStep> = [
	...layer_fixture.GATE_STEPS,
	...layer_hooks.hook_steps_from_yaml(layer_fixture.HOOKS_YAML),
	...layer_ci.ci_steps_from_yaml('ci.yml', layer_fixture.PULL_REQUEST_WORKFLOW),
	...layer_ci.ci_steps_from_yaml('publish.yml', layer_fixture.PUSH_ONLY_WORKFLOW),
]

const REPORT: LayerReport = layer_report.build_report(KNOWN_STEPS)

function layer_names(row: CheckRow | undefined): ReadonlyArray<string> {
	return (row?.layers ?? []).map((entry) => entry.layer)
}

function row_for(check: string): CheckRow | undefined {
	return [...REPORT.repeated, ...REPORT.single].find((row) => row.check === check)
}

describe('layer_report — the duplication list a known configuration produces', () => {
	it('lists exactly the checks that run in more than one layer, most repeated first', () => {
		expect(REPORT.repeated.map((row) => row.check)).toStrictEqual([
			CSPELL,
			ESLINT,
			TYPE_CHECK,
			UNIT_TESTS,
			'dependency-install',
			'prettier',
		])
	})

	it('counts the layers each repeated check runs in', () => {
		expect(REPORT.repeated.map((row) => row.layers.length)).toStrictEqual([3, 3, 3, 3, 2, 2])
	})

	it('names the layers a check repeats in', () => {
		expect(layer_names(row_for(CSPELL))).toStrictEqual([GATE, PRE_COMMIT, CI])
		expect(layer_names(row_for(UNIT_TESTS))).toStrictEqual([GATE, 'pre-push', CI])
	})

	it('lists every layer that contributed a step, in reading order', () => {
		expect(REPORT.layers).toStrictEqual([GATE, PRE_COMMIT, 'pre-push', CI])
	})

	it('reports nothing unresolved for a configuration whose josh targets are all known', () => {
		expect(REPORT.unresolved).toStrictEqual([])
	})
})

describe('layer_report — staged-only against whole-project', () => {
	it('records a hook that sees only the staged files as staged in that layer alone', () => {
		expect(row_for(ESLINT)?.layers.map((entry) => entry.scopes)).toStrictEqual([
			[PROJECT],
			['staged'],
			[PROJECT],
		])
	})

	it('separates a whole-project hook check from the staged ones beside it', () => {
		expect(row_for(TYPE_CHECK)?.layers.map((entry) => entry.scopes)).toStrictEqual([
			[PROJECT],
			[PROJECT],
			[PROJECT],
		])
	})
})

// joshuafolkken/kit#1786: two of the rows this report prints are not the repetition the layer count
// makes them look like — a green gate lets the hook decline the check outright. The fixture carries
// both sides on purpose: its pre-push unit run goes through the gate-reusing `josh` target, while its
// pre-commit type check is a bare `tsc --noEmit`, so the note has to follow the command rather than
// the layer.
describe('layer_report — the layers a green gate lets a hook skip', () => {
	it('marks the hook row whose command reads the gate record', () => {
		expect(row_for(UNIT_TESTS)?.layers.map((entry) => entry.is_gate_skipped)).toStrictEqual([
			false,
			true,
			false,
		])
	})

	it('leaves a hook row alone when its command runs the check itself', () => {
		expect(row_for(TYPE_CHECK)?.layers.map((entry) => entry.is_gate_skipped)).toStrictEqual([
			false,
			false,
			false,
		])
	})

	it('prints the condition beside the scope of the row it applies to', () => {
		expect(layer_report.format_report(REPORT).join('\n')).toContain(
			'pre-push (project, skipped where the gate record covers this tree)',
		)
	})

	it('leaves the gate and CI rows of that same check unqualified', () => {
		expect(layer_report.format_report(REPORT).join('\n')).toContain(
			'gate (project) · pre-push (project, skipped where the gate record covers this tree) · ci (project)',
		)
	})
})

describe('layer_report — rendering', () => {
	const LINES = layer_report.format_report(REPORT)

	it('heads the report with the layers it read', () => {
		expect(LINES[0]).toBe('Verification layers — 4 read: gate, pre-commit, pre-push, ci')
	})

	it('puts the scope beside every layer of a repeated row', () => {
		expect(LINES.join('\n')).toContain('gate (project) · pre-commit (staged) · ci (project)')
	})

	it('prints the singular unit for a check that runs in one layer only', () => {
		const single = layer_report.format_report(
			layer_report.build_report([...layer_fixture.GATE_STEPS].slice(0, 1)),
		)

		expect(single.join('\n')).toContain('1 layer')
	})

	it('names an unresolved josh target in a note rather than dropping it', () => {
		const report = layer_report.build_report([
			{ layer: PRE_COMMIT, step: 'x', command: 'pnpm josh no-such-target', scope: PROJECT },
		])

		expect(layer_report.format_report(report).join('\n')).toContain(
			'unresolved josh commands: no-such-target',
		)
	})
})
