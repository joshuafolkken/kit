closes #4292

## 概要

run:board の running / processes / done 行を #4288 の待ち理由の列配置に揃えた。

- running 行: 進行列（スピナー / 🚧 / 空白）・フェーズアイコン・フェーズ経過・全体経過（保留中は 💪 / 🧠 と保留時間）・CPU / MEM / CMPRS・Issue 番号・タイトル。右端はチェック名・最新の操作だけ
- CPU 列の開始位置を lanes と processes で共有する固定値にした
- 字下げ: lanes 2、processes グループ 4・明細 6、queued / waiting / done 4
- done 行: 状態アイコン・`MM-DD HH:MM`・Issue 番号。🔚 を外した
- このランが終わらせないブロッカー待ちの行は 🙋 で始まり、盤面の ❗ 通知行は出さない
- 凡例に ⏰ / 🙋 / 💪・🧠 を足し、🔚 を外した

レビュー指摘の対応: 実行中の Issue をブロッカーに持つ行が 🙋 になる誤りを修正（`numbers_of` で running を含める）、理由に tail しかない done 行の終了時刻の欠落を修正。保留時間が 10 分以上・経過が 10 時間以上で 8 文字幅を 1 文字はみ出す件は low として見送り。

## 受け入れ条件の対応

- `ac-06d7bc88` running 行が期待結果の並びで描かれ、1 行に同じアイコンが 2 回出ない — 満たした: `run-board-render-align.test.ts` 'draws each lane row’s phase or state icon exactly once'
- `ac-228569e6` 保留中の running 行は進行列に 🚧、それ以外はスピナーか空白で、どちらでも後ろの列がずれない — 満たした: `run-board-render-lead.test.ts` 'draws 🚧 in the progress column and the hold in the run time’s column while held' / 'blanks the progress column of a stopped row' / `run-board-render-align.test.ts` 'starts the elapsed and the number columns in one column on a running, a held and a stopped row'
- `ac-85499f14` 保留中の running 行は全体経過の列に保留理由のアイコン（💪 / 🧠）と保留時間が出て、その桁が他の行の全体経過と揃い、右端にはチェック名だけが残る — 満たした: `run-board-render-waits.test.ts` 'right-aligns the time so the reason and the time fill the column' / 'leads the row with 🚧, keeps the phase’s icon, holds the elapsed column and ends on the check'
- `ac-0c78a7d2` lanes と processes の CPU / MEM / CMPRS の桁位置が同じで、processes の名前が変わってもずれない — 満たした: `run-board-render-processes.test.ts` 'indents groups by 4 and parts by 6, and starts the cells at USAGE_START' / `run-board-render-lead.test.ts` 'ends every lead where the usage cells start less one blank'
- `ac-a659ad94` 字下げが決定事項どおりになる（lanes 2、processes グループ 4・明細 6、queued / waiting / done 4） — 満たした: `run-board-render-processes.test.ts` 'indents groups by 4 and parts by 6, and starts the cells at USAGE_START'、下の実機証跡
- `ac-7bc6a003` done 行が「状態アイコン・`MM-DD HH:MM`・Issue 番号」の順で、右端に 🔚 が出ない — 満たした: `run-board-render-align.test.ts` 'reads a done row as its state icon, its end time and its number, with no finish mark'
- `ac-4f7cfe79` このランが終わらせないブロッカーを待つ行の行頭が 🙋 になり、盤面に ❗ 通知行が出ない — 満たした: `run-board-reason.test.ts` 'leads a row with 🙋 where a blocker is outside the plan, which the run will not finish' / `run-board-plan-quiet.test.ts` 'mutes the withheld-blocker notice before it classifies'
- `ac-167da386` 凡例に ⏰ と 🙋 が出て、保留中の行があるときは 💪 / 🧠 の保留理由も出て、🔚 が出ない — 満たした: `run-board-render-legend.test.ts` 'names the held check and its reasons after 🔗, only where the frame draws them' / `run-board-render-legend-bare.test.ts`（`⏰ elapsed`）、下の実機証跡の凡例行
- `ac-c9a3ad61` 行描画・processes・凡例の単体テストが上の各形を固定する — 満たした: `pnpm josh gate` の test:unit（上記テスト群）
- `ac-47bb7d7e` ライブのランで `pnpm josh run:board` の出力が期待結果の形になる — 満たした: 下の実機証跡

## 実機証跡

`pnpm josh run:board --chat`

```
── ⏳ queued ──────────────────────────────────────
    🧍 4292+2      4287 🐛 Refuse a merge that deletes tests without …  4300, 4270
    🙅 4287        4243 🐛 Keep the hook bundle's inputs-verified cache ou…
    🔗 4212        4213 ✨ Move main guards out of imported modules in bui…

── 🔗 waiting ────────────────────────────────────
    🙋 4183        4180 🐛 Route helper bypasses for labels, atomic writes…
    📅 10-21 16:45 4095    Measure the gate's lint and metrics check times…

── ✅ done ────────────────────────────────────────
    ✅ 10-20 19:09 4269 🐛 Draw run:board lanes from the lane state record…  1°32′38″
    ✅ 10-20 18:03 4294 ✨ Show run:solo waits on run:board queued rows wi…  1°13′15″

📝 plan  🔨 implement  🔧 operation  ⏰ elapsed  🏁 estimated finish  ✨ feature  🐛 fix  🧍 runs alone  🙅 behind solo  🔗 waits on  🙋 needs a person  📅 not before
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
