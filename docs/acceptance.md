# 单次验收

## 先区分两条链路

1. **保存链路**：新问答实际出现在 Codex 历史接口中，并保存在磁盘。
2. **dot 链路**：dot 委托环境能够调用同一接口并读到实际助手正文。

映射盘转换器解决已复现的目录序列化问题；Proxifier 解决当前环境下的 cloud backend 连接问题，不能互相替代。

## 新电脑安装后

1. `Diagnose.cmd` 中的 `mappingMatches` 应为 true。
2. 正常启动 Codex 后，`lastRealActivation` 应有当前启动记录且 `isolatedHome=false`。历史激活日志或单纯进程存在不能证明当前会话成功保存。
3. 在目标项目创建或使用自己允许测试的会话，发送：

   > 只回复“路径保存验收通过”，不要读取或修改文件，不调用工具。

4. 复制该会话的真实 ID，让 dot 执行以下指令，替换 `实际会话ID`：

   > 单次只读验收：先通过当前工具目录发现 read_thread 的真实入口，然后调用一次，threadId=实际会话ID、hostId=local、turnLimit=1、includeOutputs=true、maxOutputCharsPerItem=3000。报告 UTC 起止时间、isError、返回 thread ID、turn ID/状态/items 数，并从实际 agentMessage 引用“路径保存验收通过”。不要使用 preview 或本地文件代替，不启动会话、不发送消息，失败不重试。

工具列表可能动态变化。`TypeError: ... is not a function` 是入口发现问题，不能直接作为服务端连接失败的证据。

## 失败时

- `MCP -32000`：保留时间窗和完整错误，先对比本地调用与 dot 调用。不能仅凭通用错误判断 DNS、权限或数据库原因。
- 返回 `interrupted`、`items=[]`：说明本次读到的最新轮次为空。必要时只读较早轮次，明确其版本，不能称较早正文为最新答复。
- `permission path cannot be represented losslessly`：核对适配器实际激活、映射和版本。先备份未保存正文，不反复操作原会话。
- Proxifier 试用窗口卡住：不要循环启动或结束其他研究进程，先处理该窗口。

本工具没有自动重试、自动重启、聊天修复写入或实验管理功能。
