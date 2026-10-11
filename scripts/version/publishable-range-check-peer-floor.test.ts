import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KIT_PACKAGE_NAME } from './kit-descriptor'
import {
	APP_KIT_LABEL,
	APP_KIT_MANIFEST,
	APP_KIT_NAME,
	KIT_MANIFEST,
	KIT_RANGE,
	LAGGING_MANIFEST,
	LAGGING_NAME,
	LAGGING_RANGE,
	manifest_with_peers,
	TIER_MANIFEST,
} from './peer-floor-fixture'
import { publishable_range_check } from './publishable-range-check'

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const MANIFEST = 'package.json'
const NODE_MODULES = 'node_modules'
const ANY_RANGE = '*'
const ABSENT_TOOLKIT = '@joshuafolkken/absent-kit'

const state = { project_root: '' }

function write_file(file_path: string, content: string): void {
	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, content)
}

function install(package_name: string, manifest: string): void {
	write_file(path.join(state.project_root, NODE_MODULES, package_name, MANIFEST), manifest)
}

// A project built on two toolkits, one declared in each field, beside a toolkit it declares without
// having installed and an installed package outside the scope.
function make_project(): void {
	const declared = {
		dependencies: { [APP_KIT_NAME]: ANY_RANGE },
		devDependencies: { [KIT_PACKAGE_NAME]: ANY_RANGE, [ABSENT_TOOLKIT]: ANY_RANGE, eslint: '*' },
	}

	write_file(path.join(state.project_root, MANIFEST), JSON.stringify(declared))
	install(KIT_PACKAGE_NAME, KIT_MANIFEST)
	install(APP_KIT_NAME, APP_KIT_MANIFEST)
	install('eslint', JSON.stringify({ name: 'eslint' }))
}

beforeEach(() => {
	state.project_root = mkdtempSync(path.join(tmpdir(), 'peer-floor-'))
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(state.project_root, { recursive: true, force: true })
})

describe('check_peer_floors', () => {
	it('exits non-zero when a published peer floor is below the installed kit floor', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(publishable_range_check.check_peer_floors(LAGGING_MANIFEST, [KIT_MANIFEST])).toBe(
			FAILURE_EXIT_CODE,
		)
	})

	it('reports the dependency and both ranges on stderr', () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		publishable_range_check.check_peer_floors(LAGGING_MANIFEST, [KIT_MANIFEST])

		expect(error_spy).toHaveBeenCalledWith(
			expect.stringContaining(`${LAGGING_NAME}@${LAGGING_RANGE}`),
		)
		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining(KIT_RANGE))
	})

	it('exits zero and stays silent when the floors agree', () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const manifest = manifest_with_peers({ [LAGGING_NAME]: KIT_RANGE })

		expect(publishable_range_check.check_peer_floors(manifest, [KIT_MANIFEST])).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(error_spy).not.toHaveBeenCalled()
	})

	it('exits zero when no toolkit is installed to compare against', () => {
		expect(publishable_range_check.check_peer_floors(LAGGING_MANIFEST, [])).toBe(SUCCESS_EXIT_CODE)
	})
})

describe('read_installed_toolkit_manifests', () => {
	it('reads every declared toolkit that is installed, from either dependency field', () => {
		make_project()

		const manifests = publishable_range_check.read_installed_toolkit_manifests(state.project_root)

		expect(manifests).toEqual([KIT_MANIFEST, APP_KIT_MANIFEST])
	})

	it('reads nothing in a project that declares no toolkit', () => {
		write_file(path.join(state.project_root, MANIFEST), JSON.stringify({ name: 'plain' }))

		expect(publishable_range_check.read_installed_toolkit_manifests(state.project_root)).toEqual([])
	})

	it('fails a package whose floor is below a toolkit other than kit', () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		make_project()

		const manifests = publishable_range_check.read_installed_toolkit_manifests(state.project_root)

		expect(publishable_range_check.check_peer_floors(TIER_MANIFEST, manifests)).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining(APP_KIT_LABEL))
	})
})
