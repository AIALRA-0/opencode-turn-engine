# 06 Linux Sandbox Parity Plan

## Original Task

请按 Codex Linux sandbox 源码实现 AIALRA Linux 沙箱差距补齐。对齐 codex-linux-sandbox helper、bwrap 参数、network on/off、protected-create、Landlock enforce PoC、seccomp/no_new_privs。输出逐项差距矩阵、自动化测试和线上 capability event。

## Human Goal

沙箱不能只是“我们感觉隔离了”。

用户要知道：

```text
当前 Linux 内核支持什么
当前容器允许什么
当前 bash 实际用了什么隔离
网络到底开没开
文件到底靠什么拦
```

## Current Baseline

AIALRA already has bwrap-based Linux sandbox behavior.

Known gaps to close:

- Codex helper parity not complete
- Landlock not main enforce path
- seccomp/no_new_privs parity not complete
- protected-create coverage needs audit
- capability reporting must be more exact

## Codex Concepts To Align

- `codex-linux-sandbox helper`，Codex Linux 沙箱辅助程序
- `bwrap`，bubblewrap 文件系统和命名空间隔离
- `Landlock`，Linux 内核文件访问限制
- `seccomp`，系统调用过滤
- `no_new_privs`，禁止进程获得新权限
- network on/off，网络命名空间隔离

## Capability Probe

Probe must record:

- kernel version
- bwrap exists
- bwrap supports required flags
- unprivileged user namespace available
- Landlock ABI version
- Landlock LSM enabled or unavailable
- seccomp availability
- no_new_privs availability
- container limitations
- actual enforce PoC result

## Capability Event

Emit:

- `tool.sandbox.capability`

Readable summary:

```text
本轮 bash 使用 Linux bwrap 沙箱，网络关闭，工作区可写，系统根目录只读，Landlock 未启用，原因是当前容器未开放所需能力
```

## Tests

- network off blocks curl DNS or connection
- network on permits curl to known URL when allowed
- root FS read-only blocks outside write
- workspace write succeeds
- protected path write fails
- protected-create fails
- bwrap missing falls back only if policy allows
- Landlock probe reports exact supported/blocked reason

## Milestones

1. Compare current bwrap args against Codex source
2. Add capability probe output
3. Add network on/off verification
4. Add protected-create tests
5. Implement Landlock enforce PoC if possible
6. Add seccomp/no_new_privs checks
7. Emit capability events
8. Update gap matrix

## Done Means

The sandbox report must not say vague things like “likely supported”.

It must say:

```text
supported and enforced
supported but blocked by container
not supported by kernel
not implemented in AIALRA yet
```
