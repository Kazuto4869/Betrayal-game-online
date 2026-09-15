# Hướng Dẫn Khởi Chạy Và Thử Nghiệm Dự Án (Betrayal Web)

Tài liệu hướng dẫn chi tiết cách cài đặt, khởi chạy server, client và cách test game Betrayal at House on the Hill (2nd Edition).

---

## 1. Cấu trúc thư mục dự án

Toàn bộ mã nguồn chạy web game nằm trong thư mục:
```bash
Betrayal-game-online/betrayal-web/
```

Các thư mục khác (`betrayal-grapesalad-legacy`, `betrayal-alpht-reference`, v.v.) là tài liệu tham khảo và dữ liệu gốc cũ.

---

## 2. Yêu cầu môi trường

- **Node.js**: Phiên bản `>= 20` (khuyên dùng Node 20 LTS hoặc 22 LTS).
- **npm**: Đi kèm với Node.

Kiểm tra:
```bash
node -v
npm -v
```

---

## 3. Cài đặt Dependencies

Trước khi chạy lần đầu, hãy chuyển vào thư mục `betrayal-web` và cài đặt:

```bash
cd betrayal-web
npm install
```

---

## 4. Các cách khởi chạy

### Cách 1: Chế độ Development (`npm run dev` - Khuyên dùng khi phát triển/test)

Chỉ cần chạy 1 lệnh duy nhất:

```bash
cd betrayal-web
npm run dev
```

**Cơ chế hoạt động:**
- Lệnh này sử dụng `concurrently` để chạy song song 2 tiến trình:
  1. **Backend Server** (Node.js/tsx watch) lắng nghe tại: `http://localhost:8080` (WebSocket endpoint `/ws`, REST `/api/content`, `/healthz`).
  2. **Frontend Client** (Vite + React) chạy tại: `http://localhost:5173`.
- Vite đã được cấu hình proxy tự động chuyển tiếp các request `/ws`, `/api`, `/healthz` sang port 8080.
- Hỗ trợ **Hot Module Replacement (HMR)**: Khi bạn sửa code giao diện hoặc server, app tự reload ngay lập tức.

👉 **Địa chỉ truy cập trình duyệt:**
- **Vào game chính**: [http://localhost:5173](http://localhost:5173)
- **Chế độ xem trước bàn cờ (Dev Board Preview)**: [http://localhost:5173/#board-preview](http://localhost:5173/#board-preview) (dùng để soi các ô phòng, layout tầng hầm/tầng 1/tầng 2 mà không cần tạo phòng).

---

### Cách 2: Chế độ Production (`npm run build && npm start`)

Dành cho lúc triển khai thực tế hoặc muốn chạy 1 tiến trình duy nhất:

```bash
cd betrayal-web
npm run build
npm start
```

**Cơ chế hoạt động:**
- Build toàn bộ mã nguồn TypeScript của cả server và client ra bundle tĩnh (`dist`).
- Node.js server tại port `8080` sẽ phục vụ cả trang web tĩnh (SPA HTML/CSS/JS) lẫn WebSocket và API.

👉 **Địa chỉ truy cập trình duyệt:**
- [http://localhost:8080](http://localhost:8080)

---

## 5. Hướng dẫn Test game

Hiện tại game đã được thiết lập **tối thiểu 1 người chơi** (`MIN_PLAYERS = 1`) để bạn có thể test solo trực tiếp một mình cực kỳ nhanh chóng:

1. **Test 1 mình (Solo dev test):**
   - Mở trình duyệt tại [http://localhost:5173](http://localhost:5173).
   - Nhập tên của bạn (ví dụ: `Player 1`).
   - Bấm **Create a game**.
   - Vào Lobby, click chọn 1 nhân vật bất kỳ.
   - Nút **Start game** sẽ sáng lên ngay lập tức 👉 bấm vào để bắt đầu vào khám phá dinh thự!

2. **Test nhiều người chơi (Multiplayer test):**
   - Mở thêm cửa sổ **Ẩn danh (Incognito Window)** hoặc trình duyệt khác.
   - Nhập mã phòng 5 chữ cái (Room Code) để Join.
   - Mỗi người chọn 1 nhân vật (hệ thống tự động cấm chọn trùng nhân vật và cấm trùng màu).
   - Host bấm **Start game**.

---

## 6. Dữ liệu phòng & thẻ bài (Content)

- Dữ liệu game hiện được tải tự động từ thư mục [`betrayal-web/content/`](content/) (`characters.json` và `tiles.json`).
- Nếu muốn xuất lại dữ liệu từ source cũ `betrayal-grapesalad-legacy`, chạy lệnh:
  ```bash
  cd betrayal-web
  npm run content:migrate:2e -- --source ../betrayal-grapesalad-legacy/game-data.json --output content
  ```

---

## 7. Các lệnh kiểm tra chất lượng code (QA / CI)

| Lệnh | Ý nghĩa |
| :--- | :--- |
| `npm run typecheck` | Kiểm tra lỗi type TypeScript trên toàn bộ 5 packages |
| `npm test` | Chạy toàn bộ 304 unit & integration tests với Vitest |
| `npm run lint` | Chạy ESLint kiểm tra cú pháp và quy tắc phân tầng kiến trúc |
| `npm run format:check` | Kiểm tra định dạng code với Prettier |
| `npm run clean` | Xóa sạch thư mục build `dist` |
