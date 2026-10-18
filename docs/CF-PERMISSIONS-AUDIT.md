# CF 免费额度：权限与读取审计

更新：2026-10-18。本文件区分新采集、旧缓存与本地修复；当前部署状态以 [DELIVERY](DELIVERY.md) 为准。

## 当前结论：指定绑定的新 Token 已恢复 Pages 读取

在用户明确授权下更新本地绑定 ID 7 的 Token 后，新凭据 active／原账号身份验证通过；实际服务用保存后的 Token 读取到 **4 个 Pages 项目，inventory_issues 为空**。当前正式版本与发布证据见 [DELIVERY](DELIVERY.md)。凭据不在本仓库内。

下面 07:01 的 403／10000 是轮换前历史，不再代表该绑定的当前结论；另一账号的 R2 未启用、KV 今日无操作记录等必须按各自事实表达。本次发布不额外强刷或承诺所有服务长期可读。

## 历史诊断：2026-10-18 07:01 UTC 的一次新采集

使用 `scripts/diagnose-cf-readability.mjs --force`，目标仅候选 3。一次面板登录，普通快照 GET 837ms；一次 `GET /api/cf/quota?force=1` 为 200、12977ms，`generated_at=2026-10-18T07:01:31.524Z`，`cached=false/stale=false`。没有读取或修改 CF Token、创建资源、业务写入、Cookie／会话／原响应落盘，也未使用前台键鼠。

脱敏证据：[audit.json](../../shots/takeover-current/cf-readability-2026-10-18T07-01-14-355Z/audit.json)。`cached_at` 是保留数据的原始时间，不是最新请求错误的发生时间。

| 账号 | 本次确认事实 | 本次缺项及根因边界 |
|---|---|---|
| 1（本地主键 7） | Workers／D1／KV 各 7 天；R2 存储新返回。Zone 30、D1 4、KV 4、R2 5、Workers 12 | Pages 列表仍为 **HTTP 403 / code 10000 / Authentication error**，保留 `2026-10-17T00:01:35.677Z` 缓存，不是成功空列表。本次 R2 操作统计达到单次 10 秒超时，保留 `2026-10-18T06:45:50.065Z` 旧值；不能算本次 fresh 成功 |
| 2（本地主键 8） | Workers／D1 各 5 天；Pages／Tunnel 成功空列表；KV／R2 操作成功空数据集 | R2 桶明确 **HTTP 403 / code 10042 / Please enable R2 through the Cloudflare Dashboard**，是未开通服务，不是笼统缺权限。R2 存储为 null 且无 query issue，不能补造 0；KV 无日期行不等于权限失败，也不能推断今日为 0 |

### 本地实际修复

- `readAccount` 原来把所有 `inventory_issues` 一律计为“部分不可读”；现在排除**上游明确**的 `not_enabled`／10042／R2 开通提示，并保留独立服务状态。普通 Pages 403／10000、认证、超时、网络、缺数仍保持原语义。
- 详情把未启用服务与“需关注的读取失败”分开，不再要求用户为未使用的 R2 反复补权限。独立 KV 今日未返回与 R2 操作超时不会因这个排除规则被隐藏。
- Pages 仍是阻塞：当前只读接口返回不能分辨具体是缺 Pages Read/Write、Token 目标范围或旧凭据。不能把它改成“Pages 未开启”假装修好；本轮未自动轮换 Token，也未更改业务资源。
- 账号 1 的 R2 操作是本轮真实新出现的超时，非永久无权限；有限超时＋保旧缓存继续有效，本轮不增加重试风暴或宣称网络已修复。

### 官方语义核对

- [Pages 项目列表](https://developers.cloudflare.com/api/go/resources/pages/subresources/projects/methods/list/) 明确存在 `GET /accounts/{account_id}/pages/projects`，接受 Pages Read 或 Pages Write；不能因为一枚 Token 拒绝就宣称接口不可用。
- [R2 错误码](https://developers.cloudflare.com/r2/api/error-codes/) 明确把 10042 列为 NotEntitled／403，而权限不足另有 10003；[R2 开通要求](https://developers.cloudflare.com/r2/get-started/) 需要账号 R2 subscription。此处还有真实“Please enable R2”原文支持，非只凭 403 猜测。
- [Token 故障排查](https://developers.cloudflare.com/fundamentals/api/troubleshooting/) 区分 Token 有效性、权限和用户角色；模板预填不改变已签发的 Token。本轮没有读取其 policy，故不夸大对 Pages 根因的确定度。

以下为历史审计，不能覆盖上面的当前采集证据。

## 1. 权限链路

单一事实源为 `frontend/src/CfUsage.tsx` 的 `CF_TOKEN_REQUIREMENTS`：手动权限清单、申请链接、诊断权限说明均由它生成。模板保留面板已有管理所需的 Edit 权限；额度采集本身只执行读取，不因模板含 Edit 而写资源。

| 实际读取 | 最低读取权限／可接受权限 | 当前模板 key/type | 资源范围 |
| --- | --- | --- | --- |
| `GET /accounts`（未保存 CF account ID 时） | Account Settings Read／Write | `account_settings:edit` | Token 允许的目标账号；不是本地数字主键 |
| `GET /zones?account.id={account_id}` | Zone Read／Write | `zone:edit` | 当前账号下、Token 允许的 Zone |
| `GET /accounts/{id}/d1/database` | D1 Read／Write | `d1:edit` | 当前 CF 账号 |
| `GET /accounts/{id}/storage/kv/namespaces` | Workers KV Storage Read／Write | `workers_kv_storage:edit` | 当前 CF 账号 |
| `GET /accounts/{id}/r2/buckets` | Workers R2 Storage Read／Write | `workers_r2:edit` | 当前 CF 账号，且已启用 R2 |
| `GET /accounts/{id}/workers/scripts` | Workers Scripts Read／Write 等接口接受权限 | `workers_scripts:edit` | 当前 CF 账号 |
| `GET /accounts/{id}/pages/projects` | Pages Read／Write | `page:edit` | 当前 CF 账号 |
| `GET /accounts/{id}/cfd_tunnel?is_deleted=false` | Cloudflare Tunnel Read／Write 等接口接受权限 | `argotunnel:read` | 当前 CF 账号；保留既有兼容 key |
| `POST /graphql`：`workersInvocationsAdaptive` | Account Analytics Read | `account_analytics:read` | 查询的 `accountTag` 必须属于 Token 允许范围 |
| 同上：`d1AnalyticsAdaptiveGroups` | Account Analytics Read | 同上 | 同上；数据集可用性独立判断 |
| 同上：`kvOperationsAdaptiveGroups` | Account Analytics Read | 同上 | 同上 |
| 同上：`r2OperationsAdaptiveGroups` | Account Analytics Read | 同上 | 同上；R2 启用与数据返回分别判断 |
| 同上：`r2StorageAdaptiveGroups` | Account Analytics Read | 同上 | 同上；空快照不补造存储值 |

模板另外保留 `dns:edit`，供 DNS 记录管理／委派等既有业务使用；**不是额度采集新增要求**。模板共 10 项，不将所有项笼统叫成“读取最低权限”。

官方依据：[模板格式](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/)、[Pages](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/)、[R2](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/)、[D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/)、[KV](https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/methods/list/)、[Workers](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/)、[Tunnel](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/list/)、[GraphQL Token 认证](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)。

### 模板不等于已签发权限

- 链接使用编码的 `{key,type}` 数组，`accountId=*`／`zoneId=all` 只负责预填创建表单；仍须用户确认并签发。
- 修改本地模板不会改变旧 Token；替换需由用户在账号管理明确确认，不自动轮换或覆盖凭据。
- 本轮离线测试证明清单与 URL 同源、10 项不重复、Pages／Tunnel 兼容 key 保留；**未验证登录后的 Cloudflare 表单实际显示哪些权限**，不以 URL 字符串测试替代该步骤。`argotunnel` 仍需在最终表单核对，不能仅凭兼容常量声称官方当前表单已确认。
- 未读取现有 Token 的 policy；不能从“其它资源能读”推断 Pages 的权限或目标账号范围一定正确。

## 2. 本轮实质修复

1. **账号范围**：额度采集原先调用无范围的 `listZones()`。一个 Token 可见多个账号时，每个账号可能重复统计所有 Zone；现传入目标 CF account ID，并添加 `account.id` 过滤。无参数的既有业务调用保持原语义。
2. **服务未启用误报权限**：明确的 R2 `10042`／`Please enable R2` 改为 `not_enabled`；兼容旧快照仍为 `permission` 的开通提示。其它普通 403 不猜测为未启用。依据 [R2 NotEntitled](https://developers.cloudflare.com/r2/api/error-codes/)。
3. **可追溯诊断**：REST／GraphQL 保留结构化 HTTP status、Cloudflare code、脱敏原错误和原缓存时间。Pages 的 `Authentication error` 不吞成空项目，也不直接宣布 Token 失效或“Pages 不支持读取”。
4. **界面减法**：默认仅显示资源、短事实、缓存时间；展开后才显示接口、权限、范围、HTTP/code 与脱敏原错误。内部链接／诊断展开不触发父账号收起；排序按稳定 ID 跟随，Esc 关闭后归焦。

通用失败仍区分认证、权限或范围待核对、未启用、限流、超时、网络、未返回、响应异常、查询不可用。成功空集、真实零、未读与失败不是同一状态。

## 3. 本轮真实读取：旧快照，而非新强刷

本轮一次面板登录后，仅 GET 普通 `/api/cf/quota` 一次；HTTP 200、约 1651ms。未 force、未写业务、未读取或修改 CF 原 Token、未保存会话。响应为 `cached:true, stale:true`，`generated_at=2026-10-17T11:54:41.463Z`；下表是该旧快照保留的事实，不作为本次 fresh 成功率或加速结论。

| 脱敏账号 | 已返回事实 | 不可读／缺失事实 |
| --- | --- | --- |
| 1 | Zone 30、D1 4、KV 4、R2 5、Workers 11；Workers／D1／KV 各 7 天；R2 操作与存储已返回 | Pages `403 Authentication error`，旧快照标权限，保留 `2026-10-17T00:01:35.677Z` 缓存 |
| 2 | Zone 2、D1 2、KV 1、Workers 2；Workers／D1 各 4 天；Pages／Tunnel 成功空集 | R2 桶 `403 Please enable R2 through the Cloudflare Dashboard.`；KV／R2 操作为成功空数组，R2 存储为 null 且无 issue |

因此：

- **不是请求数普遍只能读最近三天**：该快照已返回 4／7 天。成功短历史按返回日期展示，不补零，不单凭天数判缺权限。
- Pages 根因仍可能是旧 Token、Pages 权限或目标范围，当前证据不能三选一；接口本身存在并接受 Read／Write。
- 账号 2 的 R2 明确提示未开通；扩大权限不等于开通服务。
- 1651ms 是旧快照接口读取，不是上游全量采集耗时。已有并发、单次／整批超时与快照策略由既有后端实现，本专项不宣称新的实网加速倍数。

## 4. 验证与未验项

| 本地证据 | 结果与边界 |
| --- | --- |
| `npm run test:usage:backend` | 22/22，含新增账号范围与 R2 分类反例；属于真实模块边界＋合成上游，不是当前真人 Token 验收 |
| `node scripts/test-cf-permissions.mjs` | 3/3，清单／模板同源、诊断保真、12 个来源映射；不证明 Cloudflare 最终表单 |
| `node scripts/test-cf-diagnostics-ui.mjs` | 4/4，合成 API、后台 headless；整行／内部诊断／排序／键盘／390px 边界。首次截图使用 fullPage 与内部滚动面不匹配，下方空白过多，**不能作为合格整页视觉验收** |
| 根 TypeScript | 本专项完成时通过；全站最终构建与合流回归由主流程统一执行 |

专项交互报告：`../shots/takeover-current/cf-diagnostics-2026-10-17T13-35-34-349Z/report.json`（相对源码仓库）。首次两张截图保留为失败证据；最终当前构建截图、候选 fresh 强刷及 HTTP/code 实况由主流程统一验收，避免重复登录和重复上游请求。

仍须明确的限制：当前 Token policy、登录后模板表单和新候选 fresh 读取尚未在本专项核验；资源清单不能据小样本宣称无限量完整枚举，尤其当前 R2 列表只读取一页，后续大规模场景应另验分页。上述边界不由绿色离线测试覆盖。
