import { describe, expect, it } from 'vitest'
import { KIT_PACKAGE_NAME } from './kit-descriptor'
import { peer_floor } from './peer-floor'
import {
	APP_KIT_LABEL,
	APP_KIT_MANIFEST,
	APP_KIT_RANGE,
	KIT_LABEL,
	KIT_MANIFEST,
	KIT_RANGE,
	LAGGING_MANIFEST,
	LAGGING_NAME,
	LAGGING_RANGE,
	manifest_with_peers,
	TIER_MANIFEST,
	TIER_NAME,
	TIER_RANGE,
} from './peer-floor-fixture'

const LAGGING_PEER = {
	name: LAGGING_NAME,
	range: LAGGING_RANGE,
	toolkit: KIT_LABEL,
	toolkit_range: KIT_RANGE,
}
const TIER_PEER = {
	name: TIER_NAME,
	range: TIER_RANGE,
	toolkit: APP_KIT_LABEL,
	toolkit_range: APP_KIT_RANGE,
}
const UNSATISFIABLE_RANGE = '>2.0.0 <1.0.0'
const UNREADABLE_RANGE = 'workspace:*'

describe('find_lagging', () => {
	it('reports a peer whose floor sits below the installed kit floor', () => {
		expect(peer_floor.find_lagging(LAGGING_MANIFEST, [KIT_MANIFEST])).toEqual([LAGGING_PEER])
	})

	it('reports a peer whose floor sits below a toolkit other than kit', () => {
		const toolkits = [KIT_MANIFEST, APP_KIT_MANIFEST]

		expect(peer_floor.find_lagging(TIER_MANIFEST, toolkits)).toEqual([TIER_PEER])
	})

	it('reports nothing when no toolkit is installed', () => {
		expect(peer_floor.find_lagging(LAGGING_MANIFEST, [])).toEqual([])
	})

	it('reports nothing when the ranges match', () => {
		const manifest = manifest_with_peers({ [LAGGING_NAME]: KIT_RANGE })

		expect(peer_floor.find_lagging(manifest, [KIT_MANIFEST])).toEqual([])
	})

	it('reports nothing when the consumer range is the narrower one', () => {
		const manifest = manifest_with_peers({ [LAGGING_NAME]: '^10.12.0' })

		expect(peer_floor.find_lagging(manifest, [KIT_MANIFEST])).toEqual([])
	})

	it('reports nothing for a peer kit does not share', () => {
		expect(peer_floor.find_lagging(TIER_MANIFEST, [KIT_MANIFEST])).toEqual([])
	})

	it('reports nothing for a manifest that publishes no peers', () => {
		expect(peer_floor.find_lagging(JSON.stringify({ name: 'app' }), [KIT_MANIFEST])).toEqual([])
	})

	it('never compares a toolkit against itself', () => {
		const stale_kit = manifest_with_peers(
			{ [LAGGING_NAME]: LAGGING_RANGE },
			{ name: KIT_PACKAGE_NAME },
		)

		expect(peer_floor.find_lagging(stale_kit, [KIT_MANIFEST])).toEqual([])
	})
})

describe('find_lagging on a range with no floor', () => {
	it('reports nothing for a range that resolves outside the registry', () => {
		const manifest = manifest_with_peers({ [LAGGING_NAME]: UNREADABLE_RANGE })

		expect(peer_floor.find_lagging(manifest, [KIT_MANIFEST])).toEqual([])
	})

	it('reports nothing for a range nothing can satisfy', () => {
		const manifest = manifest_with_peers({ [LAGGING_NAME]: UNSATISFIABLE_RANGE })

		expect(peer_floor.find_lagging(manifest, [KIT_MANIFEST])).toEqual([])
	})

	it('reports nothing when the toolkit range cannot be read', () => {
		const toolkit = manifest_with_peers(
			{ [LAGGING_NAME]: UNREADABLE_RANGE },
			{ name: KIT_PACKAGE_NAME },
		)

		expect(peer_floor.find_lagging(LAGGING_MANIFEST, [toolkit])).toEqual([])
	})

	it('reports nothing when nothing can satisfy the toolkit range', () => {
		const toolkit = manifest_with_peers(
			{ [LAGGING_NAME]: UNSATISFIABLE_RANGE },
			{ name: KIT_PACKAGE_NAME },
		)

		expect(peer_floor.find_lagging(LAGGING_MANIFEST, [toolkit])).toEqual([])
	})
})

describe('format_failure', () => {
	it('names the dependency with both ranges', () => {
		const message = peer_floor.format_failure([LAGGING_PEER])

		expect(message).toContain(`${LAGGING_NAME}@${LAGGING_RANGE}`)
		expect(message).toContain(`requires ${KIT_RANGE}`)
	})

	it('names the toolkit and the installed version the floor came from', () => {
		expect(peer_floor.format_failure([LAGGING_PEER])).toContain(`${KIT_LABEL} requires`)
	})

	it('says how to fix it', () => {
		expect(peer_floor.format_failure([LAGGING_PEER])).toContain('Raise each `peerDependencies`')
	})
})
