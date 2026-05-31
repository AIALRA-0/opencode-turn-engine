# AIALRA full-24 corrected summary

- 基础运行：`202605312120-full24-aialra-v3`
- 基础设施补跑：`202605312120-full24-aialra-v3-rerun-infra`
- 说明：基础运行中 `NodeBB-265...` 和 `pytest-7490` 因人工清理 repo cache 触发 worktree 准备失败，本文件用补跑结果替换这两行，作为本轮真实能力总结

## 总览

| 指标 | 数值 |
| --- | ---: |
| 题目数 | 24 |
| 总分 | 452 |
| 补丁质量均分 | 58 |
| 完成 | 23/24 |
| 有 patch | 20/24 |
| 零补丁 | 4/24 |
| 官方验证通过 | 7/24 |
| 官方验证尝试 | 13/24 |
| 检测型超时 | 1 |
| 等待审批 | 0 |
| turn 终态 | 24/24 |

## 每题结果

| Case | 验证通过 | 补丁质量 | Patch | 零补丁 | turn 终态 | 检测型超时 | repair | 来源 | 错误/停止原因 |
| --- | --- | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| astropy__astropy-13398 | 否 | 50 | 582 B | 否 | 是 | 否 | 1 | initial |  |
| astropy__astropy-13453 | 是 | 85 | 553 B | 否 | 是 | 否 | 0 | initial |  |
| django__django-12754 | 是 | 85 | 1382 B | 否 | 是 | 否 | 0 | initial |  |
| django__django-14351 | 是 | 95 | 1598 B | 否 | 是 | 否 | 0 | initial |  |
| instance_ansible__ansible-a02e22e902a69aeb465f16bf03f7f5a91b2cb828-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5 | 否 | 5 | 0 B | 是 | 是 | 是 | 0 | initial | repeated tool loop: 10 recent calls collapsed to 2 unique command(s), diff=none |
| instance_ansible__ansible-e40889e7112ae00a21a2c74312b330e67a766cc0-v1055803c3a812189a1133297f7f5468579283f86 | 否 | 10 | 0 B | 是 | 是 | 否 | 0 | initial |  |
| instance_element-hq__element-web-5e8488c2838ff4268f39db4a8cca7d74eecf5a7e-vnan | 未验证 | 60 | 16160 B | 否 | 是 | 否 | 0 | initial |  |
| instance_element-hq__element-web-a692fe21811f88d92e8f7047fc615e4f1f986b0f-vnan | 未验证 | 60 | 13451 B | 否 | 是 | 否 | 1 | initial |  |
| instance_internetarchive__openlibrary-25858f9f0c165df25742acf8309ce909773f0cdd-v13642507b4fc1f8d234172bf8129942da2c2ca26 | 未验证 | 60 | 9696 B | 否 | 是 | 否 | 0 | initial |  |
| instance_NodeBB__NodeBB-2657804c1fb6b84dc76ad3b18ecf061aaab5f29f-vf2cf3cbd463b7ad942381f1c6d077626485a1e9e | 否 | 10 | 0 B | 是 | 是 | 否 | 0 | infra rerun |  |
| instance_NodeBB__NodeBB-be43cd25974681c9743d424238b7536c357dc8d3-vf2cf3cbd463b7ad942381f1c6d077626485a1e9e | 否 | 60 | 10876 B | 否 | 是 | 否 | 1 | initial |  |
| instance_protonmail__webclients-6e1873b06df6529a469599aa1d69d3b18f7d9d37 | 未验证 | 60 | 5209 B | 否 | 是 | 否 | 1 | initial |  |
| instance_protonmail__webclients-df60460f163fd5c34e844ab9015e3176f1ab1ac0 | 未验证 | 60 | 20370 B | 否 | 是 | 否 | 1 | initial |  |
| instance_qutebrowser__qutebrowser-0fc6d1109d041c69a68a896db87cf1b8c194cef7-v2ef375ac784985212b1805e1d0431dc8f1b3c171 | 未验证 | 60 | 9192 B | 否 | 是 | 否 | 1 | initial |  |
| instance_qutebrowser__qutebrowser-de4a1c1a2839b5b49c3d4ce21d39de48d24e2091-v2ef375ac784985212b1805e1d0431dc8f1b3c171 | 未验证 | 60 | 33251 B | 否 | 是 | 否 | 0 | initial |  |
| matplotlib__matplotlib-22835 | 否 | 50 | 1107 B | 否 | 是 | 否 | 1 | initial |  |
| matplotlib__matplotlib-26020 | 是 | 85 | 1208 B | 否 | 是 | 否 | 0 | initial |  |
| psf__requests-2674 | 否 | 10 | 0 B | 是 | 是 | 否 | 0 | initial |  |
| pydata__xarray-4493 | 否 | 50 | 487 B | 否 | 是 | 否 | 1 | initial |  |
| pylint-dev__pylint-7228 | 否 | 50 | 3141 B | 否 | 是 | 否 | 1 | initial |  |
| pytest-dev__pytest-7168 | 是 | 85 | 546 B | 否 | 是 | 否 | 0 | initial |  |
| pytest-dev__pytest-7490 | 否 | 50 | 632 B | 否 | 是 | 否 | 1 | infra rerun |  |
| scikit-learn__scikit-learn-13241 | 是 | 85 | 754 B | 否 | 是 | 否 | 0 | initial |  |
| scikit-learn__scikit-learn-14092 | 是 | 95 | 1585 B | 否 | 是 | 否 | 0 | initial |  |

## 文件

- 基础报告：`real-benchmark-202605312120-full24-aialra-v3.md`
- 补跑报告：`real-benchmark-202605312120-full24-aialra-v3-rerun-infra.md`
- 合并 JSON：`real-benchmark-202605312120-full24-aialra-v3-corrected-results.json`
