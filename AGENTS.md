# AGENTS.md — Kei Desktop Pet (Pure Ambient)

Hướng dẫn cho agent/dev tiếp theo làm việc trên project này.

## 1. Mục tiêu & giới hạn

- **Desktop pet 3D thụ động** dùng `Kei.glb` (Blue Archive, chibi, có sẵn xương + animation).
- Cửa sổ **trong suốt, không viền, luôn nổi**, phần trống **click xuyên qua** desktop.
- **Không có tính năng game chiến đấu**: bỏ mode Combat, đuổi chuột, EX Skill. Chỉ còn đi dạo / ngồi / biểu diễn.
- **Không thêm background, ảnh, âm thanh, asset ngoài**: mọi thứ dùng animation trong `.glb` hoặc vẽ bằng code (CSS/canvas, emoji).
- Chạy **offline hoàn toàn**. Mic dùng Web Speech API của Chromium (cần mạng cho dịch giọng nói) và chỉ là tuỳ chọn.

## 2. Chạy

```bash
npm install
npm start
```

`Esc` (khi Kei đang focus) hoặc Ctrl+C ở terminal để thoát. Mở DevTools bằng `--remote-debugging-port=9222` nếu cần test.

## 3. Cấu trúc

| File | Vai trò |
| --- | --- |
| `main.js` | `BrowserWindow` transparent/frameless/always-on-top (`screen-saver`), click-through mặc định, `pet://` protocol, IPC `pet:ignore-mouse` / `pet:quit` / `pet:load-settings` / `pet:save-settings`, cấp quyền `media` cho mic. |
| `preload.js` | `contextBridge` → `window.pet` (4 hàm). Không bật `nodeIntegration`. |
| `index.html` | Canvas `#fx`, bubble MomoTalk, HUD + nút mic/⚙️, radial menu 5 nút, panel cài đặt, importmap three.js. |
| `renderer.js` | Toàn bộ engine: toon/outline, sanitizer, bone rig, FSM, vật lý, menu, ghost, mic, settings. |
| `Kei.glb` | Model gốc. **Không sửa/không bake lại**. |

## 4. Visual & model

- **Toon**: PBR → `MeshToonMaterial`, gradient `DataTexture` 3 bậc (`NearestFilter`), `NoToneMapping`, tổng sáng ~1.0 (ambient 0.58 + key 0.42 + fill 0.16).
- **Outline**: `OutlineEffect` viền đen; **tắt** cho halo, miệng/mắt (`alphaTest > 0`).
- **Halo**: nhận theo tên chứa `halo`, tách vào `HaloPivot`, phát sáng emissive, nhấp nhô `sin(t) * 0.012`.
- **Ẩn vũ khí**: tên mesh khớp `/(weapon|gun|railgun|drone|rifle|sword|prop)/i` bị `visible = false`; lưu danh sách để menu bật/tắt.
- **Sanitizer**: bỏ clip rỗng hoặc tên chỉ là số (`"5."`), lọc track theo tiền tố node (cả tên gốc và `PropertyBinding.sanitizeNodeName`). Log số clip/track thật ra console.
- **Chuẩn hoá**: đo bbox **bỏ qua mesh vũ khí**, scale cao 1.90u, chân tại `y = 0` của `rig`. Bản export hiện tại: scale ≈ 1.558, rộng thân ≈ 0.99u, 2 mesh vũ khí.
- **Size**: `SIZE_STEPS = [0.82, 1.0, 1.2]` áp lên `rig.scale`; `limitX` tính lại theo bề rộng thân.

## 5. Bone rigging (`bones`)

Tìm sau khi load, log ra console:

`head` = `Bip001_Head`, `neck` = `Bip001_Neck`, `pelvis` = `Bip001_Pelvis`, `spine` = `Bip001_Spine`, `thighL/R` = `Bip001_L/R_Thigh`, `calfL/R` = `Bip001_L/R_Calf`.

**Quan trọng**: `updateProcedural()` chạy **sau** `mixer.update(dt)` trong `frame()`, vì mixer ghi đè pose mỗi frame.

- **Head tracking**: khi `IDLE`/`SIT`, con trỏ cách đầu < `CONFIG.headTrackRadius = 2.5`; yaw/pitch nội suy `damp()`, giới hạn ±0.42 / ±0.24 rad; nhân offset vào quaternion local của `head` (0.7) và `neck` (0.25).
- **SIT pose**: `sitWeight` lerp 0→1; hạ `model.position.y` 0.16; xoay thigh ±1.3 rad, calf ∓1.45 rad + đung đưa `sin(time*2.4 ± π)`; vẫn loop `Cafe_Idle` để giữ nhịp thở/chớp mắt.
- **Trục local lệch**: `settings.sitAxis` (0..3 = z+, z−, x+, x−), đổi bằng phím **B**, nút trong settings, hoặc `__kei.cycleSitAxis()`.

## 6. FSM

`IDLE | WALK | SIT | DRAG | FALL | DEAD | ACTION`

- `IDLE`: `Cafe_Idle` + biến thể `Formation_Idle_Random`, `Public01`, `Public01_Random`.
- `WALK`: `Cafe_Walk`, tốc độ `settings.walkSpeed`, chạm mép thì quay đầu.
- `SIT`: procedural pose, tự đứng sau 70–110s nếu không bị khoá.
- `DRAG`: `Formation_Idle`; thả nhẹ → reaction; lắc mạnh → `Vital_Panic`; còn lại → `FALL`.
- `FALL`: trọng lực −18, nảy mép `-0.52`, va mạnh/rơi cao → `DEAD`.
- `DEAD`: `Vital_Death` (clamp), nghỉ 2s rồi tự đứng dậy.
- `ACTION`: reaction / victory / panic, kết thúc bằng `scheduleIdle()`.

**Hai timer tách biệt**: `idleTimer` (chuyển action → idle) và `restTimer` (nhắc nghỉ 30 phút). Không gộp lại.

Hành vi tự động (`planBehaviour`, 3.5–8s):
- IDLE + không tương tác > 28s → ưu tiên SIT.
- IDLE → 38% đi dạo, 55% idle biến thể.
- WALK → 45% dừng (`enterIdle`) + tự nói sau 1.6s.
- Menu/settings đang mở hoặc ghost → tạm dừng hành vi.
- `walkLocked` chặn đi dạo; `sitLocked` giữ Kei ngồi.

## 7. Chuột & UI

- **Click-through**: raycast `rig` (bỏ qua object invisible), chỉ gọi IPC khi trạng thái đổi. Vùng 2 nút mic/⚙️ của HUD vẫn được tính là UI để hover vào là HUD hiện ra.
- **Xoa đầu**: tích luỹ quãng ngang ≥150px trong 1s, ≥2 lần đổi hướng, chỉ ở vùng đầu; cooldown 3s → `Cafe_Reaction` + tim/nốt nhạc + bubble.
- **Kéo/thả**: giữ offset điểm nắm, velocity làm mượt → quán tính; nảy 2 mép; chết/rơi cao → `Vital_Death`.
- **Ghost**: giữ **Alt** (hoặc bật "Luôn né chuột") → canvas opacity 0.42 + luôn click-through. Panel cài đặt **vẫn bấm được** khi ghost để không bị kẹt.
- **Radial menu**: chuột phải lên Kei, 5 nút cách tâm 88px: Ngồi/Đứng, Khoá vị trí/Đi dạo, Biểu diễn, Hiện/Ẩn vũ khí, Cỡ. Nút khi menu đóng có `pointer-events: none`.
- **Bubble**: neo vào xương đầu qua `project(camera)`, tự clamp trong màn hình; dùng cho click/xoa đầu/ngã/nghỉ/tự nói.
- **Phím**: `S` settings, `M` mic, `B` trục ngồi, `1` ngồi/đứng, `2` khoá đi dạo, `3` biểu diễn, `4` vũ khí, `5` cỡ, `Esc` đóng UI/thoát.

## 8. Mic & settings

- **Mic**: `SpeechRecognition`/`webkitSpeechRecognition`, `continuous = true`, `interimResults = false`, ngôn ngữ `vi-VN` / `ja-JP` / `en-US`.
- Lệnh thoại cục bộ: ngồi, đứng dậy, đi dạo, dừng lại, biểu diễn, vũ khí, to/nhỏ hơn, nghỉ, im lặng/tự nói. **Không có chat/API**; câu không khớp thì Kei trả lời gợi ý.
- `onend` tự restart khi mic còn bật; lỗi `not-allowed` / `service-not-allowed` tự tắt; lỗi `network` chỉ báo một lần.
- **Settings** lưu tại `app.getPath('userData')/settings.json` qua IPC (không dùng localStorage):
  `micLang`, `selfTalk`, `restMinutes` (5–180), `walkSpeed` (0.35–1.6), `sizeIndex` (0–2), `ghostAlways`, `showWeapon`, `sitAxis`.
- Panel: mic toggle + ngôn ngữ, tự nói, nhắc nghỉ, tốc độ đi, kích thước, luôn né chuột, nút đổi trục ngồi.

## 9. Tự nói / nhắc nghỉ

- `SELF_TALK`: `random`, `idleLong`, `afterWalk`, `afterSit` (dự phòng), `afterDeath`, `afterVictory`.
- `planSelfTalk()` 90–180s; chỉ nói khi `IDLE`, không đè bubble, cách câu trước ≥45s; `settings.selfTalk` tắt được.
- `queueSelfTalk(key, delay)` thử lại mỗi 0.5s tối đa 6 lần (dùng cho sự kiện vừa xong).
- `scheduleRest()` mặc định 30 phút → bubble nhắc nghỉ + tim; nếu đang kéo/rơi thì hoãn 60s.

## 10. Đã kiểm chứng (chạy app thật + DevTools protocol)

- 32/32 clip load sạch, 0 track lỗi, 0 exception/console.error.
- 8 bone tìm đủ; 2 mesh vũ khí ẩn mặc định; toggle hiện/ẩn qua menu đúng.
- SIT: `sitWeight ≈ 1`, hạ thân ~0.16u, `Cafe_Idle` loop; đứng dậy trở về IDLE.
- Head tracking: yaw ≈ 0.31 rad khi trỏ lệch 60px.
- Radial menu mở bằng contextmenu, đủ 5 nút, click Ngồi → SIT, nhãn đổi theo trạng thái.
- Hover vùng nút ⚙️ khi HUD ẩn → HUD hiện + interactive; nút menu khi đóng không chặn hit-test.
- Ghost Alt: opacity 0.42, interactive false; thả Alt trở lại true. Bật/tắt "Luôn né chuột" trong panel không bị kẹt.
- Xoa đầu → `Cafe_Reaction` + 10 hạt; kéo/thả → `FALL` → `DEAD/Vital_Death` → tự dậy.
- Settings lưu/đọc lại qua reload đúng; reset về mặc định đúng.
- Mic parser: `ngồi xuống` → SIT, `đứng dậy` → IDLE, `biểu diễn` → Victory_Start.
- ~61 FPS.

**Chưa kiểm được bằng máy**: chất lượng hình (độ dày outline, độ sáng, tư thế ngồi có đúng trục không), hành vi click-through ở tầng OS, và nhận giọng nói thật (cần micro + quyền + mạng). Trục ngồi có thể phải bấm **B** để chọn đúng hướng.

## 11. Quy ước

- Comment tiếng Việt, code/định danh tiếng Anh.
- Không thêm dependency nếu một hàm ngắn làm được.
- Mọi thay đổi hình ảnh/cảm giác chỉnh trong `CONFIG` hoặc `DEFAULT_SETTINGS`, tránh số magic rải rác.
- Sau khi sửa: chạy lại `npm start`, console phải có `[Kei] Animation: 32/32 ...`, `[Kei] Bones: ...` đủ 8 xương và không có exception.
