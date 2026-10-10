# 参与开发

感谢你帮助收尾搭子变得更可靠。当前支持 macOS / Apple Silicon；请把平台和模型协议的新增适配作为独立变更说明。

## 本机准备

验证组合为 Node 24.15.0、pnpm 11.28.5、macOS 26.2。macOS 原生测试需要 Apple Command Line Tools（swiftc）。

```bash
npm exec --yes --package=pnpm@11.28.5 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@11.28.5 -- pnpm typecheck
npm exec --yes --package=pnpm@11.28.5 -- pnpm test
npm exec --yes --package=pnpm@11.28.5 -- pnpm exec playwright install chromium
npm exec --yes --package=pnpm@11.28.5 -- pnpm test:e2e
```

日常开发用 `pnpm dev`（或以上 npm exec 前缀），运行 Vite 与独立 API。完整本地运行用 `pnpm start`。不要用仅静态预览代替真实项目服务。

## 验证约定

自动测试使用临时数据库和本机合成模型，不读取个人 .env，不调用付费供应商。Keychain 原生测试只操作随机命名的合成凭据并清理；浏览器测试使用隔离端口 4327。非 macOS 跳过原生测试不代表该平台已验收。

修改存储、权限、删除、导出或凭据边界时，为实际风险补充回归；不要向日常材料库导入测试数据。修改界面时注意 375px、小屏长文本、键盘、焦点和可访问性。手动 `verify:model` 与网页“测试连接”可能收费，不属于自动验收。

## 提交 Pull Request

1. Fork 仓库，从 main 建立自己的分支。
2. 在 PR 中说明问题、变更行为、验证命令和未覆盖的边界；界面变更附合成数据截图。
3. 提交前检查 diff，运行与改动相关的测试及 `pnpm audit --prod`。
4. 不提交 Key、数据库、用户材料、日志、node_modules、生成安装包或 AppleDouble 文件。

公开文档采用明确允许清单；docs/internal、开发流水记录与自动截图证据保留在本机。对外截图位于 docs/assets，必须使用内置或合成材料。第三方 LICENSE/NOTICE 不应因文案清理而被删除。

## 构建本地候选

```bash
npm exec --yes --package=pnpm@11.28.5 -- pnpm package:mac
npm exec --yes --package=pnpm@11.28.5 -- pnpm verify:package
npm exec --yes --package=pnpm@11.28.5 -- pnpm verify:package-flow
npm exec --yes --package=pnpm@11.28.5 -- pnpm package:source
```

编译机需要 swiftc；候选应用运行时携带固定 SHA-256 的官方 Node，不要求终端用户安装开发工具。源码打包与公开文档清单应同步维护。不要修改外部上游源码目录来修补本项目。

候选包不等于正式发行。公开分发二进制前完成 [发行清单](docs/release-checklist.md) 中的签名、平台、许可及源码提供义务复核。

项目代码采用 MIT，外部软件维持各自许可。安全问题请按 [SECURITY.md](SECURITY.md) 私密反馈。
