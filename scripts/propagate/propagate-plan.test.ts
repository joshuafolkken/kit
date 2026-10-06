import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { propagate_plan } from './propagate-plan'
import { propagate_run } from './propagate-run'
import { propagate_steps, type ReleasePlan } from './propagate-steps'
import type { PropagateTarget } from './propagate-targets'

const KIT = '@joshuafolkken/kit'
const APP_KIT = '@joshuafolkken/app-kit'
const GAME_KIT = '@joshuafolkken/game-kit'
const LIBRARY = '@joshuafolkken/shared-config'
const JOSH = 'josh'
const JOSH_APP = 'josh-app'
const JOSH_GAME = 'josh-game'
const APP_KIT_BIN = { [JOSH_APP]: 'dist/josh-app.js' }
const MANIFEST = 'package.json'
const NODE_MODULES = 'node_modules'
const RANGE = '^1.0.0'
const KIT_INSTALLED = '1.1005.0'
const KIT_NEWER = '1.2000.0'
const APP_KIT_VERSION = '0.106.0'
const REFUSAL = 'Refusing to propagate'
const CONSUMER = 'owner/consumer'
const KIT_ONLY: ReleasePlan = {
	releases: [{ package_name: KIT, version: KIT_NEWER, bin_name: JOSH }],
	origin: '',
}

const state = { workspace: '' }

function write_manifest(directory: string, content: Record<string, unknown>): void {
	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, MANIFEST), JSON.stringify(content))
}

function make_directory(prefix: string): string {
	return mkdtempSync(path.join(state.workspace, prefix))
}

// An installed toolkit with its CLI shim, the way pnpm leaves a direct dev dependency.
function install(root: string, package_name: string, version: string, bin_name?: string): void {
	const bin = bin_name === undefined ? {} : { bin: { [bin_name]: 'dist/entry.js' } }

	write_manifest(path.join(root, NODE_MODULES, package_name), {
		name: package_name,
		version,
		...bin,
	})
	if (bin_name === undefined) return
	mkdirSync(path.join(root, NODE_MODULES, '.bin'), { recursive: true })
	writeFileSync(path.join(root, NODE_MODULES, '.bin', bin_name), '#!/bin/sh\n')
}

// app-kit's own checkout: it ships `josh-app` and has kit installed at the version it verified.
function make_app_kit(): string {
	const root = make_directory('app-kit-')

	write_manifest(root, {
		name: APP_KIT,
		version: APP_KIT_VERSION,
		bin: { [JOSH_APP]: 'dist/scripts/josh-app.js' },
		devDependencies: { [KIT]: RANGE },
	})
	install(root, KIT, KIT_INSTALLED, JOSH)

	return root
}

function make_consumer(packages: Readonly<Record<string, string | undefined>>): PropagateTarget {
	const root = make_directory('consumer-')
	const names = Object.keys(packages)

	write_manifest(root, {
		name: 'consumer',
		devDependencies: Object.fromEntries(names.map((name) => [name, RANGE])),
	})
	for (const name of names) install(root, name, '1.0.0', packages[name])

	return { repo: CONSUMER, path: root, state: 'ready', declared_range: RANGE }
}

function plan_of(root: string, version: string): ReleasePlan {
	const { plan } = propagate_plan.build_plan(root, version)
	if (plan === undefined) throw new Error('expected a plan')

	return plan
}

beforeEach(() => {
	state.workspace = mkdtempSync(path.join(tmpdir(), 'propagate-plan-'))
})

afterEach(() => {
	rmSync(state.workspace, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('propagate_plan.resolve_supplier', () => {
	it('accepts a toolkit repository, which carries its own package', () => {
		expect(propagate_plan.resolve_supplier(make_app_kit()).supplier).toEqual({
			package_name: APP_KIT,
			bin_name: JOSH_APP,
		})
	})

	it('refuses a scoped package that ships no CLI', () => {
		const root = make_directory('library-')

		write_manifest(root, { name: LIBRARY, version: '1.0.0' })

		expect(propagate_plan.resolve_supplier(root).refusal).toContain(REFUSAL)
	})

	it('refuses a package outside the toolkit scope', () => {
		const root = make_directory('outside-')

		write_manifest(root, { name: 'consumer', bin: { tool: 'dist/tool.js' } })

		expect(propagate_plan.resolve_supplier(root).refusal).toContain(REFUSAL)
	})
})

describe('propagate_plan.build_plan', () => {
	// The base is pinned to what the toolkit was verified with, never to the base's newest release.
	it('carries the base toolkits at the versions the supplier has installed, then itself', () => {
		const plan = plan_of(make_app_kit(), APP_KIT_VERSION)

		expect(plan.releases).toEqual([
			{ package_name: KIT, version: KIT_INSTALLED, bin_name: JOSH },
			{ package_name: APP_KIT, version: APP_KIT_VERSION, bin_name: JOSH_APP },
		])
		expect(plan.releases.map((release) => release.version)).not.toContain(KIT_NEWER)
	})

	// Base first, overlay after: the supplier's sync must run last or the base reverts its overlay.
	it('syncs base first through each toolkit own CLI', () => {
		const commands = propagate_steps.sync_commands(plan_of(make_app_kit(), APP_KIT_VERSION))

		expect(commands.map(({ command }) => command)).toEqual([
			['pnpm', JOSH, 'sync'],
			['pnpm', JOSH_APP, 'sync'],
		])
	})

	it('upgrades every carried package to its pinned version', () => {
		const commands = propagate_steps.upgrade_commands(plan_of(make_app_kit(), APP_KIT_VERSION))

		expect(commands.map(({ package_name }) => package_name)).toEqual([KIT, KIT, APP_KIT, APP_KIT])
		expect(commands[0]?.command).toContain(`${KIT}@${KIT_INSTALLED}`)
		expect(commands[2]?.command).toContain(`${APP_KIT}@${APP_KIT_VERSION}`)
	})
})

describe('propagate_plan.build_plan — kit alone, and refusals', () => {
	// Pins the behavior kit's own propagation had before toolkits could propagate.
	it('carries kit alone, through josh, when kit is the supplier', () => {
		const root = make_directory('kit-')

		write_manifest(root, { name: KIT, version: KIT_NEWER, bin: { [JOSH]: 'dist/josh.js' } })

		expect(plan_of(root, KIT_NEWER)).toEqual({
			releases: [{ package_name: KIT, version: KIT_NEWER, bin_name: propagate_steps.JOSH_BIN }],
			origin: propagate_steps.PROPAGATE_ORIGIN,
		})
	})

	it('refuses when a declared base toolkit is not installed here', () => {
		const root = make_directory('broken-')

		write_manifest(root, {
			name: APP_KIT,
			bin: APP_KIT_BIN,
			devDependencies: { [KIT]: RANGE },
		})

		const { plan, refusal } = propagate_plan.build_plan(root, APP_KIT_VERSION)

		expect(plan).toBeUndefined()
		expect(refusal).toContain(KIT)
	})

	// Left out, kit would read as a toolkit above app-kit in every consumer and skip them all.
	it('refuses when a base toolkit is declared under dependencies', () => {
		const root = make_directory('misplaced-')

		write_manifest(root, {
			name: APP_KIT,
			bin: APP_KIT_BIN,
			dependencies: { [KIT]: RANGE },
		})
		install(root, KIT, KIT_INSTALLED, JOSH)

		const { plan, refusal } = propagate_plan.build_plan(root, APP_KIT_VERSION)

		expect(plan).toBeUndefined()
		expect(refusal).toContain(`${KIT} — declared under \`dependencies\``)
	})
})

describe('propagate_plan.mark_carried', () => {
	it('leaves a consumer of kit alone to kit propagation', () => {
		const target = make_consumer({ [KIT]: JOSH })

		expect(propagate_plan.mark_carried(target, KIT_ONLY)).toBe(target)
	})

	it('skips a consumer with a toolkit above the supplier, naming that toolkit', () => {
		const target = make_consumer({ [KIT]: JOSH, [APP_KIT]: JOSH_APP })
		const marked = propagate_plan.mark_carried(target, KIT_ONLY)

		expect(marked.state).toBe('carried_above')
		expect(propagate_run.skip_reason(marked)).toContain(APP_KIT)
	})

	it('delivers from app-kit to a consumer whose topmost toolkit is app-kit', () => {
		const plan = plan_of(make_app_kit(), APP_KIT_VERSION)
		const target = make_consumer({ [KIT]: JOSH, [APP_KIT]: JOSH_APP })

		expect(propagate_plan.mark_carried(target, plan).state).toBe('ready')
	})

	it('skips from app-kit a consumer that installs game-kit', () => {
		const plan = plan_of(make_app_kit(), APP_KIT_VERSION)
		const target = make_consumer({ [KIT]: JOSH, [APP_KIT]: JOSH_APP, [GAME_KIT]: JOSH_GAME })
		const marked = propagate_plan.mark_carried(target, plan)

		expect(marked.state).toBe('carried_above')
		expect(marked.carriers).toEqual([GAME_KIT])
	})

	// A scoped library is not a toolkit above anything; it must not hold back the release.
	it('does not count a scoped package that ships no CLI as a toolkit above', () => {
		const target = make_consumer({ [KIT]: JOSH, [LIBRARY]: undefined })

		expect(propagate_plan.mark_carried(target, KIT_ONLY).state).toBe('ready')
	})

	it('leaves a candidate that was never going to be processed as it was', () => {
		const target: PropagateTarget = { repo: CONSUMER, path: '/x', state: 'not_downstream' }

		expect(propagate_plan.mark_carried(target, KIT_ONLY)).toBe(target)
	})
})

describe('propagate_plan.create_step_describer', () => {
	it('prints the pinned versions and the sync order without running anything', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(vi.fn())
		const describe_step = propagate_plan.create_step_describer(
			plan_of(make_app_kit(), APP_KIT_VERSION),
		)
		const target = make_consumer({ [KIT]: JOSH })

		expect(describe_step(target, propagate_run.STEP_UPGRADE).is_ok).toBe(true)
		describe_step(target, propagate_run.STEP_SYNC)

		const printed = info.mock.calls.flat().join('\n')

		expect(printed).toContain(`${KIT}@${KIT_INSTALLED}, ${APP_KIT}@${APP_KIT_VERSION}`)
		expect(printed).toContain(`pnpm ${JOSH} sync → pnpm ${JOSH_APP} sync`)
	})
})
