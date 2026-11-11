import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import type { GateStepDefinition } from '#scripts/lib/package-manifest'
import { review_tree } from '#scripts/review/review-tree'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckRecords } from './check-reuse'
import type { GateStepResult } from './gate-report'
import type { GateTree } from './gate-tree'
import { project_step_reuse, type StepRecords } from './project-step-reuse'

// joshuafolkken/kit#7205: a project step runs only when a path its `paths` names moved since it last
// passed — read through the same per-check record and moved-path answer kit's own checks reuse on.

const make_directory = temporary_directory('suite')
const read_git = vi.spyOn(git_spawn, 'read')
const read_tree = vi.spyOn(review_tree, 'read_changed_tree')
const CARGO: GateStepDefinition = { name: 'cargo', command: 'cargo test', paths: ['src/**/*.rs'] }
const SCENES: GateStepDefinition = { name: 'scenes', command: 'godot --check', paths: ['game/**'] }
const GODOT: GateStepDefinition = { name: 'godot', command: 'godot --headless' }
const STEPS = [CARGO, SCENES, GODOT]
const FILES = { 'README.md': 'digest-a' }
const RECORDED: GateTree = { files: FILES, base: 'base-a' }
const SYNCED: GateTree = { files: FILES, base: 'base-b' }
const GUIDE = 'docs/guide.md'

function records_in(prefix: string): CheckRecords {
	const directory = make_directory(`project-step-reuse-test-${prefix}`)

	return function record_of(label: string): string {
		return path.join(directory, `${label}.json`)
	}
}

function passed(step: GateStepDefinition): GateStepResult {
	return { label: step.name, command: step.command, exit_code: 0, output: '', elapsed_ms: 1 }
}

function base_moved(...paths: ReadonlyArray<string>): void {
	read_git.mockResolvedValue(paths.map((name) => `${name}\0`).join(''))
}

// Every step recorded green on `RECORDED`, read back against `SYNCED`.
async function recorded(steps: ReadonlyArray<GateStepDefinition> = STEPS): Promise<StepRecords> {
	const records = records_in('records-')
	const results = steps.map((step) => passed(step))

	await project_step_reuse.record_green_steps(steps, results, {
		tree: RECORDED,
		records,
		is_forced: false,
	})

	return { tree: SYNCED, records, is_forced: false }
}

async function reused(
	reuse: StepRecords,
	steps: ReadonlyArray<GateStepDefinition> = STEPS,
): Promise<Array<string>> {
	const reusable = await project_step_reuse.reusable_steps(steps, reuse)

	return [...reusable.keys()]
}

beforeEach(() => {
	read_git.mockReset()
	read_tree.mockResolvedValue(FILES)
})

describe('project_step_reuse — which steps a moved path reaches', () => {
	it('runs a step when a moved path matches its paths', async () => {
		base_moved('src/lib/parse.rs')

		await expect(reused(await recorded())).resolves.toStrictEqual([SCENES.name])
	})

	it('reuses every step with paths when no moved path matches any of them', async () => {
		base_moved(GUIDE)

		await expect(reused(await recorded())).resolves.toStrictEqual([CARGO.name, SCENES.name])
	})

	it('runs only the steps a moved path reaches, of several', async () => {
		base_moved('game/level.scene', GUIDE)

		await expect(reused(await recorded())).resolves.toStrictEqual([CARGO.name])
	})

	it('runs a step whose bare directory path holds a moved file', async () => {
		base_moved('crates/core/src/lib.rs')
		const crate = { name: 'core', command: 'cargo test -p core', paths: ['crates/core'] }

		await expect(reused(await recorded([crate]), [crate])).resolves.toStrictEqual([])
	})

	it('always runs a step that declares no paths', async () => {
		base_moved()

		await expect(reused(await recorded())).resolves.not.toContain(GODOT.name)
	})
})

describe('project_step_reuse — when the records do not hold', () => {
	it('runs a step whose command changed since its record was taken', async () => {
		base_moved()
		const reuse = await recorded()
		const edited = { ...CARGO, command: 'cargo test --all' }

		await expect(reused(reuse, [edited, SCENES])).resolves.toStrictEqual([SCENES.name])
	})

	it('runs every step on a forced gate, or where the gate keeps no records', async () => {
		base_moved()
		const reuse = await recorded()

		await expect(reused({ ...reuse, is_forced: true })).resolves.toStrictEqual([])
		await expect(reused({ ...reuse, records: undefined })).resolves.toStrictEqual([])
	})

	it('records nothing for a failed step', async () => {
		base_moved()
		const records = records_in('failed-')
		const failed = { ...passed(CARGO), exit_code: 1 }

		await project_step_reuse.record_green_steps([CARGO], [failed], {
			tree: RECORDED,
			records,
			is_forced: false,
		})

		await expect(
			reused({ tree: SYNCED, records, is_forced: false }, [CARGO]),
		).resolves.toStrictEqual([])
	})
})
