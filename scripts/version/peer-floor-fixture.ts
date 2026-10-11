import { KIT_PACKAGE_NAME } from './kit-descriptor'

// Mirrors the manifests that shipped the gap: app-kit still declared the eslint floor kit had
// published before 1.1373.0 raised it. Shared so the logic tests and the CLI tests assert against
// the same pair rather than two drifting copies.
const LAGGING_NAME = 'eslint'
const LAGGING_RANGE = '^10.0.0'
const KIT_RANGE = '^10.4.0'
const KIT_VERSION = '1.1373.0'
const KIT_LABEL = `${KIT_PACKAGE_NAME}@${KIT_VERSION}`
const APP_KIT_NAME = '@joshuafolkken/app-kit'
const APP_KIT_VERSION = '1.2.0'
const APP_KIT_LABEL = `${APP_KIT_NAME}@${APP_KIT_VERSION}`
// The same gap one tier up: a package built on app-kit, whose floor app-kit has since raised.
const TIER_NAME = 'svelte'
const TIER_RANGE = '^5.0.0'
const APP_KIT_RANGE = '^5.30.0'

interface Identity {
	name: string
	version?: string
}

const CONSUMER_IDENTITY: Identity = { name: APP_KIT_NAME }

function manifest_with_peers(
	peer_dependencies: Record<string, string>,
	identity: Identity = CONSUMER_IDENTITY,
): string {
	return JSON.stringify({ ...identity, peerDependencies: peer_dependencies })
}

const KIT_MANIFEST = manifest_with_peers(
	{ [LAGGING_NAME]: KIT_RANGE, prettier: '^3.0.0' },
	{ name: KIT_PACKAGE_NAME, version: KIT_VERSION },
)
const APP_KIT_MANIFEST = manifest_with_peers(
	{ [TIER_NAME]: APP_KIT_RANGE },
	{ name: APP_KIT_NAME, version: APP_KIT_VERSION },
)
const LAGGING_MANIFEST = manifest_with_peers({ [LAGGING_NAME]: LAGGING_RANGE, prettier: '^3.0.0' })
const TIER_MANIFEST = manifest_with_peers({ [TIER_NAME]: TIER_RANGE }, { name: 'tier-app' })

export {
	APP_KIT_LABEL,
	APP_KIT_MANIFEST,
	APP_KIT_NAME,
	APP_KIT_RANGE,
	KIT_LABEL,
	KIT_MANIFEST,
	KIT_RANGE,
	LAGGING_MANIFEST,
	LAGGING_NAME,
	LAGGING_RANGE,
	TIER_MANIFEST,
	TIER_NAME,
	TIER_RANGE,
	manifest_with_peers,
}
