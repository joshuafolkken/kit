import { describe, expect, it } from 'vitest'
import { basic_path_migration } from './basic-path-migration'

const { migrate_basic_paths } = basic_path_migration

describe('migrate_basic_paths', () => {
	it('moves the CLAUDE.md rules import onto the basic path and keeps the project lines', () => {
		const before =
			'> If kit is not installed, run `pnpm install` first.\n\n@node_modules/@joshuafolkken/kit/dist/CLAUDE.static.md\n\n- Project rule\n'

		expect(migrate_basic_paths(before)).toBe(
			'> If kit is not installed, run `pnpm install` first.\n\n@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md\n\n- Project rule\n',
		)
	})

	it.each(["'", '"'])('moves the Prettier preset import quoted with %s', (quote) => {
		const before = `import { config } from ${quote}@joshuafolkken/kit/prettier/static${quote}\n`

		expect(migrate_basic_paths(before)).toBe(
			`import { config } from ${quote}@joshuafolkken/kit/prettier/basic${quote}\n`,
		)
	})

	it('leaves content without a pre-rename path unchanged', () => {
		const content =
			"import { config } from '@joshuafolkken/kit/prettier'\n// prettier/static-site\n"

		expect(migrate_basic_paths(content)).toBe(content)
	})
})
