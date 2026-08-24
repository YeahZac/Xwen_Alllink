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

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/login` | 邀请码登录 `{code}` |
| POST | `/api/auth/wx-login` | 微信快捷登录（演示） |
| GET | `/api/auth/profile` | 当前身份资料（需 Bearer Token） |
| POST | `/api/apply/submit` | 商户入驻申请 |
| GET | `/api/apply/status?phone=` | 查询入驻审核 |
| GET | `/api/banners?role=` | 广告 Banner |
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
| POST | `/api/admin/points-pool/grant` | 后台发放额度（演示） |
| GET | `/api/config/cash-rate` | 积分抵现汇率 |

统一响应：`{ code: 0, message: 'ok', data }`；失败 `code != 0`。

演示邀请码（种子数据）：`C001` 消费者 / `D001` 地摊 / `Y001` 异业 / `G001` 供应链。

## 微信云托管部署

1. 控制台创建环境 → 开通 **MySQL**  
2. 在 MySQL 中执行 `sql/01_schema.sql`、`sql/02_seed.sql`  
3. 创建服务，选择「通过 Dockerfile 部署」，上传本目录或关联本 Git 仓库  
4. 服务环境变量按 `.env.example` 配置（`DB_*` 用云托管内网地址）  
5. 发布后路径前缀建议：`/api`  

详见 [docs/微信云托管-所需资料清单.md](docs/微信云托管-所需资料清单.md)。

## 仓库

GitHub：https://github.com/YeahZac/Xwen_Alllink.git
