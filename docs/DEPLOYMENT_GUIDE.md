# 🚀 Hướng dẫn Triển khai (Deployment Guide) — Betrayal at House on the Hill Online

Tài liệu này hướng dẫn chi tiết cách đưa dự án game **Betrayal at House on the Hill (2E Web Online)** lên môi trường mạng Internet công cộng để bạn và bạn bè có thể truy cập chơi cùng nhau ở bất kỳ đâu.

---

## 🧭 Hiểu về Kiến trúc Triển khai (Architecture Overview)

Game Betrayal Online được xây dựng với 2 thành phần chính:
1. **Frontend Web App (`@bahoth/client`)**: Giao diện người dùng React 19 + Vite, hiển thị bàn cờ, xúc xắc, thẻ bài, túi đồ và âm thanh.
2. **Backend Game Engine & WebSocket Gateway (`@bahoth/server`)**: Máy chủ Node.js duy trì trạng thái ván đấu trong RAM (`RoomManager`), xử lý kết nối WebSocket hai chiều thời gian thực (`/ws`), đồng bộ hành động và ghi log ván đấu.

> [!IMPORTANT]
> **Lưu ý then chốt về Vercel:**
> - **Vercel** là nền tảng Serverless / Static Edge CDN hàng đầu thế giới, rất lý tưởng và siêu tốc để phục vụ ứng dụng **Frontend React SPA**.
> - Tuy nhiên, Vercel Serverless Functions **không hỗ trợ duy trì kết nối WebSocket liên tục (Persistent Stateful WebSocket)**. Khi người chơi kết nối vào game, kết nối WebSocket cần được giữ sống liên tục hàng giờ.
> - **Chiến lược khuyên dùng:**
>   - **Mô hình A (Khuyên dùng khi muốn dùng Vercel)**: **Frontend** chạy trên **Vercel** (miễn phí, CDN toàn cầu siêu nhanh), **Backend WebSocket** chạy trên **Render.com** hoặc **Railway** (nền tảng container persistent miễn phí).
>   - **Mô hình B (All-in-One đơn giản nhất)**: Triển khai cả Frontend và Backend gói gọn trong 1 tiến trình Node.js duy nhất trên **Render.com** / **Railway** / **Fly.io** / **VPS** (sử dụng kiến trúc *Zero Reverse-Proxy* có sẵn của repo).

---

## 🌟 Mô hình A: Frontend trên Vercel + Backend trên Render (Miễn phí 100%)

### Bước 1: Triển khai Backend WebSocket lên Render.com

1. Đăng ký tài khoản miễn phí tại [Render.com](https://render.com/) (đăng nhập bằng GitHub).
2. Tại bảng điều khiển Render, nhấn **New +** ➔ Chọn **Web Service**.
3. Kết nối với kho lưu trữ GitHub của bạn: `Betrayal-game-online`.
4. Điền các thông số cấu hình:
   - **Name**: `betrayal-game-server` (hoặc tên tuỳ ý).
   - **Region**: Singapore (Southeast Asia) hoặc Frankfurt / Oregon (chọn vùng gần bạn nhất để ping thấp).
   - **Root Directory**: `betrayal-web`
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm run build
     ```
   - **Start Command**:
     ```bash
     npm start
     ```
   - **Instance Type**: `Free` (Miễn phí).
5. Mở mục **Advanced** ➔ Thêm các biến môi trường (**Environment Variables**):
   - `PORT` = `8080`
   - `NODE_ENV` = `production`
6. Nhấn **Create Web Service**.
7. Chờ Render build và triển khai (khoảng 2-3 phút). Khi hoàn tất, Render sẽ cấp cho bạn một domain HTTPS, ví dụ:
   ```text
   https://betrayal-game-server.onrender.com
   ```
   👉 **URL WebSocket Backend của bạn sẽ là:**
   ```text
   wss://betrayal-game-server.onrender.com/ws
   ```
   *(Kiểm tra máy chủ đã online bằng cách mở trình duyệt vào: `https://betrayal-game-server.onrender.com/healthz` ➔ Trả về `{"ok":true}`)*.

---

### Bước 2: Triển khai Frontend lên Vercel

Dự án đã được cấu hình sẵn file `betrayal-web/vercel.json` để tự động hóa toàn bộ quy trình build.

1. Đăng nhập vào [Vercel](https://vercel.com/) (bằng tài khoản GitHub).
2. Nhấn nút **Add New...** ➔ Chọn **Project**.
3. Tìm và chọn repository `Betrayal-game-online` ➔ Nhấn **Import**.
4. Trong phần **Configure Project**:
   - **Project Name**: `betrayal-game` (hoặc tên bạn thích).
   - **Root Directory**: Bấm nút **Edit** và chọn thư mục `betrayal-web` ➔ Bấm **Continue**.
   - **Framework Preset**: Chọn `Vite` (hoặc để `Other`, Vercel sẽ tự nhận diện theo `vercel.json`).
5. Mở mục **Environment Variables** và thêm biến môi trường kết nối WebSocket tới Backend ở Bước 1:
   - **Key**: `VITE_WS_URL`
   - **Value**: `wss://betrayal-game-server.onrender.com/ws` *(thay bằng domain Render thực tế của bạn)*
6. Nhấn nút **Deploy**!
7. Vercel sẽ tự động build các gói `shared`, `content` và bundle `client` trong vòng dưới 1 phút.
8. Sau khi deploy thành công, bạn sẽ nhận được đường link chơi game chính thức, ví dụ:
   ```text
   https://betrayal-game.vercel.app
   ```

---

## ⚡ Mô hình B: Triển khai All-in-One trên Render / Railway / VPS (1-Click)

Nếu bạn không muốn quản lý 2 dịch vụ riêng biệt, dự án hỗ trợ chế độ **Single Process Production**: Server Node.js vừa quản lý WebSocket vừa tự host các file tĩnh của React.

### Cách làm trên Render:
1. Tạo Web Service mới trỏ vào repo như Bước 1 ở trên.
2. Build Command: `npm run build`
3. Start Command: `npm start`
4. Biến môi trường: `PORT=8080`, `NODE_ENV=production`.
5. Truy cập trực tiếp vào domain do Render cấp (`https://betrayal-game-server.onrender.com`). Web client sẽ hiển thị ngay lập tức và tự động kết nối WebSocket trên cùng domain!

### Cách chạy bằng Docker trên VPS riêng:
Nếu bạn có VPS Ubuntu/Debian (DigitalOcean, AWS, Linode, Hetzner...):
```bash
git clone https://github.com/Kazuto4869/Betrayal-game-online.git
cd Betrayal-game-online/betrayal-web
npm install
npm run build
PORT=8080 npm start
```
Cài đặt Nginx hoặc Caddy làm reverse proxy với SSL Let's Encrypt là xong.

---

## 🛠️ Danh mục Biến môi trường (Environment Variables Reference)

### Cấu hình Frontend (Vercel):
| Tên biến | Bắt buộc | Ví dụ | Ý nghĩa |
| :--- | :---: | :--- | :--- |
| `VITE_WS_URL` | Có (khi tách backend) | `wss://my-server.onrender.com/ws` | Địa chỉ WebSocket server mà client sẽ kết nối tới. Nếu bỏ trống, client sẽ mặc định kết nối tới cùng domain hiện tại. |

### Cấu hình Backend (Render / VPS):
| Tên biến | Mặc định | Ý nghĩa |
| :--- | :---: | :--- |
| `PORT` | `8080` | Cổng HTTP & WebSocket lắng nghe |
| `NODE_ENV` | `production` | Chế độ môi trường Node |
| `CONTENT_DIR` | `./content` | Đường dẫn chứa dữ liệu kịch bản, thẻ bài, nhân vật |
| `DATA_DIR` | `./data` | Nơi lưu trữ nhật ký ván đấu JSONL để tự khôi phục phòng |
| `ROOM_TTL_HOURS` | `4` | Số giờ giải phóng phòng không có hoạt động |
| `TURN_TIMEOUT_SECONDS` | `600` | Thời gian tối đa cho 1 lượt người chơi (10 phút) |
| `DISCONNECT_TIMEOUT_SECONDS`| `90` | Thời gian chờ khi người chơi ngắt kết nối |

---

## 🔍 Kiểm tra & Khắc phục sự cố (Troubleshooting Checklist)

1. **Lỗi `WebSocket connection to 'wss://...' failed` trên Vercel:**
   - Kiểm tra xem bạn đã thêm biến `VITE_WS_URL` trong mục **Settings ➔ Environment Variables** của Vercel chưa.
   - Lưu ý: URL phải bắt đầu bằng `wss://` (nếu trang web là `https://`) và kết thúc bằng `/ws`.
   - Sau khi sửa biến môi trường trên Vercel, hãy vào tab **Deployments** và chọn **Redeploy** để build lại bundle client với biến môi trường mới.

2. **Backend trên Render bị "ngủ" (Sleep after inactivity):**
   - Render gói Free sẽ tự động tạm dừng dịch vụ sau 15 phút không có truy cập.
   - Khi có người chơi truy cập lần đầu tiên, server sẽ mất khoảng 30 - 50 giây để khởi động lại (Cold Start).
   - *Mẹo*: Bạn có thể dùng các dịch vụ ping miễn phí như [UptimeRobot](https://uptimerobot.com/) ping vào URL `https://your-server.onrender.com/healthz` 10 phút một lần để giữ server luôn thức suốt 24/7!

3. **CORS hoặc Mixed Content:**
   - Nếu Frontend chạy HTTPS (`https://betrayal-game.vercel.app`), Backend bắt buộc phải chạy HTTPS/WSS (`wss://...`). Không được dùng `ws://` không mã hóa trên trang HTTPS.
