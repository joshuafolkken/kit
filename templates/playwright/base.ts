import { defineConfig, devices } from '@playwright/test'

// 環境判定と設定値の定数化
const isCI = Boolean(process.env['CI'])
// const isStaging = Boolean(process.env['STAGING']) // 将来の拡張用

const DEV_PORT = 5173
const PREVIEW_PORT = 4173
const CI_TIMEOUT = 15_000
const LOCAL_TIMEOUT = 25_000
const TEST_TIMEOUT = 10_000
const EXPECT_TIMEOUT = 5000
const ACTION_TIMEOUT = 5000
const NAVIGATION_TIMEOUT = 10_000

// 環境に応じた設定を関数化
const getWebServerConfig = () => {
	if (isCI) {
		return {
			command: 'pnpm run preview',
			port: PREVIEW_PORT,
			timeout: CI_TIMEOUT,
			reuseExistingServer: false,
		}
	}

	// 将来的に staging 環境を追加する場合
	// if (isStaging) { ... }
	return {
		command: 'pnpm run dev',
		port: DEV_PORT,
		timeout: LOCAL_TIMEOUT,
		reuseExistingServer: true,
	}
}

export default defineConfig({
	webServer: getWebServerConfig(),
	testDir: 'e2e',
	fullyParallel: true,
	// 並列実行数を最適化（CPU コア数に応じて自動調整、CI では明示的に設定）
	...(isCI ? { workers: 2 } : {}),
	// リトライ設定（CI でのみ有効、ローカルでは即座に失敗を確認）
	retries: isCI ? 2 : 0,
	// タイムアウト設定を最適化
	timeout: TEST_TIMEOUT,
	expect: {
		timeout: EXPECT_TIMEOUT,
	},
	// 必要なブラウザのみ実行
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// パフォーマンス向上のための設定
				viewport: { width: 1280, height: 720 },
				// ブラウザの起動を高速化
				launchOptions: {
					args: [
						'--disable-dev-shm-usage',
						'--disable-gpu',
						// --no-sandbox は CI 環境でのみ使用（セキュリティ上の理由）
						...(isCI ? ['--no-sandbox'] : []),
					],
				},
			},
		},
	],
	// レポート設定
	reporter: isCI ? [['html'], ['github']] : [['html'], ['list']],
	// グローバル設定
	use: {
		// アクションのタイムアウト
		actionTimeout: ACTION_TIMEOUT,
		// ナビゲーションのタイムアウト
		navigationTimeout: NAVIGATION_TIMEOUT,
		// スクリーンショットは失敗時のみ（CI でのみ）
		screenshot: isCI ? 'only-on-failure' : 'off',
		// ビデオは失敗時のみ（CI でのみ）
		video: isCI ? 'retain-on-failure' : 'off',
		// トレースは失敗時のみ（CI でのみ）
		trace: isCI ? 'retain-on-failure' : 'off',
	},
})
