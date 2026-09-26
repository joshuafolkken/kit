import { existsSync } from 'node:fs'
import path from 'node:path'
import { josh_harness, type EnvironmentKind } from '#scripts/test/josh-harness'
import { expect, it } from 'vitest'

const KINDS: ReadonlyArray<Exclude<EnvironmentKind, 'packed'>> = ['kit', 'consumer', 'lane']
const TIMEOUT_MS = 30_000

it.each(KINDS)(
	'keeps the %s environment untouched without a lockfile',
	async (kind) => {
		const opened = await josh_harness.open_environment(kind)

		try {
			const result = josh_harness.run(opened, ['registry:migrate'])

			expect(result.exit_code, result.stderr).toBe(1)
			expect(result.stdout).toContain('No lockfile')
			expect(existsSync(path.join(opened.root, '.npmrc'))).toBe(false)
		} finally {
			josh_harness.close_environment(opened)
		}
	},
	TIMEOUT_MS,
)
