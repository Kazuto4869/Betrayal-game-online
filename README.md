# 🏚️ Betrayal at House on the Hill (2E Web Online)

> **Browser-based online multiplayer adaptation of the legendary board game *Betrayal at House on the Hill* (2nd Edition) — Built with TypeScript, React, Node.js, and WebSockets.**

[![Status](https://img.shields.io/badge/status-M2_Complete_%2F_M3_In_Progress-yellow.svg)](#-tình-trạng-dự-án-hiện-tại)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Tests-304%20passed-brightgreen.svg)](https://vitest.dev/)

---

## 📖 Giới thiệu dự án

Dự án hướng đến việc số hóa trọn vẹn trải nghiệm của board game kinh điển **Betrayal at House on the Hill (Phiên bản 2 - 2nd Edition)** để có thể chơi trực tiếp qua trình duyệt mà không cần cài đặt phần mềm bên ngoài. Dự án tuân theo định hướng **"2E First, 3E Ready"** — hoàn thiện và ổn định toàn bộ luật 2nd Edition trước khi mở rộng hỗ trợ 3rd Edition.

### Đặc trưng kiến trúc:
- **Zero-desync State Machine**: Server là nguồn chân lý duy nhất (*Authoritative State*). Logic game nằm trong core engine hàm thuần (*pure functions*), RNG nằm trong state, giúp việc tua lại replay và khôi phục khi server gặp sự cố (*crash recovery*) đạt độ chính xác 100%.
- **Single Process / Zero Reverse-proxy Deployment**: 1 container/tiến trình Node.js duy nhất phục vụ cả WebSocket endpoint (`/ws`), REST API (`/api/content`, `/healthz`) và static web bundle (React).
- **TypeScript Monorepo**: Toàn bộ luồng dữ liệu từ Server tới Client được kiểm soát chặt chẽ bằng schema Zod và typecheck tĩnh.

---

## 📂 Cấu trúc Repository

```text
Betrayal-game-online/
├── INSTRUCTION.md                 # Hướng dẫn chi tiết khởi chạy và test game
├── Plan/                          # Kế hoạch phát triển tổng thể (Master Build Plan)
│   └── BETRAYAL_2E_FIRST_3E_READY_MASTER_PLAN.md
│
├── betrayal-web/                  # ỨNG DỤNG WEB GAME CHÍNH
│   ├── packages/
│   │   ├── shared/                # Định nghĩa Types, Action, Event, Wire protocol (Zod schemas)
│   │   ├── content/               # Quản lý cấu trúc Characters, Tiles, Effects & Data loader
│   │   ├── engine/                # Core logic thuần: di chuyển, luật chơi, RNG, selector, reducer
│   │   ├── server/                # WebSocket Gateway, Quản lý phòng (RoomManager), Static hosting
│   │   └── client/                # Giao diện người dùng (React 19 + Vite + CSS variables)
│   ├── content/                   # Dữ liệu 2E chuẩn (characters.json, tiles.json)
│   └── docs/                      # Tài liệu thiết kế kỹ thuật chi tiết (01 đến 11)
│
└── [Reference Projects]           # Các dự án tham khảo mã nguồn & dữ liệu gốc 2E
    ├── betrayal-grapesalad-legacy # Angular legacy clone (nguồn game-data.json, tile images)
    ├── betrayal-alpht-reference   # Node/socket implementation tham khảo
    ├── betrayal-pupriku-reference # Web implementation tham khảo
    └── game-design-agent-skills   # Bộ tài liệu thiết kế gameplay cơ chế
```

---

## 📊 Tình trạng dự án hiện tại (Development Status)

Dự án hiện đã hoàn tất xong toàn bộ nền tảng cốt lõi (**Milestone M0, M1, M2 & Phase 1-2 Master Plan**) và đang thực hiện **Milestone M3**:

### ✅ Đã hoàn thành 100%:
* **Hạ tầng Mạng & Đồng bộ (M0 - Spine)**:
  - WebSocket gateway, snapshot định kỳ, turn clock countdown, ping/pong tự hồi phục kết nối.
  - Action log lưu vết toàn bộ thao tác, tự khôi phục phòng khi server restart.
* **Sảnh chờ & Quản lý người chơi (M1 - Identity & Lobby)**:
  - Tạo phòng với mã code 5 ký tự ngẫu nhiên; vào phòng qua mã code.
  - Chọn nhân vật từ 12 nhà thám hiểm chuẩn 2E: tự động khóa khi nhân vật hoặc màu nhân vật (6 cặp màu) đã bị người khác chọn.
  - Tự động chuyển Host khi Host rớt mạng; tính năng bỏ phiếu loại bỏ người chơi treo máy lâu (`VOTE_REMOVE`).
  - Đã cấu hình hỗ trợ test solo (`MIN_PLAYERS = 1`) hoặc chơi nhóm chuẩn (`3 - 6 players`).
  - Chatbox phòng chờ và nhật ký ván đấu thời gian thực.
* **Bản đồ dinh thự & Di chuyển (M2 - House & Exploration)**:
  - Hệ thống bản đồ 3 tầng: Tầng hầm (Basement), Tầng trệt (Ground), Tầng trên (Upper).
  - Khám phá phòng mới: Bốc và đặt tile từ chồng bài phòng (Tile deck), tự động tính toán cửa mở hợp lệ.
  - Hộp thoại xoay phòng (Rotation prompt) khi lật phòng mới có nhiều hướng khớp cửa hợp lệ.
  - Giới hạn bước đi theo chỉ số Tốc độ (Speed), thuật toán tìm đường `getReachable` chống đi xuyên tường.
* **Di trú dữ liệu chuẩn 2E (Phase 1–2 Master Plan)**:
  - Đã trích xuất và chuẩn hóa 12 nhân vật 2E kèm track chỉ số từ GrapeSalad vào `content/characters.json`.
  - Đã chuẩn hóa 47 ô phòng 2E vào `content/tiles.json`.
* **Giao diện Trực quan (UI/UX Updates)**:
  - Bộ Icon và nhãn viết tắt chuẩn tránh nhầm lẫn: ⚡ **Spd** (Speed), ⚔️ **Mgt** (Might), 🧠 **San** (Sanity), 📖 **Knw** (Knowledge).
  - Bảng hiển thị 4 chỉ số và số bước đi còn lại (`👟 Moves left`) trực tiếp trong ván chơi.

---

### 🟨 Đang thực hiện (In Progress - M3):
- [x] Bộ thông dịch hiệu ứng (`Effect Interpreter` trong `packages/engine/src/effects.ts`).
- [ ] Chồng bài Biến cố (Event), Vật phẩm (Item), Điềm báo (Omen).
- [ ] Xúc xắc Betrayal (mặt 0, 1, 2) và cơ chế đổ xúc xắc kiểm tra chỉ số (Trait rolls).
- [ ] Cơ chế xúc xắc Điềm báo (Haunt roll) kích hoạt Ám ảnh.
- [ ] Quản lý túi đồ (Inventory) chứa Item và Omen.

---

### ⬜ Kế hoạch tiếp theo (Roadmap Ahead):
- **M4 — Ám ảnh & 5 Kịch bản đầu tiên (The Haunt)**: Ma trận xác định Kẻ phản bội (Haunt Matrix), sách sinh tồn, sách kẻ phản bội, quái vật, điều kiện thắng/thua.
- **M5 — Đánh bóng giao diện (Polish)**: Hoạt ảnh di chuyển mượt mà, tích hợp artwork thẻ bài/phòng, hiệu ứng âm thanh.
- **M6 — Hoàn thiện toàn bộ 50 Haunts**: Cung cấp đủ 50 kịch bản của Betrayal 2nd Edition.
- **Sau 2E — Mở rộng 3rd Edition (3E Ready)**: Bổ sung gói dữ liệu và luật riêng của 3rd Edition.

---

## 🚀 Hướng dẫn cài đặt & Khởi chạy

### 1. Yêu cầu môi trường
- **Node.js**: Phiên bản `>= 20.x`
- **npm**: Đi kèm với Node

### 2. Cài đặt Dependencies
Chuyển vào thư mục `betrayal-web` và chạy:
```bash
cd betrayal-web
npm install
```

### 3. Chạy ở chế độ Development (Khuyên dùng để test & code)
```bash
cd betrayal-web
npm run dev
```
> Lệnh này khởi động đồng thời cả **Backend WebSocket/REST** (`http://localhost:8080`) và **Frontend Vite HMR** (`http://localhost:5173`).

👉 **Mở trình duyệt truy cập:**
- Vào game: **[http://localhost:5173](http://localhost:5173)**
- Chế độ xem trước phòng & bàn cờ (Dev Board Preview): **[http://localhost:5173/#board-preview](http://localhost:5173/#board-preview)**

### 4. Chạy ở chế độ Production
```bash
cd betrayal-web
npm run build
npm start
```
> Truy cập: **[http://localhost:8080](http://localhost:8080)** (Server Node.js phục vụ toàn bộ client bundle và WebSocket trên một cổng duy nhất).

---

## 🧪 Kiểm tra chất lượng mã nguồn (Quality Assurance)

Tất cả các gói code đều có test coverage tự động và typecheck nghiêm ngặt:

```bash
cd betrayal-web

# Kiểm tra lỗi TypeScript toàn bộ 5 packages
npm run typecheck

# Chạy toàn bộ 304 unit & integration tests với Vitest
npm test

# Kiểm tra linting và ranh giới kiến trúc
npm run lint

# Format mã nguồn
npm run format
```

---

## 📜 Bản quyền & Nội dung (Copyright & Fair Use Notice)

- Toàn bộ kiến trúc và mã nguồn logic engine thuộc bản quyền của dự án.
- Tên gọi, nội dung thẻ bài, phòng ốc và kịch bản gốc của board game thuộc sở hữu trí tuệ của **Avalon Hill / Wizards of the Coast / Hasbro**.
- Dự án được xây dựng phi thương mại vì mục đích nghiên cứu, học tập và đam mê cộng đồng người chơi board game.
