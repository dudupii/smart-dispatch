# smart-dispatch

> Claude Code サブエージェント向けの、品質優先の自動モデルルーティング。
> **すべてのタスクに正しいモデルを——デフォルトは最強、確信を持って些細な場合のみダウングレード。**

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

世の中の「モデルルーター」の多くはコスト最適化のために、難しいタスクの品質をこっそり落とします。smart-dispatch は逆です：**ルーティングの失敗で品質を落とすことは絶対にありません。** 許容される誤判断は「簡単なタスクを難しいと扱う」方向（少しだけ無駄遣い）だけです——その逆は絶対にありません。

## 何をするか

サブエージェントをディスパッチする前に、smart-dispatch は：

1. **安いモデル**（Haiku）でタスクを分類し、`{tier, confidence}` を得ます。
2. **品質優先ポリシー**を適用します。デフォルトは `opus`。`tier ∈ {Trivial, Routine}` かつ `confidence ≥ 0.8` の場合のみダウングレードします。
3. 選ばれたモデルでワーカーをディスパッチします。

| Tier | 例 | モデル |
|------|------|------|
| Trivial（些細） | grep、ファイル一覧、設定読み込み、文字列検索 | haiku |
| Routine（定型） | 明確なパターンの編集、要約、フォーマット、テンプレ適用 | sonnet |
| Hard（困難） | 推論、設計、デバッグ、複数ファイル、新規コード、アーキテクチャ | opus |
| 不確実 | 曖昧なものすべて | opus（フォールバック） |

ルーター自身が出力する `model` フィールドは**無視されます**——ポリシーは `tier` + `confidence` だけで選択を再決定します。

## インストール

```bash
claude plugin marketplace add dudupii/smart-dispatch
claude plugin install smart-dispatch@smart-dispatch
```

サブエージェントをディスパッチしようとすると自動的にスキルが働きます（常時約 70 トークン、起動ごとに約 520 トークン）。モデルを明示的に指定すれば、smart-dispatch はそれを尊重しルーティングをスキップします。

## チューニングノブ

どちらも `src/decide-model.js` にあります（唯一の信頼できる情報源。`skills/smart-dispatch/SKILL.md` が文章でミラーしています）：

- **`DOWNGRADE_THRESHOLD`**（デフォルト `0.8`）—— opus から離れるために必要な信頼度。上げる = より保守的（ほぼ全 opus）、下げる = より積極的にダウングレード。
- **`BUDGET_FLOOR`**（デフォルト `0.1`）—— 予算モード（Workflow プロモード `workflows/batch-route.js`）でのみ意味を持ちます。残り予算がこの割合を下回ると、opus が sonnet に下がります。すでにダウングレード済みのタスクを昇格させることはありません。
- **ルーターモデル** —— デフォルトは Haiku（`eval/run-eval.js` で設定）。eval で誤ダウングレードが見られれば Sonnet に引き上げます。

## 検証

```bash
npm install                       # 開発依存関係のみ（@anthropic-ai/sdk）
npm test                          # ユニットテスト：ポリシー、パーサー、メトリクス、データセットスキーマ、プラグイン整合性
ANTHROPIC_API_KEY=xxx npm run eval   # eval/dataset.json で実際のルーティング品質評価
```

eval は 2 つの数字を報告します：

- **falseDowngradeRate** —— Hard タスクが opus 未満にルーティングされた割合。**レッドライン：ほぼ 0。**
- **savingsRate** —— 全 opus ベースラインに対する支出削減率。目標 0.3–0.5。

## どう構築されているか

- `src/decide-model.js` —— 品質優先ポリシー（唯一の信頼できる情報源、完全ユニットテスト済み）。
- `src/parse-router-output.js` —— ルーターエージェント出力の防御的パーサー。
- `src/compute-metrics.js` —— 誤ダウングレード率 + 削減率メトリクス。
- `skills/smart-dispatch/SKILL.md` —— 同梱のスキル。ポリシーを文章でミラー。
- `.claude-plugin/plugin.json` + `marketplace.json` —— プラグインマニフェストとマーケットプレースエントリ。
- `eval/` —— ラベル付きデータセット + ルーティング品質をエンドツーエンドで検証するハーネス。

同梱プラグインは**ランタイム依存関係ゼロ**です。Anthropic SDK は開発専用で、eval ハーネスのみが使用します。

## プロモード：バッチルーティング（予算適応型）

`workflows/batch-route.js` は、バッチ処理とコスト制御のための [Workflow](https://docs.claude.com/claude-code/workflows) です。同じ品質優先ポリシーを適用しつつ、**予算認識**を追加します。残り予算が `BUDGET_FLOOR` を下回ると、`opus` タスクが `sonnet` に下がります（許容される唯一の opus の下方上書き）。タスク 1 つ、またはタスクの配列を `args` に渡してください。Haiku で各タスクをルーティングし、選ばれたモデルで実行します。

> **注意：** ワークフロースクリプトはサンドボックスで動作しローカルモジュールを `import` できないため、ポリシーはスクリプト内に**インライン**で複製されています。`src/decide-model.js` が唯一の信頼できる情報源です——同期を保ってください。実行するとタスクごとにサブエージェントをスポーンするため（マルチエージェントオーケストレーション）、トークンを消費します。

## オブザーバビリティ

毎回のルーティング決定はインラインで 1 行表示され（`smart-dispatch → haiku (Trivial, conf 0.92)`）、ローカルログ `~/.smart-dispatch/log.jsonl` に追記されます——**記録されるのは `tier`、`confidence`、`model`、タイムスタンプだけで、タスク本文は一切記録されません**。

集計統計はいつでも確認できます：

```bash
npm run report        # またはセッション内で /smart-dispatch-report コマンド
```

総決定数、モデル分布、全 opus 基準の推定節約率、予算モードで opus が downgrade された頻度を報告します。ログパスは `SMART_DISPATCH_LOG` で上書きできます。

## ライセンス

MIT。
