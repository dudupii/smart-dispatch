# smart-dispatch

> 面向 Claude Code sub-agent 的、质量优先的自动模型路由。
> **每个任务都用对的模型——默认最强，只在确信琐碎时降级。**

[![tests](https://img.shields.io/github/actions/workflow/status/dudupii/smart-dispatch/test.yml?branch=master&label=tests)](https://github.com/dudupii/smart-dispatch/actions/workflows/test.yml)
[![version](https://img.shields.io/github/v/release/dudupii/smart-dispatch?color=blue)](https://github.com/dudupii/smart-dispatch/releases)
[![license](https://img.shields.io/github/license/dudupii/smart-dispatch?color=green)](./LICENSE)
[![stars](https://img.shields.io/github/stars/dudupii/smart-dispatch?style=social)](https://github.com/dudupii/smart-dispatch/stargazers)

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/demo.gif" alt="smart-dispatch routing demo" width="640"></p>

市面上的「模型路由器」大多为省钱而优化，悄悄在难任务上掉质量。smart-dispatch 反过来：**它绝不会因为路由失误而掉质量。** 唯一可接受的误判方向，是把简单任务当成难任务（多花一点）——绝不反过来。

## 它做什么

派生 sub-agent 之前，smart-dispatch 会：

1. 用一个**便宜的小模型**（Haiku）给任务分类 → `{tier, confidence}`。
2. 套用**质量优先策略**：默认 `opus`；仅当 `tier ∈ {Trivial, Routine}` 且 `confidence ≥ 0.8` 时才降级。
3. 用选定的模型派生执行 agent。

| Tier | 例子 | 模型 |
|------|------|------|
| Trivial 琐碎 | grep、列文件、读配置 | haiku |
| Routine 常规 | 清晰模式的编辑、总结、格式化 | sonnet |
| Hard 困难 | 设计、调试、新代码、架构 | opus |
| 不确定 | 任何模糊的情况 | opus（兜底） |

路由器自己输出的 `model` 字段会被**忽略**——策略只根据 `tier` + `confidence` 重新决定。

## 安装

```bash
claude plugin marketplace add dudupii/smart-dispatch
claude plugin install smart-dispatch@smart-dispatch
```

安装后，路由是**自动且透明**的：一个 `PreToolUse` hook 拦截每一次 `Agent` 工具调用，通过 `updatedInput` 原地改写模型——你无需记任何命令，模型也无法通过直接调用 Agent 工具绕过它。如果你显式指定了模型，smart-dispatch 会尊重你的选择并跳过路由。

> hook 用的是保守启发式（只读的 `Explore` 任务，外加一个针对短小只读/机械式 `general-purpose` 提示的窄门）。如果降级被证明是错的，同一任务的下一次派发会**自愈**回会话默认模型——见[可观测性](#可观测性)。若想要更高保真度的路由（用 Haiku 分类器），可显式调用 `/smart-dispatch`——两条路共用同一份 `src/decide-model.js` 策略，写入同一个日志。设置 `SMART_DISPATCH_DRY=1` 可以只在日志里预览路由决策，绝不改写任何调用。

## 可调参数

调参是**数据，不是改源码**。默认值在 `src/decide-model.js`（唯一真相源），可通过 `~/.smart-dispatch/config.json`（路径可用 `SMART_DISPATCH_CONFIG` 指定）或环境变量覆盖：

```json
{
  "downgradeThreshold": 0.8,
  "budgetFloor": 0.1,
  "escalation": { "enabled": true, "windowMinutes": 10 },
  "agentOverrides": { "my-file-finder": "haiku", "my-careful-agent": "never" },
  "priceTable": { "haiku": 0.1, "sonnet": 0.3, "opus": 1.0 }
}
```

- **`downgradeThreshold`**（默认 `0.8`，环境变量 `SMART_DISPATCH_THRESHOLD`）——离开 opus 所需的置信度。调高 = 更保守（更接近全 opus）；调低 = 更激进地降级。
- **`budgetFloor`**（默认 `0.1`，环境变量 `SMART_DISPATCH_BUDGET_FLOOR`）——仅在预算模式（Workflow 专业模式 `workflows/batch-route.js`）下生效：当剩余预算低于此比例时，opus 降为 sonnet。绝不会把已降级的任务再调上去。
- **`escalation`**（一键关闭：`SMART_DISPATCH_ESCALATION=0`）——对被降级后又重新派发的任务做自愈的窗口。
- **`agentOverrides`**——按 subagent 类型固定模型（原样应用，等同用户覆盖），或 `"never"` 表示该类型完全不动。
- **路由器模型**——默认 Haiku（在 `eval/run-eval.js` 配置）。若 eval 显示有误降级，升级到 Sonnet。

## 验证

```bash
npm install                       # 仅 dev 依赖（@anthropic-ai/sdk）
npm test                          # 单测：策略、解析器、指标、数据集 schema、插件完整性
ANTHROPIC_API_KEY=xxx npm run eval   # 对 eval/dataset.json 跑真实路由质量评估
```

eval 报告两个数字：

- **falseDowngradeRate**——Hard 任务被路由到 opus 以下的比率。**红线：趋近 0。**
- **savingsRate**——相对全 opus 基线的花费节省。目标 0.3–0.5。

## 它怎么构建的

- `src/decide-model.js`——质量优先策略（唯一真相源，完整单测）。
- `src/classify-heuristic.js`——hook 使用的保守启发式分类器（只读 `Explore` + general-purpose 窄门），由对抗测试把关。
- `hooks/route.mjs` + `hooks/hooks.json`——让路由自动化的 `PreToolUse` hook。
- `src/config.js`——用户配置（文件 + 环境变量），绝不抛错，非法值自动回退。
- `src/escalation.js`——重试升级：降错了的下一跳自动自愈。
- `src/parse-router-output.js`——路由器输出的防御性解析器。
- `src/compute-metrics.js`——误降级率 + 节省率指标，带版本化价格表。
- `skills/smart-dispatch/SKILL.md`——发布的 skill；用文字镜像策略。
- `.claude-plugin/plugin.json` + `marketplace.json`——插件清单与市场入口。
- `eval/`——标注数据集 + 端到端验证路由质量的 harness。

发布的插件**零运行时依赖**——Anthropic SDK 仅作 dev 依赖，只被 eval harness 使用。

## 专业模式：批量路由（预算自适应）

`workflows/batch-route.js` 是一个用于批量处理 + 成本控制的 [Workflow](https://docs.claude.com/claude-code/workflows)。它套用相同的质量优先策略，**并增加**预算感知：当剩余预算低于 `BUDGET_FLOOR` 时，`opus` 任务降为 `sonnet`（唯一允许的 opus 向下覆盖）。把单个任务或任务数组作为 `args` 传入；它用 Haiku 给每个任务路由，再用选定的模型执行。

> **注意：** workflow 脚本运行在沙箱里，无法 `import` 本地模块，所以策略在脚本里**内联**了一份（有同步守卫测试 `test/policy-sync.test.js` 把关，漂移即 CI 失败）。`src/decide-model.js` 仍是唯一真相源。运行它会按任务数派生 sub-agent（多 agent 编排），会消耗 token。

## 可观测性

每次路由决策都会在对话里显示一行（`smart-dispatch → haiku (Trivial, conf 0.92)`），并追加到本地日志 `~/.smart-dispatch/log.jsonl`——**只记录 `tier`、`confidence`、`model`、时间戳、subagent 类型、以及任务的单向 `hash`**，绝不记录任务原文。`Retry` 条目记录每次自愈的降级（`escalatedFrom`）：同一任务在升级窗口内被重新派发且此前被路由到 opus 以下时，hook 会放弃降级并记录这次纠正——降错一次的代价是多跑一跳便宜尝试，而不是搞坏任务。

随时查看聚合统计：

```bash
npm run report                    # 或在会话里用 /smart-dispatch-report 命令
npm run report -- --today         # 只看今天
npm run report -- --since 7d      # 最近 7 天（也支持 24h 或 2026-08-01）
npm run report -- --json          # 机器可读格式
```

它会报告：总决策数、模型/tier/agent 分布、相对全 opus 的估算节省（标注所用的版本化价格表——估算会注明用的是哪套价格）、预算模式降级频率、以及自愈重试次数。用 `SMART_DISPATCH_LOG` 覆盖日志路径。

## 许可证

MIT。
