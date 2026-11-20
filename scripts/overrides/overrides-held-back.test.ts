import { describe, expect, it } from 'vitest'
import { overrides_fixture } from './overrides-fixture'
import { overrides_check } from './overrides-logic'

const { make_overrides, make_package_json, CAPPED_PKG_KEY, CAPPED_PKG_VALUE } = overrides_fixture
const HELD_BACK = overrides_check.HELD_BACK_PACKAGE_NAMES
const UNICORN = 'eslint-plugin-unicorn'
const SVELTE_AND_VITEST_UPDATE = ['pnpm', 'update', '--latest', 'svelte', 'vitest']

describe('overrides_check.list_excluded_package_names', () => {
	it('holds back typescript and eslint-plugin-unicorn', () => {
		expect(overrides_check.list_excluded_package_names({})).toEqual(['typescript', UNICORN])
	})

	it('merges held-back packages with capped-override packages', () => {
		const overrides = make_overrides([[CAPPED_PKG_KEY, CAPPED_PKG_VALUE]])

		expect(overrides_check.list_excluded_package_names(overrides)).toEqual([
			...HELD_BACK,
			'some-pkg',
		])
	})

	it('merges held-back packages with bare-override packages', () => {
		const overrides = make_overrides([['svelte', '^5.55.7']])

		expect(overrides_check.list_excluded_package_names(overrides)).toEqual([...HELD_BACK, 'svelte'])
	})

	it('deduplicates a package that is both held back and capped', () => {
		const overrides = make_overrides([[`${UNICORN}@>=80`, '^79']])

		expect(overrides_check.list_excluded_package_names(overrides)).toEqual(HELD_BACK)
	})
})

describe('overrides_check.build_update_command — held-back packages', () => {
	it('excludes the held-back typescript package even without any overrides', () => {
		const content = make_package_json({ svelte: '^5' }, { typescript: '^6', vitest: '^3' })

		expect(overrides_check.build_update_command({}, content)).toEqual(SVELTE_AND_VITEST_UPDATE)
	})

	it('leaves eslint-plugin-unicorn out of the update targets without any overrides', () => {
		const content = make_package_json({ svelte: '^5' }, { [UNICORN]: '^79.0.0', vitest: '^3' })

		expect(overrides_check.build_update_command({}, content)).toEqual(SVELTE_AND_VITEST_UPDATE)
	})

	it('excludes both held-back and overridden packages together', () => {
		const overrides = make_overrides([[CAPPED_PKG_KEY, CAPPED_PKG_VALUE]])
		const content = make_package_json(
			{ svelte: '^5' },
			{ 'some-pkg': '^4', typescript: '^6', vitest: '^3' },
		)

		expect(overrides_check.build_update_command(overrides, content)).toEqual(
			SVELTE_AND_VITEST_UPDATE,
		)
	})
})
