import { describe, expect, it } from 'vitest'
import { ui_shot, type ShotSources, type ToolkitProbe } from './ui-shot'

const ROUTES: ReadonlyArray<string> = ['/', '/blog']
const JOSH_APP = 'josh-app'
const JOSH_GAME = 'josh-game'
const APP_PATH = '/bin/josh-app'
const GAME_PATH = '/bin/josh-game'
const APP_CANDIDATE = 'pnpm josh-app shot'
const SCRIPT_CANDIDATE = 'pnpm run shot'
const SHOT_ARGS: ReadonlyArray<string> = ['shot', ...ROUTES]

function sources_of(
	probes: Partial<Record<string, ToolkitProbe>>,
	scripts: ReadonlyArray<string> = [],
): ShotSources {
	return {
		toolkit_bins: [JOSH_APP, JOSH_GAME],
		probe_toolkit: async (bin_name) => probes[bin_name],
		scripts,
	}
}

describe('ui_shot.resolve_shot_command — toolkits', () => {
	it('runs the first toolkit whose usage line lists shot, with the routes appended', async () => {
		const sources = sources_of({
			[JOSH_APP]: { path: APP_PATH, commands: ['check', 'shot'] },
			[JOSH_GAME]: { path: GAME_PATH, commands: ['shot'] },
		})

		expect(await ui_shot.resolve_shot_command(sources, ROUTES)).toStrictEqual({
			kind: 'found',
			command: { file: APP_PATH, args: SHOT_ARGS },
		})
	})

	it('skips an installed toolkit that has no shot command', async () => {
		const sources = sources_of({
			[JOSH_APP]: { path: APP_PATH, commands: ['check'] },
			[JOSH_GAME]: { path: GAME_PATH, commands: ['shot'] },
		})

		expect(await ui_shot.resolve_shot_command(sources, ROUTES)).toStrictEqual({
			kind: 'found',
			command: { file: GAME_PATH, args: SHOT_ARGS },
		})
	})
})

describe('ui_shot.resolve_shot_command — scripts and none', () => {
	it('falls back to a package.json script in the documented order', async () => {
		const sources = sources_of({}, ['verify:ui', 'screenshot'])

		expect(await ui_shot.resolve_shot_command(sources, ROUTES)).toStrictEqual({
			kind: 'found',
			command: { file: 'pnpm', args: ['run', 'screenshot', ...ROUTES] },
		})
	})

	it('answers missing with every candidate tried when nothing resolves', async () => {
		const sources = sources_of({ [JOSH_APP]: { path: APP_PATH, commands: ['check'] } }, ['test'])

		expect(await ui_shot.resolve_shot_command(sources, ROUTES)).toStrictEqual({
			kind: 'missing',
			tried: [
				APP_CANDIDATE,
				'pnpm josh-game shot',
				SCRIPT_CANDIDATE,
				'pnpm run screenshot',
				'pnpm run verify:ui',
			],
		})
	})
})

describe('ui_shot.describe_missing', () => {
	it('lists each candidate on its own line under the header', () => {
		expect(ui_shot.describe_missing([APP_CANDIDATE, SCRIPT_CANDIDATE])).toBe(
			[
				'ui:shot: no screenshot command in this project — tried:',
				`  ${APP_CANDIDATE}`,
				`  ${SCRIPT_CANDIDATE}`,
			].join('\n'),
		)
	})
})
