# smart-dispatch

> 面向 Claude Code sub-agent 的、质量优先的自动模型路由。
> **每个任务都用对的模型——默认最强，只在确信琐碎时降级。**

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

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

skill 会在你即将派生 sub-agent 时自动生效（常驻约 70 token；每次触发约 520 token）。如果你显式指定了模型，smart-dispatch 会尊重你的选择并跳过路由。

## 可调参数

都位于 `src/decide-model.js`（唯一真相源；`skills/smart-dispatch/SKILL.md` 的文字与之镜像）：

- **`DOWNGRADE_THRESHOLD`**（默认 `0.8`）——离开 opus 所需的置信度。调高 = 更保守（更接近全 opus）；调低 = 更激进地降级。
- **`BUDGET_FLOOR`**（默认 `0.1`）——仅在预算模式（Workflow 专业模式 `workflows/batch-route.js`）下生效：当剩余预算低于此比例时，opus 降为 sonnet。绝不会把已降级的任务再调上去。
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
- `src/parse-router-output.js`——路由器输出的防御性解析器。
- `src/compute-metrics.js`——误降级率 + 节省率指标。
- `skills/smart-dispatch/SKILL.md`——发布的 skill；用文字镜像策略。
- `.claude-plugin/plugin.json` + `marketplace.json`——插件清单与市场入口。
- `eval/`——标注数据集 + 端到端验证路由质量的 harness。

发布的插件**零运行时依赖**——Anthropic SDK 仅作 dev 依赖，只被 eval harness 使用。

## 专业模式：批量路由（预算自适应）

`workflows/batch-route.js` 是一个用于批量处理 + 成本控制的 [Workflow](https://docs.claude.com/claude-code/workflows)。它套用相同的质量优先策略，**并增加**预算感知：当剩余预算低于 `BUDGET_FLOOR` 时，`opus` 任务降为 `sonnet`（唯一允许的 opus 向下覆盖）。把单个任务或任务数组作为 `args` 传入；它用 Haiku 给每个任务路由，再用选定的模型执行。

> **注意：** workflow 脚本运行在沙箱里，无法 `import` 本地模块，所以策略在脚本里**内联**了一份。`src/decide-model.js` 仍是唯一真相源——请保持同步。运行它会按任务数派生 sub-agent（多 agent 编排），会消耗 token。

## 许可证

MIT。
