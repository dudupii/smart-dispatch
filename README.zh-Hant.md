# smart-dispatch

> 面向 Claude Code sub-agent 的、品質優先的自動模型路由。
> **每個任務都用對的模型——預設最強，只在確信瑣碎時降級。**

[![tests](https://img.shields.io/github/actions/workflow/status/dudupii/smart-dispatch/test.yml?branch=master&label=tests)](https://github.com/dudupii/smart-dispatch/actions/workflows/test.yml)
[![version](https://img.shields.io/github/v/release/dudupii/smart-dispatch?color=blue)](https://github.com/dudupii/smart-dispatch/releases)
[![license](https://img.shields.io/github/license/dudupii/smart-dispatch?color=green)](./LICENSE)
[![stars](https://img.shields.io/github/stars/dudupii/smart-dispatch?style=social)](https://github.com/dudupii/smart-dispatch/stargazers)

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/demo.gif" alt="smart-dispatch routing demo" width="640"></p>

市面上的「模型路由器」大多為省錢而優化，悄悄在難任務上掉品質。smart-dispatch 反過來：**它絕不會因為路由失誤而掉品質。** 唯一可接受的誤判方向，是把簡單任務當成難任務（多花一點）——絕不反過來。

## 它做什麼

派生 sub-agent 之前，smart-dispatch 會：

1. 用一個**便宜的小模型**（Haiku）給任務分類 → `{tier, confidence}`。
2. 套用**品質優先策略**：預設 `opus`；僅當 `tier ∈ {Trivial, Routine}` 且 `confidence ≥ 0.8` 時才降級。
3. 用選定的模型派生執行 agent。

| Tier | 例子 | 模型 |
|------|------|------|
| Trivial 瑣碎 | grep、列檔案、讀設定 | haiku |
| Routine 常規 | 清晰模式的編輯、總結、格式化 | sonnet |
| Hard 困難 | 設計、除錯、新程式碼、架構 | opus |
| 不確定 | 任何模糊的情況 | opus（兜底） |

路由器自己輸出的 `model` 欄位會被**忽略**——策略只根據 `tier` + `confidence` 重新決定。

## 安裝

```bash
claude plugin marketplace add dudupii/smart-dispatch
claude plugin install smart-dispatch@smart-dispatch
```

安裝後，路由是**自動且透明**的：一個 `PreToolUse` hook 攔截每一次 `Agent` 工具呼叫，通過 `updatedInput` 原地改寫模型——你無需記任何命令，模型也無法通過直接呼叫 Agent 工具繞過它。如果你明確指定了模型，smart-dispatch 會尊重你的選擇並跳過路由。

> hook 用的是保守啟發式（唯讀的 `Explore` 任務，外加一個針對短小唯讀/機械式 `general-purpose` 提示的窄門）。如果降級被證明是錯的，同一任務的下一次派發會**自癒**回會話預設模型——見[可觀測性](#可觀測性)。若想要更高保真度的路由（用 Haiku 分類器），可明確呼叫 `/smart-dispatch`——兩條路共用同一份 `src/decide-model.js` 策略，寫入同一個日誌。設定 `SMART_DISPATCH_DRY=1` 可以只在日誌裡預覽路由決策，絕不改寫任何呼叫。

## 更新

```bash
claude plugin update smart-dispatch
```

**重啟工作階段後生效**（含 hook 變更）。若版本號看起來沒變，先重新整理 marketplace（`claude plugin marketplace update smart-dispatch`）再更新一次。

## 可調參數

調參是**資料，不是改原始碼**。預設值在 `src/decide-model.js`（唯一真相源），可透過 `~/.smart-dispatch/config.json`（路徑可用 `SMART_DISPATCH_CONFIG` 指定）或環境變數覆蓋：

```json
{
  "downgradeThreshold": 0.8,
  "budgetFloor": 0.1,
  "escalation": { "enabled": true, "windowMinutes": 10 },
  "agentOverrides": { "my-file-finder": "haiku", "my-careful-agent": "never" },
  "priceTable": { "haiku": 0.1, "sonnet": 0.3, "opus": 1.0 }
}
```

- **`downgradeThreshold`**（預設 `0.8`，環境變數 `SMART_DISPATCH_THRESHOLD`）——離開 opus 所需的信心度。調高 = 更保守（更接近全 opus）；調低 = 更積極地降級。
- **`budgetFloor`**（預設 `0.1`，環境變數 `SMART_DISPATCH_BUDGET_FLOOR`）——僅在預算模式（Workflow 專業模式 `workflows/batch-route.js`）下生效：當剩餘預算低於此比例時，opus 降為 sonnet。絕不會把已降級的任務再調上去。
- **`escalation`**（一鍵關閉：`SMART_DISPATCH_ESCALATION=0`）——對被降級後又重新派發的任務做自癒的視窗。
- **`agentOverrides`**——按 subagent 類型固定模型（原樣套用，等同使用者覆蓋），或 `"never"` 表示該類型完全不動。
- **路由器模型**——預設 Haiku（在 `eval/run-eval.js` 設定）。若 eval 顯示有誤降級，升級到 Sonnet。

## 驗證

```bash
npm install                       # 僅 dev 依賴（@anthropic-ai/sdk）
npm test                          # 單測：策略、解析器、指標、資料集 schema、插件完整性
ANTHROPIC_API_KEY=xxx npm run eval   # 對 eval/dataset.json 跑真實路由品質評估
```

eval 報告兩個數字：

- **falseDowngradeRate**——Hard 任務被路由到 opus 以下的比率。**紅線：趨近 0。**
- **savingsRate**——相對全 opus 基線的花費節省。目標 0.3–0.5。

## 它怎麼建構的

- `src/decide-model.js`——品質優先策略（唯一真相源，完整單測）。
- `src/classify-heuristic.js`——hook 使用的保守啟發式分類器（唯讀 `Explore` + general-purpose 窄門），由對抗測試把關。
- `hooks/route.mjs` + `hooks/hooks.json`——讓路由自動化的 `PreToolUse` hook。
- `src/config.js`——使用者設定（檔案 + 環境變數），絕不拋錯，非法值自動回退。
- `src/escalation.js`——重試升級：降錯了的下一跳自動自癒。
- `src/parse-router-output.js`——路由器輸出的防禦性解析器。
- `src/compute-metrics.js`——誤降級率 + 節省率指標，帶版本化價格表。
- `skills/smart-dispatch/SKILL.md`——發布的 skill；用文字鏡像策略。
- `.claude-plugin/plugin.json` + `marketplace.json`——插件清單與市集入口。
- `eval/`——標註資料集 + 端到端驗證路由品質的 harness。

發布的插件**零執行期依賴**——Anthropic SDK 僅作 dev 依賴，只被 eval harness 使用。

## 專業模式：批次路由（預算自適應）

`workflows/batch-route.js` 是一個用於批次處理 + 成本控制的 [Workflow](https://docs.claude.com/claude-code/workflows)。它套用相同的品質優先策略，**並加上**預算感知：當剩餘預算低於 `budgetFloor` 時，`opus` 任務降為 `sonnet`（唯一允許的 opus 向下覆蓋）。把單一任務或任務陣列作為 `args` 傳入；它用 Haiku 給每個任務路由，再用選定的模型執行。

> **注意：** workflow 腳本執行在沙箱裡，無法 `import` 本地模組，所以策略在腳本裡**內嵌**了一份（有同步守衛測試把關）。`src/decide-model.js` 仍是唯一真相源。執行它會按任務數派生 sub-agent（多 agent 編排），會消耗 token。

## 可觀測性

每次路由決策都會在對話裡顯示一行（`smart-dispatch → haiku (Trivial, conf 0.92)`），並追加到本機日誌 `~/.smart-dispatch/log.jsonl`——**只記錄 `tier`、`confidence`、`model`、時間戳、subagent 類型、以及任務的單向 `hash`**，絕不記錄任務原文。`Retry` 條目記錄每次自癒的降級（`escalatedFrom`）：同一任務在升級視窗內被重新派發且此前被路由到 opus 以下時，hook 會放棄降級並記錄這次糾正——降錯一次的代價是多跑一跳便宜嘗試，而不是搞壞任務。

隨時查看聚合統計：

```bash
npm run report                    # 或在會話裡用 /smart-dispatch:smart-dispatch-report 命令
npm run report -- --today         # 只看今天
npm run report -- --since 7d      # 最近 7 天（也支援 24h 或 2026-08-01）
npm run report -- --json          # 機器可讀格式
```

它會報告：總決策數、模型/tier/agent 分佈、相對全 opus 的估算節省（標註所用的版本化價格表——估算會註明用的是哪套價格）、預算模式降級頻率、以及自癒重試次數。用 `SMART_DISPATCH_LOG` 覆蓋日誌路徑。

## 授權

MIT。
