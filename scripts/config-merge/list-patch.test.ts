import { describe, expect, it } from 'vitest'
import { list_patch } from './list-patch'

const ENTRY_A = '@scope/a'
const ENTRY_B = '@scope/b'
const ENTRY_C = '@scope/c'
const SVELTEKIT_ENTRY = '@scope/x/sveltekit'
const SVELTEKIT_PATTERN = /\/sveltekit$/u
const KIT_SVELTEKIT = '@kit/cspell/sveltekit'
const APP_KIT_SVELTEKIT = '@app-kit/cspell/sveltekit'
const PRESERVED_ENTRY = 'words-base'

describe('list_patch.is_matching', () => {
	it('matches an exact string entry', () => {
		expect(list_patch.is_matching(ENTRY_A, [ENTRY_A])).toBe(true)
		expect(list_patch.is_matching(ENTRY_A, [ENTRY_B])).toBe(false)
	})

	it('matches an entry against a RegExp matcher', () => {
		expect(list_patch.is_matching(SVELTEKIT_ENTRY, [SVELTEKIT_PATTERN])).toBe(true)
		expect(list_patch.is_matching('@scope/x/game', [SVELTEKIT_PATTERN])).toBe(false)
	})

	it('returns true when any matcher in the list matches', () => {
		expect(list_patch.is_matching(ENTRY_B, [ENTRY_A, /b$/u])).toBe(true)
	})
})

describe('list_patch.apply_list_patch — ensure', () => {
	it('prepends ensure entries not already present', () => {
		const result = list_patch.apply_list_patch([ENTRY_B], { ensure: [ENTRY_A] })

		expect(result.next).toEqual([ENTRY_A, ENTRY_B])
		expect(result.is_changed).toBe(true)
	})

	it('does not duplicate an ensure entry already present', () => {
		const result = list_patch.apply_list_patch([ENTRY_A, ENTRY_B], { ensure: [ENTRY_A] })

		expect(result.next).toEqual([ENTRY_A, ENTRY_B])
		expect(result.is_changed).toBe(false)
	})

	it('reports no change for an empty patch', () => {
		const result = list_patch.apply_list_patch([ENTRY_A], {})

		expect(result.next).toEqual([ENTRY_A])
		expect(result.is_changed).toBe(false)
	})
})

describe('list_patch.apply_list_patch — remove', () => {
	it('removes entries matching a string matcher', () => {
		const result = list_patch.apply_list_patch([ENTRY_A, ENTRY_B, ENTRY_C], { remove: [ENTRY_B] })

		expect(result.next).toEqual([ENTRY_A, ENTRY_C])
		expect(result.is_changed).toBe(true)
	})

	it('removes entries matching a RegExp matcher', () => {
		const result = list_patch.apply_list_patch([SVELTEKIT_ENTRY, ENTRY_A], {
			remove: [SVELTEKIT_PATTERN],
		})

		expect(result.next).toEqual([ENTRY_A])
		expect(result.is_changed).toBe(true)
	})

	it('removes then prepends ensure (the app-kit swap case)', () => {
		const result = list_patch.apply_list_patch([KIT_SVELTEKIT, PRESERVED_ENTRY], {
			ensure: [APP_KIT_SVELTEKIT],
			remove: [/@kit\/.*\/sveltekit$/u],
		})

		expect(result.next).toEqual([APP_KIT_SVELTEKIT, PRESERVED_ENTRY])
		expect(result.is_changed).toBe(true)
	})
})
