# Migration v5.8.6 → v6.0

## Hạ tầng đã thay

| Trước | v6.0 |
|---|---|
| Firebase Hosting / Functions | Vercel Express Function |
| Firestore | PostgreSQL / Neon |
| Firebase Admin credentials | `DATABASE_URL` |
| Firebase Cloud Messaging | Web Push VAPID |
| `cloudfunctions.net` endpoint | Cùng domain Vercel |

## Giữ tương thích

- Workspace id và cấu trúc payload nghiệp vụ giữ nguyên.
- Tên action của `/outlookBridge` giữ nguyên.
- Device key, pairing code, multi-device và conflict merge giữ nguyên.
- Các collection logic cũ được ánh xạ thành document path trong bảng PostgreSQL `tb_documents`.
- Extension v6.0 dùng URL Vercel do người dùng nhập, không hard-code server.

## Không tự sao chép từ Firebase

Bản v6.0 không chứa Firebase SDK/credential nên không đọc Firestore cũ. Đây là chủ ý để runtime hoàn toàn độc lập Firebase.

Dữ liệu local browser có thể tự seed cloud mới khi workspace PostgreSQL còn trống. Các token OAuth/server secret cần kết nối lại.
