import { existsSync } from 'node:fs'
import path from 'node:path'
import { npm_acquisition } from '#scripts/registry-migration/npm-acquisition'

const HOSTS = [
	{ name: 'Cloudflare', files: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'] },
	{ name: 'Vercel', files: ['vercel.json'] },
	{ name: 'Netlify', files: ['netlify.toml'] },
]

function messages(root: string, npmrc: string): Array<string> {
	if (!npm_acquisition.is_npm_only(root, npmrc)) return []
	const hosts = HOSTS.filter((host) => host.files.some((file) => existsSync(path.join(root, file))))
	const diagnostics = hosts.map(
		(host) =>
			`${host.name} config detected: inspect dashboard NODE_AUTH_TOKEN, NPM_CONFIG_REGISTRY, and PNPM_CONFIG_NPMRC_AUTH_FILE/npmrcAuthFile. Dashboard state is unknown; remove only kit-only GitHub Packages settings after a token-free build.`,
	)

	if (npmrc.includes('//npm.pkg.github.com/:_authToken=')) {
		diagnostics.push(
			'Preserved GitHub Packages auth in .npmrc: check external npmrcAuthFile settings before removing this credential; sync cannot inspect hosting dashboards.',
		)
	}

	return diagnostics
}

function report(root: string, npmrc: string): void {
	for (const message of messages(root, npmrc)) console.warn(`  ⚠ ${message}`)
}

const npm_hosting_diagnostics = { messages, report }
export { npm_hosting_diagnostics }
