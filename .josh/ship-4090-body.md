## 実機証跡

ロックファイルも窓も merge-base から変わっていない状態（何も出さずに 0 で終わる）:

`pnpm josh lockfile:policy`

```
$ tsx scripts/josh/josh.ts lockfile:policy
exit=0
```

`pnpm-workspace.yaml` の `minimumReleaseAge` を一時的に 4500 に上げて実行（確認後に 4320 へ戻した）:

`pnpm josh lockfile:policy`

```
$ tsx scripts/josh/josh.ts lockfile:policy
? Verifying lockfile against supply-chain policies (578 entries)...
✗ Lockfile failed supply-chain policy check (578 entries in 16s)
Error: ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION

  × installing dependencies
  ╰─▶ 1 lockfile entries failed verification:
        node-releases@2.0.59 was published at 2026-10-15T08:10:27.000Z, within
      the minimumReleaseAge cutoff (2026-10-15T06:44:29.512Z)
exit=1
```

## 受け入れ条件の対応

- `ac-3a783651` e4e01a68 で `node-releases@2.0.59` が期間内に解決された経路（`josh latest` の再解決手順、pnpm の `minimumReleaseAge` の適用範囲、`trustLockfile` 等）を特定し、Issue に記録する — 満たした: Issue の「## 調査結果」コメントに記録した。e4e01a68 の時点の窓は 1440 で、`node-releases@2.0.59`（28.9h）は当時の窓を満たしていた。8eb12736（#4023）が窓を 4320 に上げたとき、既存ロックを再検査する段がなかった。`trustLockfile: true` はインストール時の検査も止めていた
- `ac-f9f7e560` 原因が kit 側なら修正し、期間未満の版がロックファイルに入らないことを回帰テストで固定する — 満たした: `josh lockfile:policy` をゲートの `lockfile` チェックにした。テストは `scripts/security/lockfile-policy.test.ts:69` "fails when pnpm finds an entry younger than minimumReleaseAge" と `scripts/gate/gate-plan.test.ts:317`。実機での検出は上の証跡のとおり
- `ac-130ce0f0` 原因が pnpm など第三者側なら、kit 側では期間未満の版を検出して止める仕組みの要否を判断し、上流への報告候補を `## Upstream candidate` として下書きする（第三者トラッカーへの書き込みはしない） — 満たした: 原因は kit 側で、pnpm は仕様どおりに動いていた（`pnpm update` は推移的依存にも窓を適用し、`--config.trust-lockfile=false` の検証は違反を検出した）。上流への報告候補はないので、下書きも置いていない

## レビュー

- 1 回目（medium）: High 0 / Medium 0 / Low 2。Low はどちらも見送った。`execaSync` に timeout がない件は、pnpm の fetch timeout と CI のジョブ timeout で抑えられる。失敗系のテストが exit 1 のモックだけの件は、期間の判定が pnpm の責務で、実機で再現も済んでいる
- metrics の増加（新コマンドとそのテスト、項目の定型見出しの bold）は `.josh/metrics-accepted/4090.json` に記録した

🤖 Generated with [Claude Code](https://claude.com/claude-code)
