# AIALRA 真实高难 Benchmark 1 组合报告

- 运行 ID：`202605311822-astropy-repair-verifyfix`
- manifest：`/srv/aialra/apps/opencode-turn-engine/aialra/turn-observability/benchmark-cases/latest.json`
- 运行目录：`/srv/aialra/turn-harness-target/real-bench-runs/202605311822-astropy-repair-verifyfix`
- 测评组合数：`1`
- 测评层级：`full-24`
- 并发度：`1`
- 验证模式：`hybrid`
- 自动 repair 轮数：`1`
- 自动 repair 目标：`aialra-deepseek-v4-pro-max, aialra-kimicode-max`
- 超时判定：`progress-aware/logical-stall-detection`
- 说明：agent 只收到 problem statement，未收到 gold patch 或 test_patch

## 模型与推理档位

| 对象 | 模型 / 档位 |
| --- | --- |
| AIALRA OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` |

## 总览

| 对象 | 模型 / 档位 | 总分 | 补丁质量均分 | 完成 | 有 patch | 零补丁 | 验证通过 | 超时 | 等待审批 | turn 终态 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AIALRA OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` | 11 | 50 | 1/1 | 1/1 | 0/1 | 0/1 | 0 | 0 | 1/1 |

## astropy__astropy-13398

- 数据集：`swe-bench-verified`
- 仓库：`astropy/astropy`
- base commit：`6500928dc0e57be8f06d1162eacc3ba5e2eff692`
- 估算 token：`4750`
- F2P/P2P：`4/68`

| 对象 | 模型 / 档位 | 分数 | 补丁质量 | 完成 | patch | 验证模式 | 验证通过 | repair | 测试补丁 | 超时 | 停止原因 | 等待审批 | 工具调用 | 耗时 |
| --- | --- | ---: | ---: | --- | ---: | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: |
| AIALRA OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` | 11 | 50 | 是 | 582 B | official | 否 | 1 | - | 否 | - | 否 | 44 | 556083 ms |

<details><summary>AIALRA OpenCode / DeepSeek V4 Pro max 详情</summary>

输出摘要：
```text
(无输出)
```

改动摘要：
```text
astropy/coordinates/builtin_frames/__init__.py | 1 +
 1 file changed, 1 insertion(+)
```

补丁质量：
```text
验证未通过 +0
存在非空补丁 +15
改动文件看起来和源码相关 +15
未包含测试文件 +0
补丁大小合理 +10
未发现明显生成物或锁文件噪声 +5
终态干净 +5
无 repair 成功加分 +0
```

自动 repair 记录：
```json
[
  {
    "round": 1,
    "beforePassed": false,
    "repairOk": true,
    "repairTimedOut": false,
    "repairWaitingApproval": false,
    "repairWaitingQuestion": false,
    "repairDurationMs": 15039,
    "repairToolCallCount": 44
  }
]
```

验证输出：
```text
Running 1 instances...
All instances run.
Cleaning cached images...
Removed 0 images.
Total instances: 1
Instances submitted: 1
Instances completed: 1
Instances incomplete: 0
Instances resolved: 0
Instances unresolved: 1
Instances with empty patches: 0
Instances with errors: 0
Unstopped containers: 0
Unremoved images: 0
Report written to aialra-deepseek-v4-pro-max-astropy__astropy-13398.202605311822-astropy-repair-verifyfix-aialra-deepseek-v4-pro-max-astropy__astropy-13398-repair-1.json

<frozen runpy>:128: RuntimeWarning: 'swebench.harness.run_evaluation' found in sys.modules after import of package 'swebench.harness', but prior to execution of 'swebench.harness.run_evaluation'; this may result in unpredictable behaviour
2026-05-31 21:09:16,946 - httpx - INFO - HTTP Request: HEAD https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/resolve/main/README.md "HTTP/1.1 307 Temporary Redirect"
Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.
2026-05-31 21:09:16,947 - huggingface_hub.utils._http - WARNING - Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.
2026-05-31 21:09:16,967 - httpx - INFO - HTTP Request: HEAD https://huggingface.co/api/resolve-cache/datasets/SWE-bench/SWE-bench_Verified/91aa3ed51b709be6457e12d00300a6a596d4c6a3/README.md "HTTP/1.1 200 OK"
2026-05-31 21:09:17,076 - httpx - INFO - HTTP Request: HEAD https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/resolve/91aa3ed51b709be6457e12d00300a6a596d4c6a3/SWE-bench_Verified.py "HTTP/1.1 404 Not Found"
2026-05-31 21:09:17,409 - httpx - INFO - HTTP Request: HEAD https://s3.amazonaws.com/datasets.huggingface.co/datasets/datasets/SWE-bench/SWE-bench_Verified/SWE-bench/SWE-bench_Verified.py "HTTP/1.1 404 Not Found"
2026-05-31 21:09:17,535 - httpx - INFO - HTTP Request: GET https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Verified/revision/91aa3ed51b709be6457e12d00300a6a596d4c6a3 "HTTP/1.1 200 OK"
2026-05-31 21:09:17,653 - httpx - INFO - HTTP Request: HEAD https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/resolve/91aa3ed51b709be6457e12d00300a6a596d4c6a3/.huggingface.yaml "HTTP/1.1 404 Not Found"
2026-05-31 21:09:17,803 - httpx - INFO - HTTP Request: GET https://datasets-server.huggingface.co/info?dataset=SWE-bench/SWE-bench_Verified "HTTP/1.1 200 OK"
2026-05-31 21:09:17,917 - httpx - INFO - HTTP Request: GET https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Verified/tree/91aa3ed51b709be6457e12d00300a6a596d4c6a3/data?recursive=true&expand=false "HTTP/1.1 200 OK"
2026-05-31 21:09:18,046 - httpx - INFO - HTTP Request: GET https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Verified/tree/91aa3ed51b709be6457e12d00300a6a596d4c6a3?recursive=false&expand=false "HTTP/1.1 200 OK"
2026-05-31 21:09:18,169 - httpx - INFO - HTTP Request: HEAD https://huggingface.co/datasets/SWE-bench/SWE-ben
```

</details>

## 验证等级说明

- `official` 表示调用 SWE-bench 官方 Docker harness
- `local-test-patch` 表示先应用公开 test_patch，再按 FAIL_TO_PASS 尝试本地测试
- `local-test-patch` 不是官方等价结果，依赖本机依赖环境，报告里必须单独标明
