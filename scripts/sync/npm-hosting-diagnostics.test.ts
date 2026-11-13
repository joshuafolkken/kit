import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { npm_hosting_diagnostics } from './npm-hosting-diagnostics'

const make_directory = temporary_directory()
const NPM = '@joshuafolkken:registry=https://registry.npmjs.org/\n'
const AUTH = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n'
const VERCEL = 'vercel.json'

function project(npmrc: string): string {
	const root = make_directory('hosting-diagnostics-')

	writeFileSync(path.join(root, '.npmrc'), npmrc)
	writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')

	return root
}

describe('npm hosting diagnostics', () => {
	it.each(['wrangler.toml', 'wrangler.jsonc', VERCEL, 'netlify.toml'])(
		'identifies dashboard checks for %s',
		(file) => {
			const root = project(NPM)

			writeFileSync(path.join(root, file), '')
			const messages = npm_hosting_diagnostics.messages(root, NPM).join('\n')

			expect(messages).toContain('config detected')
			expect(messages).toContain('NODE_AUTH_TOKEN')
			expect(messages).toContain('PNPM_CONFIG_NPMRC_AUTH_FILE/npmrcAuthFile')
			expect(messages).toContain('Dashboard state is unknown')
		},
	)

	it('identifies a retained auth line without removing it', () => {
		const root = project(`${NPM}${AUTH}`)

		expect(npm_hosting_diagnostics.messages(root, `${NPM}${AUTH}`)).toEqual([
			expect.stringContaining('Preserved GitHub Packages auth in .npmrc'),
		])
		expect(npm_hosting_diagnostics.messages(root, NPM)).toEqual([])
	})

	it('does not recommend removing auth required by another scope', () => {
		const npmrc = `${NPM}@other:registry=https://npm.pkg.github.com/\n${AUTH}`
		const root = project(npmrc)

		writeFileSync(path.join(root, VERCEL), '{}')
		expect(npm_hosting_diagnostics.messages(root, npmrc)).toEqual([])
	})

	it('uses candidate scopes rather than the previous disk settings', () => {
		const root = project(NPM)
		const candidate = `${NPM}@other:registry=https://npm.pkg.github.com/\n${AUTH}`

		writeFileSync(path.join(root, VERCEL), '{}')
		expect(npm_hosting_diagnostics.messages(root, candidate)).toEqual([])
	})
})
