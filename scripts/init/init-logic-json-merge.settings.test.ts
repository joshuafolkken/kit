import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

// The real VSCode settings shape behind #691: `files.associations` is a registry a consumer
// customizes for its own globs, `eslint.validate` a list a consumer appends its framework to.
const ASSOCIATIONS_KEY = 'files.associations'
const VALIDATE_KEY = 'eslint.validate'
const CSS_GLOB = '*.css'
const TAILWIND_VALUE = 'tailwindcss'
const TSCONFIG_GLOB = '**/tsconfig/*.json'
const JSONC_VALUE = 'jsonc'
const WATCHER_EXCLUDE_KEY = 'files.watcherExclude'
const CONSUMER_EXCLUDE_GLOB = '**/tmp/**'
const JOSH_EXCLUDE_GLOB = '**/.git/josh/**'

// #691: object-valued settings are registries of independent entries, so kit's missing entries merge
// in while the consumer's own entries win. Arrays and scalars stay create-only — the real
// `eslint.validate` case, where a consumer appends 'svelte' that must survive every sync.
describe('init_logic_json_merge.merge_json_object — owned object keys', () => {
	it('adds a kit entry to an object key the consumer already owns', () => {
		const content = `{"${ASSOCIATIONS_KEY}":{"${CSS_GLOB}":"${TAILWIND_VALUE}"}}`

		const result = JSON.parse(
			init_logic_json_merge.merge_json_object(content, {
				[ASSOCIATIONS_KEY]: { [TSCONFIG_GLOB]: JSONC_VALUE },
			}),
		) as Record<string, Record<string, string>>

		expect(result[ASSOCIATIONS_KEY]).toStrictEqual({
			[CSS_GLOB]: TAILWIND_VALUE,
			[TSCONFIG_GLOB]: JSONC_VALUE,
		})
	})

	it('keeps the consumer value when an entry collides', () => {
		const content = `{"${ASSOCIATIONS_KEY}":{"${TSCONFIG_GLOB}":"${TAILWIND_VALUE}"}}`

		const result = JSON.parse(
			init_logic_json_merge.merge_json_object(content, {
				[ASSOCIATIONS_KEY]: { [TSCONFIG_GLOB]: JSONC_VALUE },
			}),
		) as Record<string, Record<string, string>>

		expect(result[ASSOCIATIONS_KEY]).toStrictEqual({ [TSCONFIG_GLOB]: TAILWIND_VALUE })
	})

	it('leaves an array key create-only so a consumer entry is never dropped', () => {
		const content = `{"${VALIDATE_KEY}":["typescript","svelte"]}`

		expect(
			init_logic_json_merge.merge_json_object(content, { [VALIDATE_KEY]: ['typescript'] }),
		).toBe(content)
	})
})

// #5141: a consumer's own watcher exclude survives while kit's josh run-record entry is added.
describe('init_logic_json_merge.merge_json_object — watcher excludes', () => {
	it('adds kit watcher excludes beside a consumer exclude', () => {
		const content = `{"${WATCHER_EXCLUDE_KEY}":{"${CONSUMER_EXCLUDE_GLOB}":true}}`

		const result = JSON.parse(
			init_logic_json_merge.merge_json_object(content, {
				[WATCHER_EXCLUDE_KEY]: { [JOSH_EXCLUDE_GLOB]: true },
			}),
		) as Record<string, Record<string, boolean>>

		expect(result[WATCHER_EXCLUDE_KEY]).toStrictEqual({
			[CONSUMER_EXCLUDE_GLOB]: true,
			[JOSH_EXCLUDE_GLOB]: true,
		})
	})
})

// Re-running `josh sync` must not touch a file it has nothing to add to, so the no-op path is
// asserted on the exact input string rather than on parsed content.
describe('init_logic_json_merge.merge_json_object — no-op path', () => {
	// A second pass over already-canonical output cannot tell "returned the input untouched" apart
	// from "serialized to an identical string", so this case uses deliberately non-canonical
	// formatting that any rewrite would normalize away.
	it('returns the original content untouched when every kit entry is already present', () => {
		const content = `{ "${ASSOCIATIONS_KEY}": {"${TSCONFIG_GLOB}":"${JSONC_VALUE}","${CSS_GLOB}":"${TAILWIND_VALUE}"} }`

		expect(
			init_logic_json_merge.merge_json_object(content, {
				[ASSOCIATIONS_KEY]: { [TSCONFIG_GLOB]: JSONC_VALUE },
			}),
		).toBe(content)
	})

	it('is idempotent — a second pass over the merged content is byte-identical', () => {
		const content = `{"${ASSOCIATIONS_KEY}":{"${CSS_GLOB}":"${TAILWIND_VALUE}"}}`
		const updates = { [ASSOCIATIONS_KEY]: { [TSCONFIG_GLOB]: JSONC_VALUE } }

		const once = init_logic_json_merge.merge_json_object(content, updates)

		expect(init_logic_json_merge.merge_json_object(once, updates)).toBe(once)
	})
})
