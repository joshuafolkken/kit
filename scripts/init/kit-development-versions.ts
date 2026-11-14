import { package_manifest } from '#scripts/lib/package-manifest'
import { z } from 'zod'
import { PACKAGE_DIR } from './init-paths'

const kit_manifest_schema = z.object({
	peerDependencies: z.record(z.string(), z.string()).default({}),
	devDependencies: z.record(z.string(), z.string()),
})

type KitManifest = z.infer<typeof kit_manifest_schema>

function read_kit_manifest(): KitManifest {
	return package_manifest.read_manifest(PACKAGE_DIR, kit_manifest_schema)
}

const NPM_ALIAS_PREFIX = 'npm:'

// A devDependency kit installs under another package's name (`npm:<package>@<range>`) is a
// substitute only kit runs, not the package the name stands for. A consumer gets the range kit
// publishes for that name as a peer instead: the bare package, with its own bins (#5272).
function consumer_version(manifest: KitManifest, name: string): string | undefined {
	const version = manifest.devDependencies[name]
	if (version?.startsWith(NPM_ALIAS_PREFIX) !== true) return version

	return manifest.peerDependencies[name]
}

// The version kit's own devDependencies carry for each name (the peer range for an aliased one), so a
// consumer runs the toolchain kit is verified with rather than a copy of it that drifts.
function versions_of(names: ReadonlyArray<string>): Record<string, string> {
	const manifest = read_kit_manifest()
	const entries = names.map((name): [string, string] => {
		const version = consumer_version(manifest, name)
		if (version === undefined) throw new Error(`Missing development version for ${name}`)

		return [name, version]
	})

	return Object.fromEntries(entries)
}

function peer_names(): ReadonlyArray<string> {
	return Object.keys(read_kit_manifest().peerDependencies)
}

const kit_development_versions = { peer_names, versions_of }

export { kit_development_versions }
