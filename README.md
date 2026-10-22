# Codex Windows 修复工具包

把两个已验证的本地修复整理在一起，方便在其他 Windows 电脑复用：

1. **映射盘／UNC 路径适配器**：修正本地会话目录参数末尾的反斜杠，避免已复现的 `permission path cannot be represented losslessly` 保存失败，以及其后可能出现的写入器占用。
2. **dot 连接代理配置**：通过已有 Proxifier，把指定程序访问 `codex-cloud-backend.chatgpt.com:443` 的连接与该域名解析交给本机代理。

这是个人修复工具，不是 OpenAI 官方补丁。保存问题与网络连接问题彼此独立。本工具不会自动恢复此前未落盘的聊天正文。

## 在另一台电脑使用

1. 此仓库已公开，无需登录即可点击 **Code → Download ZIP**，或在 [发布页](https://github.com/HMF-bud/codex-windows-repair-kit/releases/latest) 下载版本包。解压到一个长期保留的本地目录，例如 `D:\Tools\codex-windows-repair-kit`。不要从 ZIP 内直接运行。早期 v0.1.0 包内说明中的“私有仓库需登录”已不适用，程序无需更改。
2. 安装并打开过 **Windows Codex 桌面版**；映射好目标网络盘，默认 `R:`。需要 Node.js 18+：优先使用 PATH 中的 Node，也可检测 Codex 自带的 Node。
3. **双击 `Install.cmd`**。脚本自动检测共享盘、原版后端和本机程序路径，编译本地入口，运行独立保存／重读及沙箱边界测试；通过后才写入当前用户的下一次启动设置。失败窗口会保留错误。
4. 在方便时正常关闭并重新打开 Codex，再运行 `Diagnose.cmd` 检查真实接入。安装器不自动重启应用或停止实验；有未保存问答时先从界面导出备份。
5. 若 dot 的接口连接需要原来的代理修复：先启动自己的 Clash 等本机代理，再双击 **`Start-Proxifier.cmd`**。需要单独安装 Proxifier，并自行处理试用／许可证提示。
6. 让 dot 按 [验收说明](docs/acceptance.md) 读取一条新问答。进程在线、文件可读、测试通过都不能代替这一步。

首次安装通常只需双击安装器。换盘符、端口或程序位置时，可运行：

```powershell
.\Install.ps1 -Drive Z: -ProxyPort 7890
# 检测到多个后端或找不到 Node 时，明确指定本机路径：
.\Install.ps1 -BackendPath 'C:\actual\codex.exe' -NodePath 'C:\Program Files\nodejs\node.exe'
# 只准备和测试，不修改下一次启动或代理设置：
.\Install.ps1 -PrepareOnly
```

安装目录就是运行目录，启用期间不能删除或移动。PowerShell 启动器的 `ExecutionPolicy Bypass` 只对本次进程有效，不修改系统策略；不会绕过组织策略。应以使用 Codex 和映射盘的同一普通 Windows 用户运行。

## 四个入口

| 文件 | 用途 | 影响 |
|---|---|---|
| `Install.cmd` | 检测、编译、独立验证并配置适配器 | 设置用户级 `CODEX_CLI_PATH`，下次启动生效 |
| `Start-Proxifier.cmd` | 启动 Proxifier 并加载本机生成的配置 | 加载整份代理配置；不会重启 Codex |
| `Diagnose.cmd` | 查看映射、启动设置、真实激活记录及进程 | 只读，不代表正文验收成功 |
| `Rollback.cmd` | 恢复安装前的用户级启动入口 | 下次启动生效，不删除记录或结束进程 |

代理配置默认只让 `ChatGPT.exe`、`codex.exe`、`node.exe` 访问上述域名的 443 端口经 `127.0.0.1:7897` 的 HTTPS 代理，其余连接直连。`Install.cmd` 仅生成配置，**不会立即加载代理规则**。已有 Proxifier 配置的电脑，加载本工具配置会替换当前规则集合，而非合并；有其他规则时先通过 Proxifier 导出当前配置。

Proxifier 可以在 Codex 掉线后启动，但启动成功不代表旧连接已经恢复；等客户端下一次连接后执行单次接口验收。不要因一次超时就不断重启应用。

## 自动适配的范围

- 安装时用 Windows `WNetGetConnection` 获取指定盘符的 UNC 共享根，覆盖该共享根及所有项目子目录。
- 每次启动重新核实映射。映射不匹配时不会将盘符误转到另一共享盘。
- 仅处理本地 `thread/start`、`thread/resume`、`thread/fork`、`turn/start` 中的目录元数据和适用的已有可写根路径。
- 正文、工具命令、SSH/Linux 路径、其他共享盘、远程 environment、权限策略不被转换；含 `.`/`..` 的路径不处理。
- 保留原版 Codex 后端、用户资料目录和历史记录。沙箱包路由来自实际安装包，权限检查仍由原版后端执行。

更换 R 盘映射或升级 Codex 后，应重新准备并验收。为避免影响运行中的入口，安装器拒绝覆盖正在使用的本工具副本；可先在独立副本运行 `-PrepareOnly`，通过后在方便时关闭 Codex 再切换。已验证的故障不代表所有“会话被占用”问题都有同一原因。

## 验证与回退

已验证基线：桌面 `26.1016.6573.0`，后端 `0.163.0-alpha.11`。这次便携化后的启动链在独立环境通过：UNC 根、UNC 子目录、映射盘根、映射盘子目录的保存与卸载重读，以及沙箱内允许写、沙箱外拒绝写。

验证用独立 `CODEX_HOME` 与本机固定回复服务，不使用模型凭据、不调用真实模型、不读取或复制原聊天。测试只读目标共享盘目录；所有测试文件保存在 `local/checks/`。后端本身仍可能请求公共元数据，这不是全进程断网测试。

运行 `Rollback.cmd` 恢复原启动变量。如果该变量已被别的程序改动，脚本会停止，避免覆盖后来的设置。网络回退可在 Proxifier 中加载先前导出的配置，或退出 Proxifier；`local/proxifier-profile-before-install.ppx` 如存在，仅是安装时 `Default.ppx` 的副本，不保证包含后来修改或其他选中配置。

此前未落盘的问答应先导出完整界面正文，再经用户授权在原会话追加带来源说明的恢复消息。不要改 JSONL／数据库来伪造旧轮次；追加恢复不等于原轮次 ID 和时间已复原。

## 仓库内容与隐私

- `adapter/`：源码；原生 EXE 在目标电脑编译，不携带本机二进制。
- `proxy/`：无凭据的代理模板。
- `tests/`：目录规范化、独立后端保存和沙箱测试。
- `docs/`：验收步骤和修复边界。
- `research/`：未投入生产的最小 Rust 补丁候选及来源，只供后续研究。
- `local/`：安装时生成的机器路径、日志、备份、验证结果，**全部被 Git 排除**。

仓库不包含账号令牌、Codex 登录文件、聊天备份、会话 ID、研究资料、私人共享盘名称、应用安装包或 Proxifier 许可证。不要把本机 `local/` 目录手工上传到 GitHub。
