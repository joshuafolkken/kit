## 実機証跡

`pnpm josh test:related scripts/run/ship/run-ship-return-waiter.test.ts scripts/run/ship/run-ship-wait-cli.test.ts`

```text
 ✓ |isolated| scripts/run/ship/run-ship-wait-cli.test.ts (8 tests) 47ms
 ✓ |isolated| scripts/run/ship/run-ship-return-waiter.test.ts (5 tests) 5ms
 Test Files  146 passed (146)
      Tests  5297 passed (5297)
```

`pnpm josh check:related`（origin/main `ef5fc88cf` を取り込んだ木）

```text
=== lint:related: passed ===
=== test:related: passed ===
=== cspell:dot: passed ===
```

## 受け入れ条件の対応

- `ac-87f49ef8` round 1 が止まったとき、実装したセッションが生きていれば、そのセッションに指摘を返す。新しいセッションは起こさない。テストで確かめる — 満たした: `scripts/run/ship/run-ship-return-waiter.test.ts:62` "hands the stop note to the waiting session and relaunches nothing"、待つ側は `scripts/run/ship/run-ship-wait-cli.test.ts:50` "returns the stop the supervisor handed back, and stops waiting"
- `ac-71d1383e` 実装したセッションが終わっていれば、これまでどおり新しいセッションで再開する。テストで確かめる — 満たした: `scripts/run/ship/run-ship-return-waiter.test.ts:77` "relaunches a fresh session where no session took the stop"、`scripts/run/ship/run-ship-wait-cli.test.ts:61` "passes once the ship committed, so a later stop relaunches a fresh session"
- `ac-67cf3b3c` round 1 が clean のときの流れと所要時間は変わらない — 満たした: clean な round は停止しないので `return_control` を通らず、`ship:wait` は `pnpm josh cost --cut` が `under` のときだけ待つ（`scripts/run/ship/run-ship-wait-cli.test.ts:83` "passes once the attempt is past a commit it skipped as already shipped"）。既存の `scripts/run/ship/run-ship-return.test.ts` の relaunch / broker の検証はそのまま通る
