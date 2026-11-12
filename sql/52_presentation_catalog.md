# 呈现演示目录（临时）

**不要**在 `ensureSchema` 里用本说明文件当 SQL 执行。演示数据由服务：

`src/services/presentationCatalogService.js`

在启动时幂等写入（`merchant_no` 前缀 `PRES_`，商品 `data_source=presentation`）。
目录版本见 `home_presentation_catalog_version`；升版本会自动刷新店名/封面/菜品图，旧菜名软删。

## 一键改回「必须进件才上首页」

```http
POST /admin/ops/presentation/mode
{ "enabled": false, "confirm": "REVERT_PRESENTATION" }
```

或环境变量强制：`HOME_PRESENTATION_RELAX=0`

## 一键清除演示门店/商品

```http
POST /admin/ops/presentation/purge
{ "confirm": "PURGE_PRESENTATION" }
```

## 一键重新播种

```http
POST /admin/ops/presentation/seed
{ "confirm": "SEED_PRESENTATION" }
```

## 状态

```http
GET /admin/ops/presentation/status
```

呈现模式**只改 C 端列表可见性**，不绕过支付/上架的进件校验。`sql/51_purge_test_placeholder_goods.sql` **不会**清 `presentation` 来源。
