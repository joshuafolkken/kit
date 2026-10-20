## Step 1: Issue 作成テンプレ

タイトルは簡潔で明瞭な英語にする（「出力の言語（`JOSH_SESSION_LANG`）」の例外）。日本語や改善できるタイトルは実装開始前に `pnpm josh issue:plan <N> --body-file <path> --title "<title>"` で計画と一緒に書き換える。本文は次のテンプレートの節をすべて含める:

````md
## 背景

<不具合なら `- 種別: 不具合`、そうでなければ `- 種別: 非不具合` を宣言する>
<不具合なら `- 原因: #<PR>`、追えなければ `- 原因: 不明（<理由>）` を宣言する>
<人の判断が要らなければ `- 人の判断: 不要`、要るなら `- 人の判断: 要（<方針の判断 / 外部アカウント / 目視確認>）` を宣言する>

<なぜ必要か>

## 現象

<現在の問題>

## 期待結果

<どうなれば完了か>

## 受け入れ条件

- [ ] 条件1
- [ ] 条件2

## 発火点

<AI の振る舞いを変える Issue のみ。その規則が破れる瞬間に最初に呼ばれるツールコール名を 1 つだけ書く（例 `Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`）>

## ベースライン

<AI の振る舞いを変える Issue のみ。「コマンド + 値」で書く>

- `<測定コマンド>` → <現在の値>

## 再現

<AI の振る舞いを変える Issue のみ。「コマンド + 実際の出力」で書き、出力はフェンス（``` または ~~~）で囲む>

- `<再現コマンド>`

```
<実際の出力>
```

## 期待効果

<`- 目的: 時間短縮` のみ。出典はコマンドと値>

- 効く率: <値>
- 1 回あたりの得: <値>
- 外れたときの損: <値>
- 出典: <`pnpm josh lane:stats` → 値>

## Origin

<別リポジトリのセッションから起票した場合のみ。起票元 Issue を `owner/repo#N` 形式で書く。自リポジトリ発の Issue では節ごと省略する>
````

### `## 背景` 直下の宣言と分類ラベル

起票は `pnpm josh issue:file "<title>" --body-file <本文ファイル>` で行い、本文の検査（`pnpm josh issue:lint <path>` と同じ）と下表のラベル付与はコマンドが行う。**宣言は起票者が選ぶ。** `- 人の判断:` の行は必須で、`issue:file` が検査し `auto-ok` の判定に使う（`scripts/issue/issue-auto-ok.ts`、`docs/how-to/run-backlog.md`）。`不要` を宣言する起票には `--label run:lane`（kit 自身の検証の不具合なら `run:solo`）も付ける — 無ければ `issue:file` が拒否する。

| 宣言                   | 付くラベル                        | 選ぶ基準                                                   |
| ---------------------- | --------------------------------- | ---------------------------------------------------------- |
| `- 種別: 不具合`       | `bug`                             | 報告された症状を直す（無ければ `- 種別: 非不具合`）        |
| `- 目的: 機能追加`     | `enhancement`                     | 新しい機能。修正・文書・依存更新・保守には書かない         |
| `- 目的: 機能改善`     | `enhancement`                     | 既存機能の改善。目的が曖昧なら受け入れ条件を具体化してから |
| `- 目的: 時間短縮`     | `enhancement`                     | 所要時間を短くする。`## 期待効果` の 4 行が必須            |
| `- 互換性: 破壊的変更` | `breaking-change`                 | 契約を変える。移行措置があっても書き、廃止対象と影響を書く |
| `- 種別: 振る舞い変更` | なし                              | AI の振る舞いを変える。下の 3 見出しが必須                 |
| `- 人の判断: 不要`     | `auto-ok`（除外ラベルが無ければ） | 方針の判断・外部アカウント・目視確認のどれも要らない       |
| `- 実施可能日: <UTC>`  | なし                              | 追跡計測など日時まで着手できない（`YYYY-MM-DDTHH:MMZ`）    |

- **持ち主の意図と違う動きは、コード・コメント・テストに書かれた設計どおりでも `- 種別: 不具合` とする。** 例: コメントとテストに固定されたまま意図より広く働く自動付与、文書だけでも意図と違う分類を生む基準
- `- 種別: 不具合` の回帰テストは、利用者が症状を見たのと同じ粒度で書く。修正前のツリーでも緑になるテストは `pnpm josh git -y` が拒否する（joshuafolkken/kit#2448）
- `bugfix`（PR のリリース分類）を Issue の `bug` の代わりにしない。`enhancement` と `breaking-change` の両方を持つ Issue の PR は `breaking-change` にする
- `## 発火点` の名前は `prompts/collaboration-workflow/rule-delivery.md` の配送表と突き合わされる
- `## ベースライン` の測定コマンドは、マージ後に `pnpm josh measure:rerun <N>` が再実行して before / after を印字する（作者が `OWNER` / `MEMBER` / `COLLABORATOR` の Issue に限る）
- 公開しないと利用側が使えない変更には `--release` を付ける（既存 Issue は `pnpm josh issue:release <N>`、`docs/josh-commands-backlog.md` → `josh issue:release`）

### 起票元へのバックリンク（`## Origin` / `## Upstream issues`）

**別リポジトリのセッションから起票した Issue には、起票元へのリンクを双方向で必ず書く。**

| 方向            | 置き場所               | 固定見出し              | 内容                       |
| --------------- | ---------------------- | ----------------------- | -------------------------- |
| 上流 → 起票元   | 上流 Issue の本文      | `## Origin`             | 起票元 Issue               |
| 起票元 → 上流   | 起票元の本文かコメント | `## Upstream issues`    | 起票した上流 Issue 全件    |
| 起票元 → 未起票 | 起票元の本文かコメント | `## Upstream candidate` | 第三者への報告候補と下書き |

- 見出しは固定する。起票元の本文が確定済みなら、同じ見出しでコメントに書く
- **リンクは必ずリポジトリ修飾する**（`owner/repo#N` または完全 URL）
- チェックボックス行（`- [ ] owner/repo#N`）で書かず、散文か素の箇条書き（`- owner/repo#N`）にする（epic の自動クローズを止めるため）
- third-party への報告はユーザーの明示指示まで起票しない（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- 割り込みで起票する手順は `upstream-interrupt.md`

### 複数 Issue に分割するときの epic Issue

**1 つの要望を 2 件以上の Issue に分割したら、件数や順序の有無にかかわらず常に epic を作る。** 作成は `pnpm josh epic`、点検は `pnpm josh epic:check <E>`、子の追加は `pnpm josh epic --add` で行い、本文を手で編集しない。epic 自体を実装ランに渡さない（`backlogrun #<E> --only` が子を回す）。記法は `epic-commands` スキル →「Creating an epic」。

`josh` が使えない環境での手作業手順:

1. 子 Issue をすべて起票し、番号を控える。`epic` ラベルは `josh sync` が用意する。
2. epic を作り、`id` ではなく **number** を控える: `gh api repos/{owner}/{repo}/issues -f title="<epic-title>" -f 'labels[]=epic' -F body=@<body-file> --jq .number`。本文は次の形にする（順序がなければ `Dependencies` に `None — the children are independent; any execution order works.` と書く）:

   ```md
   ## Split rationale

   <why this split>

   ## Dependencies

   #101 -> #102

   ## Execution

   backlogrun #<E> --only

   ## Progress

   - [ ] #101 <title>
   - [ ] #102 <title>
   ```

3. 順序があるときだけ、別ステップで依存を足す（Issue 番号ではなく database id を渡す。失敗しても止めない）: `gh api repos/{owner}/{repo}/issues/<N2>/dependencies/blocked_by -F issue_id="$(gh api repos/{owner}/{repo}/issues/<N1> --jq .id)"`
