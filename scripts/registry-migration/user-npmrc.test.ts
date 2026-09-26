import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { user_npmrc } from './user-npmrc'

test('reads an existing user npmrc without changing it', () => {
	const home = mkdtempSync(path.join(os.tmpdir(), 'user-npmrc-'))
	const file = path.join(home, '.npmrc')
	const content = '@joshuafolkken:registry=https://npm.pkg.github.com\n'

	try {
		writeFileSync(file, content)
		expect(user_npmrc.read(home)).toBe(content)
	} finally {
		rmSync(home, { recursive: true, force: true })
	}
})
