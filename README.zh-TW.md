# smart-dispatch

> 針對 Claude Code 子代理（sub-agent）的、品質優先的自動模型路由。
> **每個任務都用對的模型——預設最強，只在確信瑣碎時降級。**

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

市面上多數的「模型路由器」為了省錢而最佳化，悄悄在困難任務上犧牲品質。smart-dispatch 反其道而行：**它絕不會因為路由失誤而犧牲品質。** 唯一可接受的誤判方向，是把簡單任務當成困難任務（多花一點）——絕不反向為之。

## 它做什麼

在派生子代理之前，smart-dispatch 會：

1. 用一個**便宜的小模型**（Haiku）為任務分類 → `{tier, confidence}`。
2. 套用**品質優先策略**：預設 `opus`；僅當 `tier ∈ {Trivial, Routine}` 且 `confidence ≥ 0.8` 時才降級。
3. 用選定的模型派生執行代理。

| Tier | 例子 | 模型 |
|------|------|------|
| Trivial（瑣碎） | grep、列出檔案、讀取設定、字串查找 | haiku |
| Routine（例行） | 明確模式的編輯、摘要、格式化、套用範本 | sonnet |
| Hard（困難） | 推理、設計、除錯、多檔案邏輯、新程式碼、架構 | opus |
| 不確定 | 任何模糊的情況 | opus（兜底） |

路由器自己輸出的 `model` 欄位會被**忽略**——策略只根據 `tier` + `confidence` 重新決定。

## 安裝

```bash
claude plugin marketplace add dudupii/smart-dispatch
claude plugin install smart-dispatch@smart-dispatch
```

當你即將派生子代理時，skill 會自動生效（常駐約 70 token；每次觸發約 520 token）。如果你明確指定了模型，smart-dispatch 會尊重你的選擇並跳過路由。

## 可調參數

都位於 `src/decide-model.js`（唯一真相源；`skills/smart-dispatch/SKILL.md` 的文字與之鏡像）：

- **`DOWNGRADE_THRESHOLD`**（預設 `0.8`）——離開 opus 所需的信心度。調高 = 更保守（更接近全 opus）；調低 = 更積極地降級。
- **`BUDGET_FLOOR`**（預設 `0.1`）——僅在預算模式（Workflow 專業模式 `workflows/batch-route.js`）下生效：當剩餘預算低於此比例時，opus 降為 sonnet。絕不會把已降級的任務再調上去。
- **路由器模型**——預設 Haiku（在 `eval/run-eval.js` 設定）。若 eval 顯示有誤降級，升級到 Sonnet。

## 驗證

```bash
npm install                       # 僅開發依賴（@anthropic-ai/sdk）
npm test                          # 單元測試：策略、解析器、指標、資料集 schema、插件完整性
ANTHROPIC_API_KEY=xxx npm run eval   # 對 eval/dataset.json 跑真實路由品質評估
```

eval 報告兩個數字：

- **falseDowngradeRate**——Hard 任務被路由到 opus 以下的比率。**紅線：趨近 0。**
- **savingsRate**——相對全 opus 基準的花費節省。目標 0.3–0.5。

## 它怎麼建構的

- `src/decide-model.js`——品質優先策略（唯一真相源，完整單元測試）。
- `src/parse-router-output.js`——路由器輸出的防禦性解析器。
- `src/compute-metrics.js`——誤降級率 + 節省率指標。
- `skills/smart-dispatch/SKILL.md`——發布的 skill；用文字鏡像策略。
- `.claude-plugin/plugin.json` + `marketplace.json`——插件清單與市集入口。
- `eval/`——標註資料集 + 端到端驗證路由品質的 harness。

發布的插件**零執行期依賴**——Anthropic SDK 僅作開發依賴，只被 eval harness 使用。

## 專業模式：批次路由（預算自適應）

`workflows/batch-route.js` 是一個用於批次處理 + 成本控制的 [Workflow](https://docs.claude.com/claude-code/workflows)。它套用相同的品質優先策略，**並加上**預算感知：當剩餘預算低於 `BUDGET_FLOOR` 時，`opus` 任務降為 `sonnet`（唯一允許的 opus 向下覆蓋）。把單一任務或任務陣列作為 `args` 傳入；它用 Haiku 為每個任務路由，再用選定的模型執行。

> **注意：** workflow 腳本執行於沙箱中，無法 `import` 本地模組，所以策略在腳本裡**內嵌**了一份。`src/decide-model.js` 仍是唯一真相源——請保持同步。執行它會依任務數派生子代理（多代理編排），會消耗 token。

## 授權

MIT。
