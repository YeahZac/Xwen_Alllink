# 万业互联云 API（Xwen_Alllink）

地摊供应链平台后端服务 · 适配 **微信云托管**（Node.js + MySQL）。

## 目录

```text
backend/
  sql/                 # 数据库脚本
    01_schema.sql      # 建库建表
    02_seed.sql        # 演示数据
  src/                 # 源码
  Dockerfile
  container.config.json
  .env.example
```

## 核心业务

```text
供应链供货成交
  → 地摊/异业获得「积分额度」进入商家额度池（也可后台发放）
  → C 端消费支付成功后从额度池划拨到消费者
  → 异业积分兑换/全额现金；抵现汇率 platform_config.points_cash_rate
```

## 本地启动

```bash
cd backend
cp .env.example .env
# 填写 DB_* / JWT_SECRET
npm install
npm run db:init
npm start
# 健康检查：GET http://localhost/api/health
```

## 运营台 `/admin/`

邀请码 `A001`（可用环境变量 `ADMIN_CODE` 覆盖）。侧栏模块：

| 模块 | 能力 |
|------|------|
| 概览 | 用户/商户/订单/额度/投诉等汇总 |
| 入驻审核 | 通过 / 驳回 |
| 商户管理 | 详情、编辑、启停、发放额度池 |
| 用户积分 | 查询、调积分、禁用 |
| 商品目录 | 地摊 / 异业 / 供应链 CRUD |
| 订单中心 | 点餐 / 异业 / 采购订单列表 |
| Banner | 全端广告位管理 |
| 平台配置 | `platform_config`（含积分汇率） |
| 提现审核 | 通过 / 驳回 / 已打款 |
| 投诉工单 | 处理中 / 关闭 |
| 供应需求 | 报价 / 关闭 |
| 推荐记录 | 单级推荐流水 |

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务信息（含运营台入口提示） |
| GET | `/admin/` | **运营后台网页**（邀请码 `A001`） |
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | 邀请码登录 `{code}`（`A001`=运营） |
| POST | `/api/auth/wx-login` | 微信快捷登录（演示） |
| GET | `/api/auth/profile` | 当前身份资料（需 Bearer Token） |
| POST | `/api/apply/submit` | 商户入驻申请 |
| GET | `/api/apply/status?phone=` | 查询入驻审核 |
| GET | `/api/admin/dashboard` | 运营概览 |
| GET | `/api/admin/applies` | 入驻申请列表 |
| POST | `/api/admin/apply/:id/approve` | 审核通过 |
| POST | `/api/admin/apply/:id/reject` | 审核驳回 |
| GET/PATCH | `/api/admin/merchants[/:id]` | 商户列表 / 详情 / 更新 |
| GET/PATCH | `/api/admin/users[/:id]` | 用户列表 / 状态 |
| POST | `/api/admin/users/:id/points` | 调整用户积分 |
| GET/POST | `/api/admin/goods/{stall\|cross\|supply}` | 商品列表 / 保存 |
| GET | `/api/admin/orders/{consumer\|cross\|purchase}` | 订单列表 |
| GET/POST/DELETE | `/api/admin/banners[/:id]` | Banner 管理 |
| GET/PUT | `/api/admin/configs[/:key]` | 平台配置 |
| GET/POST | `/api/admin/withdraws*` | 提现列表 / 审核 / 演示单 |
| GET/PATCH | `/api/admin/complaints[/:id]` | 投诉 |
| GET/PATCH | `/api/admin/supply-needs[/:id]` | 供应需求 |
| GET | `/api/admin/referrals` | 推荐记录 |
| GET | `/api/banners?role=` | 广告 Banner（C端） |
| GET | `/api/stalls` | 附近地摊 |
| GET | `/api/stalls/:id/menu` | 点餐菜单 |
| GET | `/api/cross-stores` | 异业门店 |
| GET | `/api/supply/goods` | 供应链商品 |
| POST | `/api/orders/stall/pay` | 点餐支付+积分划拨 |
| POST | `/api/orders/cross/redeem` | 异业兑换/现金 |
| GET | `/api/points/me` | 我的积分 |
| GET | `/api/orders/mine` | 我的订单 |
| POST | `/api/merchant/purchase` | 采购成交获额度 |
| GET | `/api/merchant/points-pool` | 商家额度池 |
| POST | `/api/admin/points-pool/grant` | 后台发放额度 |
| GET | `/api/config/cash-rate` | 积分抵现汇率 |

统一响应：`{ code: 0, message: 'ok', data }`；失败 `code != 0`。

演示邀请码（种子数据）：`C001` 消费者 / `D001` 地摊 / `Y001` 异业 / `G001` 供应链 / **`A001` 运营后台**。

## 微信云托管部署

1. 控制台创建环境 → 开通 **MySQL**  
2. 在 MySQL 中执行 `sql/01_schema.sql`、存量库再执行 `sql/03_patch.sql`、最后 `sql/02_seed.sql`（含闭环演示订单/流水）；地摊点餐规格（口味/分量/配料）执行 `sql/08_stall_options.sql`
3. 创建服务，选择「通过 Dockerfile 部署」，上传本目录或关联本 Git 仓库  
4. **构建目录填 `backend`**（若仓库是 monorepo 根）；若仓库根就是 backend 则填 `.`  
5. 服务环境变量（**必填，否则会连 127.0.0.1:3306 报 ECONNREFUSED**）：  
   - 云托管推荐：`MYSQL_ADDRESS`（如 `10.36.107.20:3306`）、`MYSQL_USERNAME`、`MYSQL_PASSWORD`  
   - 或：`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME=wanyehulian`  
   - 另配：`JWT_SECRET`、`ADMIN_CODE`（建议改掉默认 A001）  
6. 发布后先访问：`/api/health`，确认返回里 `db.ok: true`  
7. 运营台：`https://你的域名/admin/` 

详见 [docs/微信云托管-所需资料清单.md](docs/微信云托管-所需资料清单.md)。

## 仓库

GitHub：https://github.com/YeahZac/Xwen_Alllink.git
