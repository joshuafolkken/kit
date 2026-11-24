import { describe, expect, it } from 'vitest'
import { agent_worker_route } from './agent-worker-route'

const SMALL = '- 規模見積もり: 約 2 ファイル / 40 行（テスト含む）'
const LARGE = '- 規模見積もり: 約 12 ファイル / 400 行（テスト含む）'
const OVER_GUIDE = 'is over the size guide'

function body(...lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 非不具合', '- 目的: 機能改善', '- 人の判断: 不要', ...lines].join(
		'\n',
	)
}

describe('agent_worker_route.route', () => {
	it('routes a small Issue declaring no design change to the light profile', () => {
		expect(agent_worker_route.route(body(SMALL))).toStrictEqual({
			is_light: true,
			reason: 'small and declares no design change',
		})
	})

	it('reads an English body as the Japanese one', () => {
		const english = [
			'## Background',
			'',
			'- Type: non-defect',
			'- Human judgement: not needed',
			'- Size estimate: about 2 files / 40 lines (including tests)',
		].join('\n')

		expect(agent_worker_route.route(english).is_light).toBe(true)
	})
})

describe('agent_worker_route.route — the default kept', () => {
	it.each([
		['a behaviour change', body('- 互換性: 振る舞い変更', SMALL), 'declares 振る舞い変更'],
		['a breaking change', body('- 互換性: 破壊的変更', SMALL), 'declares 破壊的変更'],
		[
			'a person’s judgement',
			body(SMALL).replace('人の判断: 不要', '人の判断: 要'),
			'needs a person',
		],
		['no size estimate', body(), 'declares no size estimate'],
		['a size over the guide', body(LARGE), OVER_GUIDE],
		[
			'a size over the guide kept whole',
			body(LARGE, '- 分割しない理由: 分けられない — one change'),
			OVER_GUIDE,
		],
	])('keeps the default for %s', (_name, text, reason) => {
		expect(agent_worker_route.route(text)).toStrictEqual({ is_light: false, reason })
	})

	it('ignores a declaration outside the Background section', () => {
		const text = `${body(SMALL)}\n\n## 概要\n\n- 互換性: 破壊的変更`

		expect(agent_worker_route.route(text).is_light).toBe(true)
	})
})
