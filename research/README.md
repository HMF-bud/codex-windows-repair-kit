# 源码补丁候选（不随安装启用）

生产入口使用目录参数适配器，仍启动用户安装的原版 Codex。本目录保留源码研究结果，避免把未完成验证的 Rust 补丁混入安装路径。

- 相关问题：[openai/codex #49900](https://github.com/openai/codex/issues/49900)。
- 补丁基于提交 `c2d5ea52e1b7ab11ee2d71dc44ea1ef00f9c8eb3` 的 `codex-rs/protocol/src/permissions.rs`。
- `windows-permission-trailing-separator.patch` 只允许非 opaque Windows URI 往返时末尾目录分隔符差异，保留其他严格检查。
- 原诊断中提取源码的四项最小测试通过，包括同一失败写入队列在修正序列化后保序重试的模拟；这不等于完整桌面验证。
- 完整官方模块的源码编译完成，但原 Windows 工具链在测试进程启动／链接阶段失败，没有执行该完整模块的断言。因此不提供“已验证的 patched codex.exe”。
- [PR #31155](https://github.com/openai/codex/pull/31155) 在 2026-10-22 检查时已关闭、未合并。释放失败写入器不等于保留并恢复未保存正文。

当前已退出进程的旧内存队列无法靠这个源码补丁追回。任何历史正文补回必须有备份并明确标注来源；不能伪造原轮次。

补丁上下文来自 OpenAI Codex（Apache-2.0）；上游完整许可证见 `LICENSE-OpenAI-Codex.txt`。补丁不包含私人诊断日志、原会话记录或研究成果。
