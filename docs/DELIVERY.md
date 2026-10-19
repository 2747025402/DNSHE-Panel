# 当前交付

## 当前状态

注册页已加入账号配额选择约束：账号选项内显示已用／剩余或用尽状态，不额外添加规则备注；已用尽账号不可选，未知或读取失败保持独立语义，全部用尽时禁止提交。定向回归为 `npm run test:register-ddns:ui`，包含选择框与注册按钮对齐检查。

本仓库当前交付包含两条彼此隔离的路径：

1. **GitHub Pages 真实前端演示**：由 `frontend/src` 构建，使用 `VITE_STATIC_DEMO=1` 注入合成 API 响应，不连接后端。
2. **可部署产品源码**：Worker 与 Docker 自建版仍保留完整 API、D1/KV、认证和业务逻辑，部署时使用操作者自己的资源配置。

Pages 演示入口：<https://shiranzby.github.io/DNSHE-Panel/>。

## Pages 演示内容

- 真实 React 前端的 12 个 hash 路由：概览、域名列表、Cloudflare、域名助力、账号管理、API 密钥、注册查重、账户配额、动态 DNS、CF 用量、运行日志和设置。
- 设计风、数据风、卡片风三种平级切换。
- 浅色／深色主题、侧边栏导航、页面切换和键盘可达控件。
- 所有样本数据均为合成数据；演示不读取 Cookie、Token、本地文件或远程 API。页面组件、CSS、状态和交互来自 `frontend/src`，不是独立重绘页面。

本地查看：

```powershell
$env:VITE_API_BASE_URL="/"
$env:VITE_STATIC_DEMO="1"
npm run build:pages --prefix frontend
python -m http.server 4173 --directory frontend/dist
```

然后打开 `http://127.0.0.1:4173/`。

## Docker 助力缓存修复

Docker 自建版此前在没有 Cloudflare KV 时会返回“未绑定 ASSIST_KV”。当前实现提供 SQLite-backed local KV：

- 启动时自动把本地 KV 注入 `ASSIST_KV`；
- 数据写入自建版 SQLite，并随挂载的 `/data` 目录持久化；
- 不需要为 Docker 自建版额外创建 Cloudflare KV；
- Cloudflare Workers 仍按自己的 `wrangler.toml` 配置 `ASSIST_KV` namespace。

相关回归：

```powershell
npm run test:local-kv
npm run build:node
npm run verify:node
```

## 验收边界

- Pages 构建与后端构建分别验证，不能把真实前端的合成 API 适配器当作已配置的后端实例。
- 业务写入、登录会话、数据库、KV 和外部凭据不随 Pages 发布。
- 真实部署前应复制 `.env.example`，创建自己的 D1/KV，注入自己的密钥，并在隔离环境完成读写验证。
- 前端界面回归使用合成数据；任何真实账号验收都应明确限定为只读并与日用实例隔离。

## 当前验证命令

```powershell
git diff --check
npm run test:local-kv
npm run build:node
npm run verify:node
```

Pages 工作流安装 `frontend` 依赖，使用 `VITE_STATIC_DEMO=1` 构建真实前端，再上传 `frontend/dist`。
