import { prettier_format_package_json } from '#scripts/config-merge/prettier-json-fixture'
import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

// `josh init` / `josh sync` edit a consumer's package.json in place. Whatever they write has to
// survive that consumer's own `prettier --check` — a rewrite the project never asked for must not
// fail their formatting gate, or (with the lefthook pre-commit hook kit ships) block their next
// commit. prettier selects the `json-stringify` printer from the FILENAME package.json, and that
// printer puts every array element on its own line regardless of width, so the array inlining that
// keeps a tsconfig prettier-clean does the opposite here. See joshuafolkken/kit#797.
//
// The guard is one case per writer rather than one over the serializer, because the defect was never
// in the serializer's own behavior — it was a writer reaching for the wrong one. A new package.json
// writer belongs in this list.

// Short arrays (`keywords`, `files`) are the payload: they fit within printWidth, so they are exactly
// what the old serializer would have collapsed onto one line. Everything else is scaffolding the
// individual writers need to have something to do — including `devDependencies` placed ahead of
// `scripts`, out of canonical order, so `sort_package_json_keys` has a reordering to perform rather
// than returning its input untouched.
const CONSUMER_PACKAGE_JSON = `${JSON.stringify(
	{
		name: 'demo',
		version: '1.0.0',
		keywords: ['cli', 'tool'],
		files: ['dist'],
		devDependencies: { typescript: '^5.0.0' },
		scripts: { build: 'tsc', postinstall: 'tsx node_modules/@joshuafolkken/kit/scripts/x.ts' },
	},
	undefined,
	'\t',
)}\n`

interface Writer {
	name: string
	run: (content: string) => string
}

const WRITERS: ReadonlyArray<Writer> = [
	{
		name: 'merge_package_scripts',
		run: (content) => init_logic_json_merge.merge_package_scripts(content, { josh: 'josh' }),
	},
	{
		name: 'merge_development_dependencies',
		run: (content) =>
			init_logic_json_merge.merge_development_dependencies(content, { zod: '^4.0.0' }),
	},
	{
		name: 'merge_package_manager',
		run: (content) => init_logic_json_merge.merge_package_manager(content, 'pnpm@11.21.0'),
	},
	{
		name: 'merge_development_engines',
		run: (content) =>
			init_logic_json_merge.merge_development_engines(content, {
				packageManager: { name: 'pnpm', version: '>=11.0.0-0' },
			}),
	},
	{
		name: 'merge_package_script_suffix',
		run: (content) =>
			init_logic_json_merge.merge_package_script_suffix(content, 'build', 'echo ok'),
	},
	{
		name: 'remove_script_with_marker',
		run: (content) =>
			init_logic_json_merge.remove_script_with_marker(content, 'postinstall', 'scripts/x.ts'),
	},
	{
		name: 'sort_package_json_keys',
		run: (content) => init_logic_json_merge.sort_package_json_keys(content),
	},
]

function is_noop_writer(writer: Writer): boolean {
	return writer.run(CONSUMER_PACKAGE_JSON) === CONSUMER_PACKAGE_JSON
}

describe('package.json writers emit prettier-clean output (#797)', () => {
	// Guards the fixture itself: if a writer no-oped, its cases below would pass by returning the
	// already-clean input and prove nothing about the serializer.
	it('starts from a package.json every writer actually rewrites', () => {
		const skipped = WRITERS.filter((writer) => is_noop_writer(writer)).map(({ name }) => name)

		expect(skipped).toStrictEqual([])
	})

	it.each(WRITERS)('$name leaves prettier nothing to reformat', async ({ run }) => {
		const written = run(CONSUMER_PACKAGE_JSON)

		expect(await prettier_format_package_json(written)).toBe(written)
	})

	it.each(WRITERS)('$name preserves the consumer short arrays expanded', ({ run }) => {
		expect(run(CONSUMER_PACKAGE_JSON)).toContain('"keywords": [\n\t\t"cli",\n\t\t"tool"\n\t]')
	})
})
