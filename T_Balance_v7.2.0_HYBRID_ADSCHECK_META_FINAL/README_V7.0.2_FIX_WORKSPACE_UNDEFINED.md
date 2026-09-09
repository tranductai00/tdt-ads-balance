# T Balance v7.0.2 — Fix `workspace is not defined`

## Nguyên nhân
Trong refactor v7.0 Meta-only, ba biến request-scoped của `metaBridge` bị xóa nhầm:

- `workspace`
- `syncKey`
- `deviceName`

Các action `deviceStatus`, `workspaceGet`, `workspaceSet`, Meta API/Billing và sửa TKQC vẫn dùng các biến này nên request đầu tiên có thể dừng bằng `ReferenceError: workspace is not defined`.

## Sửa trong v7.0.2
Khôi phục việc lấy ba giá trị từ body/query/header ngay sau khi action được kiểm tra:

```js
const workspace = normalizeWorkspace(body.workspace || req.query.workspace);
const syncKey = String(body.syncKey || req.query.key || "");
const deviceName = String(body.deviceName || req.headers["x-device-name"] || "").trim().slice(0, 80);
```

Không thay đổi schema PostgreSQL/Neon và không cần migration.

## Deploy
Redeploy source v7.0.2 lên Vercel. Sau deploy nên hard refresh trình duyệt một lần.

Kiểm tra:

- `/api/healthz`
- mở trang chính
- `Meta API -> Kiểm tra kết nối`
- `Meta API -> Đồng bộ TKQC ngay`

