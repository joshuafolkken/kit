import path from 'node:path'
import { unused_members } from '#tools/exports/unused-members'
import { describe, expect, it } from 'vitest'
import { unused_members_fixture, type FixtureFile } from './unused-members-fixture'

const { create_project, with_reader, IMPORT_LIBRARY, LIBRARY, READ_KEPT } = unused_members_fixture
const LIBRARY_LINE = 3
const READ_DROPPED = 'export const other = library.dropped()'
const DROPPED = 'library.dropped'
const LIBRARY_PATH = 'library.ts'
const TEST_READER = 'library.test.ts'
const CONFIG_READER = 'vitest.config.ts'

function unused_names(files: ReadonlyArray<FixtureFile>): Array<string> {
	return unused_members
		.find_unused_members(create_project(files))
		.map((member) => `${member.namespace}.${member.member}`)
}

describe('unused_members.find_unused_members — reporting', () => {
	it('reports a namespace member nothing reads, with its file and line', () => {
		const [member, ...rest] = unused_members.find_unused_members(
			create_project(with_reader(READ_KEPT)),
		)

		expect(rest).toStrictEqual([])
		expect(member?.namespace).toBe('library')
		expect(member?.member).toBe('dropped')
		expect(member?.file.endsWith(LIBRARY_PATH)).toBe(true)
		expect(member?.line).toBe(LIBRARY_LINE)
	})

	it('still reports a member when the namespace is only aliased or nested in another', () => {
		const names = unused_names(
			with_reader(
				'const alias = library\nconst outer = { library }\nexport const value = alias.kept() + outer.library.kept()\nexport { outer }',
			),
		)

		expect(names).toStrictEqual([DROPPED])
	})
})

describe('unused_members.find_unused_members — uses', () => {
	it.each([
		['a property access', 'export const value = library.kept() + library.dropped()'],
		[
			'a destructuring',
			'const { kept, dropped } = library\nexport const value = kept() + dropped()',
		],
		['a string-keyed access', "export const value = library.kept() + library['dropped']()"],
		[
			'a spy naming the member by string',
			`declare function spy_on(holder: object, name: string): void\nspy_on(library, 'dropped')\n${READ_KEPT}`,
		],
	])('counts %s as a use', (_label, reader) => {
		expect(unused_names(with_reader(reader))).toStrictEqual([])
	})

	it('counts a reference from a root config file outside the tsconfig include as a use', () => {
		const config_reader = with_reader(READ_DROPPED, CONFIG_READER)

		expect(unused_names([...with_reader(READ_KEPT), ...config_reader])).toStrictEqual([])
	})

	it('counts a reference made only from a test file as a use', () => {
		const test_reader = with_reader(READ_DROPPED, TEST_READER)

		expect(unused_names([...with_reader(READ_KEPT), ...test_reader])).toStrictEqual([])
	})
})

describe('unused_members.find_unused_members — escapes and scope', () => {
	it.each([
		['spread into another object', 'export const copy = { ...library }'],
		['passed as a value', 'declare function take(value: object): void\ntake(library)'],
		[
			'passed as a value through an alias',
			'declare function take(value: object): void\nconst alias = library\nconst again = alias\ntake(again)',
		],
		[
			'read through a computed key',
			"declare const key: 'kept' | 'dropped'\nexport const value = library[key]()",
		],
	])('treats every member as used once the namespace is %s', (_label, reader) => {
		expect(unused_names(with_reader(reader))).toStrictEqual([])
	})

	it.each<[string, FixtureFile]>([
		['a public index.ts entry', ['index.ts', LIBRARY]],
		['an UPPER_CASE constant', ['table.ts', 'const TABLE = { a: 1 }\nexport { TABLE }']],
		[
			'a type-annotated table',
			['table.ts', 'const table: Record<string, number> = { a: 1 }\nexport { table }'],
		],
		['an object never exported', ['local.ts', 'const local = { a: 1 }\nexport const b = 2']],
	])('does not scan %s', (_label, file) => {
		expect(unused_names([file])).toStrictEqual([])
	})
})

const CHANGED_LIBRARY = [LIBRARY_PATH]

async function unused_names_in(
	files: ReadonlyArray<FixtureFile>,
	changed: ReadonlyArray<string>,
): Promise<Array<string>> {
	const root = create_project(files)
	const members = await unused_members.find_unused_members_in(
		root,
		changed.map((relative) => path.join(root, relative)),
	)

	return members.map((member) => `${member.namespace}.${member.member}`)
}

// Readers that never import the library themselves: one through a renaming re-export, and one whose
// escape of a namespace nesting the library carries the library's members with it.
const THROUGH_BARREL: Array<FixtureFile> = [
	['barrel.ts', "export { library as lib } from './library'"],
	['user.ts', "import { lib } from './barrel'\nlib.dropped()"],
]
const THROUGH_OUTER: Array<FixtureFile> = [
	['outer.ts', `${IMPORT_LIBRARY}const outer = { library }\nexport { outer }`],
	[
		'user.ts',
		"import { outer } from './outer'\ndeclare function take(value: object): void\ntake(outer)",
	],
]

describe('unused_members.find_unused_members_in — the changed files only', () => {
	it('reports an unused member of a namespace a changed file declares', async () => {
		await expect(unused_names_in(with_reader(READ_KEPT), CHANGED_LIBRARY)).resolves.toStrictEqual([
			DROPPED,
		])
	})

	it('reports an unused member of a namespace a changed file imports directly', async () => {
		await expect(unused_names_in(with_reader(READ_KEPT), ['reader.ts'])).resolves.toStrictEqual([
			DROPPED,
		])
	})

	it('reports nothing for a namespace no changed file declares or imports directly', async () => {
		const files: Array<FixtureFile> = [
			...with_reader(READ_KEPT),
			['other.ts', 'export const a = 1'],
		]

		await expect(unused_names_in(files, ['other.ts'])).resolves.toStrictEqual([])
	})

	it('ignores a changed file that is no project source: a document or a deleted path', async () => {
		const changed = [...CHANGED_LIBRARY, 'README.md', 'deleted.ts']

		await expect(unused_names_in(with_reader(READ_KEPT), changed)).resolves.toStrictEqual([DROPPED])
	})

	it.each<[string, Array<FixtureFile>]>([
		['a renaming re-export', THROUGH_BARREL],
		['the escape of a namespace nesting it', THROUGH_OUTER],
		['a test file', with_reader(READ_DROPPED, TEST_READER)],
		['a root config file', with_reader(READ_DROPPED, CONFIG_READER)],
	])('counts a use made through %s, as the whole-program scan does', async (_label, readers) => {
		const files = [...with_reader(READ_KEPT), ...readers]

		await expect(unused_names_in(files, CHANGED_LIBRARY)).resolves.toStrictEqual([])
		expect(unused_names(files)).toStrictEqual([])
	})
})

describe('unused_members.find_unused_members — escapes of a nested namespace', () => {
	const NESTED =
		'declare function take(value: object): void\nconst outer = { library }\nexport { outer }\n'

	it.each([
		['the namespace holding it escapes', 'take(outer)'],
		['it is passed as a value as a member', 'take(outer.library)'],
		['an alias of it as a member is passed as a value', 'const alias = outer.library\ntake(alias)'],
	])('treats every member as used once %s', (_label, reader) => {
		expect(unused_names(with_reader(`${NESTED}${reader}`))).toStrictEqual([])
	})
})
