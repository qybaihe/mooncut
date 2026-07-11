# MoonCut Community Registry v1

这是一个由 EdgeOne 独立托管的只读能力注册表数据服务，不提供社区网页。正式入口为 `https://mc.classby.cn`；业务服务器不参与目录发现、能力包下载或包内文件读取。

## Pi 获取流程

1. 本地 Web 或 Pi 直接 `GET /registry/v1/catalog.json`，只显示 `official` / 已发布的条目。
2. 读取目标 release 的 `.mooncut-capability.json`，并校验该目录中 `manifest.json`、`SKILL.md`、`connector.json` 的 SHA-256。
3. 解析 manifest；仅接受 Pi 明确支持的 schema、kind、adapter、工具与权限。
4. 若 `connector.mode` 是 `builtin-adapter-reference`，只匹配 Pi 本地已审核的 adapter；绝不运行下载包中的脚本。
5. 在 Pi 本地显示权限清单，完成确认后保存安装状态与 release hash。

## 信任模型

- 本 MVP 是官方、只读目录；不提供用户上传或第三方发布。
- SHA-256 用于检测传输/缓存错误，不替代发布者签名。
- 第三方发布开放前，目录必须升级为“离线签名的 release manifest + Pi 内置发布者公钥”，并增加审核和撤回机制。

## 为什么当前不用 KV / Blob

当前没有上传和动态写入，能力包本身就是版本化、不可变对象。直接把 `catalog.json` 和 release 文件作为 EdgeOne 的公开只读 Registry 数据源，可以获得 CDN 缓存、版本回滚和完整性校验，而不增加数据库或函数的写入面。

当开放投稿或后台审核时，再由 Edge Function 把发布元数据写入 KV、把 Skill/连接器包写入 Blob；本地 Web 和 Pi 的读取 API 可以保持不变。

## 文件约定

```text
/registry/v1/catalog.json
/registry/v1/packages/{slug}/{version}/manifest.json
/registry/v1/packages/{slug}/{version}/SKILL.md
/registry/v1/packages/{slug}/{version}/connector.json
/registry/v1/packages/{slug}/{version}/{slug}.mooncut-capability.json
```
