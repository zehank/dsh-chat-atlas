# chat-atlas

DeepSeek Harness（DSH）插件：**角色 / 记忆 / 上下文** 三件套。

给每个会话选一个角色（编程老师、程序员、理科教授、人生导师兼心理医生、建模师、搜索大师、插件创作者、无角色），
角色决定人格提示词、输入框上方的面板和特色功能；所有角色共用一套可检索、可在界面里翻看的本地记忆库。

## 功能

**角色（role-studio）**
- 新会话在输入框上方选角色；可手动选，也可按第一句话自动判（设置里切换）
- 角色是数据：内置 7 个（不含「无角色」）+ 自定义（`role_create` 工具或往 `~/.dsh/chat-atlas/roles/*.json` 丢文件）
- 角色切换即时生效（系统提示词按会话注入）
- 特色面板：理科四科进度条、导师每日一句

**记忆（memory-atlas）**
- 记忆就是磁盘上的 Markdown（frontmatter + 正文），索引是派生缓存
- 工具：`memory_save / search / read / list / link / folder_create / progress / mark_learned / import_file / attach / graph`
- **所有角色都能读文件**（2026-10-22）：`rolePrompt()` 里统一注入「文件能力」段 + 每个角色自己的原文仓库路径（programmer/coder→`.dsh/plugins`，professor/mentor→`books/`，searcher→`source/gpt-export`，magnifier→`resume/`，modeler→`.blend`）；「无角色」也注入这一段（工具约定，不是人格）
- 附件两种挂法：`memory_attach mode=copy`（复制进附件库，默认）/ `mode=ref`（只登记绝对路径，书和原件用这个，不占空间）；`/atlas/file` 两种都能开
- **能带文件**：条目可挂附件（图片 / PDF / docx / 模型文件都行）。原文件复制进 `~/.dsh/chat-atlas/attachments/<条目 id>/`，frontmatter 里多一行 `attachments: [{name,size,mime}]`；文本文件（≤200KB）同时把原文写进正文以便检索，二进制或超大文件只在正文留一行占位。面板里点附件直接打开/另存（`/atlas/file?id=&name=`）。
- 新记忆自动分类；类别不存在时先提议、等确认再建
- 面板：可拖拽、可缩放、点外面关闭；两种视图——文件夹列表 / Obsidian 风格网状图（相关度决定距离）
- 条目详情窗口（0.2.1）：顶部有横把手，上下拖动调高度（120px～面板高-96px，值存 localStorage `chat-atlas:detail-h`）；标题栏与 × 关闭按钮固定在滚动区外，正文再长也不会把关闭按钮顶走

**上下文（context-loom）**
- 每轮按用户消息检索记忆库，把最相关几条注入系统提示词（有预算上限，无命中不占位）
- 混合检索：BM25 词面 + 本地语义向量（all-MiniLM 系列的多语种版 e5-small，384 维），倒数排名融合
- 语义模型不可用时自动退回纯词面检索，不会报错

## 安装

macOS / Linux：

```bash
git clone https://github.com/zehank/dsh-chat-atlas.git
cd dsh-chat-atlas
pnpm install
node scripts/setup-sharp.mjs   # 文本检索用不到 sharp 的图片处理，换成空壳
dsh plugin --profile desktop add "$(pwd)"
```

Windows（PowerShell）：

```powershell
git clone https://github.com/zehank/dsh-chat-atlas.git
cd dsh-chat-atlas
pnpm install
node scripts/setup-sharp.mjs
dsh plugin --profile desktop add (Get-Location).Path
```

语义模型（`Xenova/multilingual-e5-small`，约 130MB）不随仓库分发：首次启动时如果 `models/`
里没有，会自动下载一次到该目录；下载失败就只用词面检索。

装完**重启 DSH**（宿主侧插件在启动时组合）。

要求：DSH 0.2.x（`desktop` profile）。

## 结构

```
package.json          # dsh.bundle.patch + dsh.client
cordis.patch.yml      # 插入 4 条 Loader 行
client.js             # 浏览器 bundle：角色条 + 记忆面板
host/core.js          # 存储、检索、大纲、工具定义辅助
host/memory.js        # 记忆插件
host/role.js          # 角色插件 + /atlas/* HTTP 路由
host/context.js       # 上下文插件
host/embed.js         # 本地语义向量（onnx，可在缺失时降级）
scripts/setup-sharp.mjs
```

## 数据

记忆库在 `~/.dsh/chat-atlas/`：

```
memory/{programming,science,library-science,library-philosophy,portrait,modeling,plugins,inbox,custom}
meta/{roles.json,progress.json}
roles/                # 自定义角色
```

删掉这个目录 = 清空记忆；备份它就是备份全部记忆。

## 说明

- 宿主侧改动需要重启 DSH；客户端 `client.js` 改动刷新页面即可
- 插件不能 `import '@deepseek-ai/*'`（profile 里解析不到），工具 schema 由 `host/core.js` 的 `tool()` 自己编
- 客户端 bundle 必须由「包名那一行」加载，子路径行不会进启动图

## License

MIT
