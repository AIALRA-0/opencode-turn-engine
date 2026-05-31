# 09 Turn Inspector Productization Plan

## Original Task

请产品化 Turn Inspector。实现虚拟列表、当前 turn 默认展开、历史 turn 默认折叠、分类过滤、中文摘要、raw 稳定展开、跳到最新、质量面板、所有字段都要补全，不能缺漏，即使是超长的流式内容也需要补齐，零补丁面板、验证反馈面板。所有事件禁止裸 JSON 作为默认展示。

## Human Goal

Turn Inspector，回合检查器，应该像一个用户能读懂的执行报告，而不是一堆日志。

用户要能回答：

```text
现在跑到哪一步了
为什么要审批
为什么被沙箱拒绝
为什么没有改代码
测试为什么失败
这轮到底结束了吗
```

## Product Requirements

### Layout

- current turn expanded by default
- old turns collapsed by default
- virtual list for long history
- no visible “history folded” placeholder box unless useful
- no raw JSON as default

### Filters

- all
- errors
- model
- tools
- files
- commands
- approvals
- sandbox
- network
- executor fallback
- engineering
- quality

### Panels

- terminal status panel
- phase timeline
- tool list
- file activity
- command output
- approval audit
- sandbox capability
- zero patch panel
- verification feedback panel
- patch quality panel
- raw advanced details

## Raw Behavior

Raw expansion must:

- not stay loading forever
- not collapse when new logs arrive
- not auto-scroll user away from raw content
- show error if raw access fails
- audit raw access

## Auto Scroll

Rules:

- if user is at bottom, new event scrolls to bottom
- if user is reading history, do not steal scroll
- show “jump to latest”

## Streaming Content

Long output must:

- stream or chunk
- be truncated in summary
- be expandable in raw
- preserve stdout/stderr order when available

## Tests

UI tests:

- current turn expanded
- previous turn collapsed
- filter works
- raw loads
- raw failure shows readable error
- auto-scroll only when at bottom
- long list remains responsive
- zero patch panel appears
- verification feedback panel appears

Data tests:

- missing optional fields do not crash UI
- unknown event type displays fallback label

## Milestones

1. Event label map completeness
2. Virtual list
3. Current/history turn grouping
4. Filter redesign
5. Raw loading fix and stability
6. Quality panels
7. Tests

## Done Means

A user can debug a failed turn without opening backend logs.
