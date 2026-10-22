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

// The version kit's own devDependencies carry for each name, so a consumer runs the toolchain kit
// is verified with rather than a copy of it that drifts.
function versions_of(names: ReadonlyArray<string>): Record<string, string> {
	const { devDependencies: versions } = read_kit_manifest()
	const entries = names.map((name): [string, string] => {
		const version = versions[name]
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
