## Overview

1. Issue を作成する
2. Issue を元に実装提案を作る
3. 計画コメントを Issue に残して Telegram 通知を送る
4. 実装を進める
5. 実装完了後に Issue へ完了コメントを投稿する

### フェーズ分離

ワークフローは 2 つのフェーズに分けて実行できる。

- **Planning phase（`kickoff`）**: Step 1〜3 — Issue 作成・計画投稿・Telegram 通知で止まる。実装前にレビューや承認を挟みたい場合に使う。
- **Execution phase（`fullrun #N`）**: Step 4〜5 — 既存 Issue の計画に基づいて実装・PR 作成・完了通知を行う。

一括実行する場合は `fullrun new` で Step 1〜5 を通しで実行する。

### 手順の置き場所（常時ロードとオンデマンドの分離）

`kickoff` / `fullrun` / `halfrun` / `queue` / `epicrun` の**操作手順**は、常時ロードされる `CLAUDE.md` からは外され、`.claude/skills/workflow-commands/` に置かれている（joshuafolkken/kit#854）。`CLAUDE.md` に残るのはキーワードとスキルへの導線、およびスキルが読み込まれていない状態でも効く必要のある規則だけである。依存更新後の overrides / `devEngines` 検証手順も同様に `.claude/skills/dependency-update/` へ移した。**どの規則が「残す」側かは →「常駐ドキュメントと skill の分担（何を常駐に残すか）」が判定基準と全 4 件を定義する。**

このドキュメントは引き続き**正典の詳細版**であり、スキルは操作手順である。両者は一致していなければならないので、片方だけを更新してはならない。

### 出力の言語（`JOSH_SESSION_LANG`）

ワークフローの出力言語は、環境変数 `JOSH_SESSION_LANG`（例: `ja` / `en`）で決まる。対象は「開発者との対話」と「成果物の散文」の**両方**であり、変数が未設定のときのフォールバックだけが異なる。

- **対話は `JOSH_SESSION_LANG` に従う**: セッション中の説明・質問、および `halfrun` などで提示する **`AskUserQuestion` の選択肢ラベル・説明**。未設定の場合は、ユーザーが書いている言語に合わせる。
- **成果物の散文も `JOSH_SESSION_LANG` に従う**: Issue 本文、Issue／PR コメント（Step 3 の計画コメント、`pnpm josh followup` が自動投稿する完了コメントを含む）、Telegram 通知の本文（`--body` / `--notify-message`）。**未設定の場合は `ja` を既定とする。** 対話と違い、成果物にはその場で言語を推測できる相手がいない — セッションが終わったあとに読まれるものなので、推測ではなく決め打ちの既定値が要る。
- **設定に関わらず英語で固定するもの**（3 つ）:
  1. **Issue／PR タイトル**: Step 1 のタイトル正規化ルールは変更しない。Issue 一覧の見通しを保ち、`pnpm josh git` が作るブランチ名を ASCII に保つため。
  2. **コード内コメント、テストタイトル（`describe` / `it` / `expect`）、コミットメッセージ**: リポジトリのコード規約であり、開発者個人の言語設定とは別の軸で決まる。
  3. **スクリプトが出力する固定文字列**: Telegram のヘッダーラベル（`Planning` / `Completion` など）、`Issue:` / `PR:` の URL ラベル、`--notify-message` 省略時の既定メッセージ。AI が書く文面ではなく、翻訳の仕組みも持たない。

`JOSH_SESSION_LANG` は **開発者個人の設定**であり、`.env`（gitignore 済み・非コミット）に置く。リポジトリ共有の設定ではないため、consumer ごと・開発者ごとに自由に変えてよい。`josh sync` で上書きされることもない。この変数はスクリプトの動作を一切変えない（どのスクリプトもこの変数を読まない）。制御するのは AI が書く文面の言語だけである。
