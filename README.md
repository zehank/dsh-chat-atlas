# chat-atlas

DeepSeek Harness（DSH）插件：**角色 / 记忆 / 上下文** 三件套。

给每个会话选一个角色（程序员、理科教授、人生导师兼心理医生、建模师、搜索大师、插件创作者、无角色），
角色决定人格提示词、输入框上方的面板和特色功能；所有角色共用一套可检索、可在界面里翻看的本地记忆库。

## 功能

**角色（role-studio）**
- 新会话在输入框上方选角色；可手动选，也可按第一句话自动判（设置里切换）
- 角色是数据：内置 6 个 + 自定义（`role_create` 工具或往 `~/.dsh/chat-atlas/roles/*.json` 丢文件）
- 角色切换即时生效（系统提示词按会话注入）
- 特色面板：理科四科进度条、导师每日一句

**记忆（memory-atlas）**
- 记忆就是磁盘上的 Markdown（frontmatter + 正文），索引是派生缓存
- 工具：`memory_save / search / read / list / link / folder_create / progress / mark_learned / import_file / graph`
- 新记忆自动分类；类别不存在时先提议、等确认再建
- 面板：可拖拽、可缩放、点外面关闭；两种视图——文件夹列表 / Obsidian 风格网状图（相关度决定距离）

**上下文（context-loom）**
- 每轮按用户消息检索记忆库，把最相关几条注入系统提示词（有预算上限，无命中不占位）

## 安装

```bash
git clone https://github.com/zehank/dsh-chat-atlas.git
dsh plugin --profile desktop add "$(pwd)/dsh-chat-atlas"
```

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
