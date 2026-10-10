# 第三方素材与软件说明

阶段 1 界面未下载外部图片或字体。纸张、文件夹和句号标志由项目 CSS / SVG 绘制；中文字体使用系统字体栈。

浏览器运行时的直接依赖及许可证如下；原文放在 `apps/web/public/licenses/`，构建时会原样进入 `apps/web/dist/licenses/`。

| 依赖 | 版本 | 许可证 |
|---|---|---|
| React / React DOM | 19.3.0 | MIT |
| Lucide React | 1.52.0 | ISC；部分 Feather 图标为 MIT，保留双重说明 |
| Zod | 4.6.5 | MIT |

开发工具及阶段 0 运行时依赖各自附带许可证，可从安装包及锁文件对应版本核对。项目自身采用根目录 MIT LICENSE；第五阶段候选包含完整的实际分发依赖清单。

阶段 2 服务端解析的直接依赖如下；许可证原文复制到 `docs/licenses/`。PDF.js 随包附带的字体、CMaps、WASM 等额外许可保留在其安装包中，当前前端不分发这些资产。

| 依赖 | 版本 | 许可证 |
|---|---|---|
| fflate | 0.8.3 | MIT |
| fast-xml-parser | 5.11.2 | MIT |
| pdfjs-dist | 6.4.299 | Apache-2.0 |

Node 内置 SQLite 使用 Node 发行版附带的许可说明；第五阶段 macOS 候选打包官方 Node 二进制及完整 Node LICENSE（包含 SQLite 等第三方声明）。

## 第五阶段分发清单

`.app/Contents/Resources/licenses/dependencies.json` 记录实际安装的生产包及版本、声明许可证、许可文件位置和 `licenseEvidence` 来源。打包门禁拒绝仅有 SPDX 名称、没有任何许可正文文件的条目。优先保留发布包的 LICENSE/NOTICE，其次保留嵌套资源许可或明确的同源共享许可；原安装目录中的嵌套字体/二进制许可不剥离。浏览器许可位于 `web/licenses/`。本地项目三包按 MIT，原生启动器与 helper 也为本项目代码；AppKit/Security 是系统框架，未复制系统二进制。

部分固定版本的 npm 发布包没有原始许可正文（例如 fontkit 2.0.4）。本地候选为这些包提供版本绑定的发布者声明、作者/仓库 NOTICE 及官方 SPDX 完整条款；不把补充文本冒充上游原件，也不猜测版权年份或权利人。来源、摘要和补充类型保存在 `docs/licenses/release-sources.json`，随包复制到 `licenses/supplemental-sources.json`；说明见 `docs/licenses/release/README.md`。这些文件满足本地候选的正文映射检查，不证明完整法律合规。公开分发前仍需核实遗漏的上游版权声明、资源许可，以及 LGPL/MPL 等相关分发和源码提供义务。

Node 24.15.0 官方 LICENSE 包含其第三方软件声明；DeepSeek Harness npm 依赖按各包自身许可保留，未把 deepseek-harness-master 源码目录复制进候选。摘要文件供用户核验传输完整性，不能代替签名或来源信任。
