# 媒体源文件（不进小程序包）

`banners/`、`covers/`、`legal/` 已从 `miniprogram/assets` 移出，避免预览/上传超 2MB。

线上展示地址见 `miniprogram/utils/cdn-manifest.js`（腾讯云 COS / 云存储公网 URL）。

重新上传到 COS 后，同步改 `cdn-manifest.js` 与 `src/services/catalogService.js` 中的 `MP_STATIC` 映射，并执行 `sql/29_cdn_media_backfill.sql`。
