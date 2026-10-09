// The two references `josh init` writes into a basic project, under the paths they had while the
// basic profile was named static. kit still ships both old paths so an earlier
// project keeps working; re-running `josh init` moves the project onto the new ones, which is what
// lets the old paths be retired once projects have moved.
const RENAMED_REFERENCES: ReadonlyArray<readonly [RegExp, string]> = [
	[
		/@node_modules\/@joshuafolkken\/kit\/dist\/CLAUDE\.static\.md(?![\w.])/gu,
		'@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md',
	],
	[/@joshuafolkken\/kit\/prettier\/static(?=['"])/gu, '@joshuafolkken/kit/prettier/basic'],
]

function migrate_basic_paths(content: string): string {
	let migrated = content

	for (const [pattern, replacement] of RENAMED_REFERENCES) {
		migrated = migrated.replaceAll(pattern, () => replacement)
	}

	return migrated
}

const basic_path_migration = { migrate_basic_paths }
export { basic_path_migration }
