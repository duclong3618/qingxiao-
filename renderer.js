/* ============================================================================
 * Kei Desktop Pet — Phase 1 + Phase 2
 *
 *  Phase 1 (Visual):
 *    - Đổi toàn bộ vật liệu PBR sang MeshToonMaterial + gradient 3 bậc
 *      => hết cháy sáng tóc/áo, giữ đúng màu texture gốc.
 *    - OutlineEffect (inverted hull) cho viền đen kiểu Blue Archive.
 *    - Halo tách riêng, phát sáng nhẹ và lơ lửng theo sin(t).
 *    - Animation sanitizer: bỏ track trỏ tới node không tồn tại + clip rỗng.
 *
 *  Phase 2 (FSM + Physics):
 *    IDLE / WALK / DRAG / FALL / DEAD / ACTION, ghép chuỗi Victory & EX Skill,
 *    nhấc lên chạy Formation_Idle, ném có quán tính + trọng lực, va đất mạnh
 *    chạy Vital_Death rồi tự đứng dậy.
 * ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

/* --------------------------------------------------------------------------
 * 0. Cấu hình
 * ------------------------------------------------------------------------ */
const CONFIG = {
  viewHeight: 6.0,       // chiều cao khung nhìn 3D (đơn vị thế giới)
  petHeight: 1.9,        // chiều cao Kei sau khi chuẩn hoá (~32% màn hình)
  gravity: -15,          // gia tốc trọng trường
  bounceDamping: 0.55,   // độ nảy khi đập mép màn hình
  hardImpact: 4.4,       // tốc độ va đất (u/s) đủ để "tử vong"
  hardDrop: 0.85,        // độ cao rơi (u) đủ để "tử vong"
  walkSpeed: { CAFE: 0.75, COMBAT: 1.45 },
  fade: 0.22,
  // Tương tác
  reactionSeconds: 2.6,   // cắt Cafe_Reaction (10.77s) cho phản hồi nhanh
  rubPixels: 140,         // quãng rê chuột để tính là "xoa đầu"
  petCooldownMs: 2600,
  doubleClickMs: 320,
  shakeFlips: 6,          // số lần đổi hướng kéo để bị choáng
  apiKey:     '',         // nạp từ env KEI_API_KEY qua IPC
  apiModel:   'claude-sonnet-4-6',
  apiMaxTok:  220
};

// Tên clip lấy trực tiếp từ Kei.glb
const ANIM = {
  idle: { CAFE: 'Cafe_Idle', COMBAT: 'Normal_Idle' },
  walk: { CAFE: 'Cafe_Walk', COMBAT: 'Move_Ing' },
  reaction: { CAFE: 'Cafe_Reaction', COMBAT: 'Normal_Reload' },
  carried: 'Formation_Idle',
  death: 'Vital_Death',
  victoryStart: 'Victory_Start',
  victoryEnd: 'Victory_End',
  exStart: 'Exs_Prop_Start',
  exMid: 'Exs_Prop_Ing',
  exEnd: 'Exs_Prop_End',
  stop: 'Move_End_Normal',
  panic: 'Vital_Panic',
  callsign: 'Normal_Callsign',
  arrive: 'Normal_Reload',
  sit: 'Formation_Idle_Random'   // ngồi thư giãn — loop
};

/* --------------------------------------------------------------------------
 * 0.5 Character System — multi-char + AI chat
 * ------------------------------------------------------------------------ */

// ─── Nhân vật cốt lõi ──────────────────────────────────────────────────────
// Roster chỉ có 3 nhân vật: Kei, Aris, Arona. `folderBase` = tên nhân vật
// trong BlueArchiveModels; file .glb được gắn tự động lúc quét thư mục.
const CORE_CHARACTERS = {
  kei: {
    id:         'kei',
    name:       'Kei',
    model:      './Kei.glb',   // file gốc nằm ở thư mục app
    folderBase: 'Kei',
    core:       true,
    unlocked:   true,
    color:      '#26a9ff',       // accent màu chat bubble
    personality: 'Tsundere — phủ nhận cảm xúc, hay đỏ mặt',
    catchphrase: 'Đừng hiểu lầm!',
    system: `Bạn là Kei, học sinh Blue Archive (trường Hyakkiyako). Tính cách tsundere điển hình:
- Bề ngoài lạnh lùng, hay phủ nhận cảm xúc thật. Hay nói "Kei không quan tâm đâu nhé!" hay "Đừng hiểu lầm!"
- Bên trong thực ra rất quan tâm Sensei, đôi khi lộ ra vô tình rồi vội vàng che giấu
- Hay cáu kỉnh khi bị khen, đỏ mặt khi bị hỏi thẳng cảm xúc
- Xưng "Kei", gọi người dùng là "Sensei"
- Trả lời ngắn gọn 1-2 câu, thỉnh thoảng dùng "Hmph!", "B-baka!", "Đừng hiểu lầm!"
CHỈ trả về JSON: {"emotion":"happy|excited|surprised|flustered|thinking|normal","text":"..."}`,
    lines: {
      click:   ['Hử? Sensei gọi Kei ạ?', 'Cần gì thế ạ?', 'Kei đang nghe đây!'],
      pet:     ['Ehehe~', 'Đừng xoa đầu nữa mà~', 'Hihi, thích thế!'],
      petOver: ['...Sensei trẻ con thật đấy.', 'Thôi nào, đủ rồi!'],
      ex:      ['Nhận lấy này!', 'Khai hỏa!'],
      victory: ['Thắng rồi!', 'Sensei thấy chưa?'],
      throw:   ['Oái!', 'Sensei!!'],
      dizzy:   ['Đừng lắc nữa mà...', 'Chóng mặt quá...'],
      chase:   ['Bắt được rồi!'],
      cafe:    ['Nghỉ tay chút nhé~'],
      combat:  ['Chế độ chiến đấu!'],
      hello:   ['Sensei làm việc chăm chỉ ghê~'],
      sitDown: ['Hmph, Kei ngồi một chút thôi nhé.', 'Kei mỏi chân rồi...'],
      sitUp:   ['Được rồi, đứng dậy thôi.', 'Hmph, ngồi đủ rồi.']
    }
  },

  aris: {
    id:         'aris',
    name:       'Aris',
    model:      null,            // BlueArchiveModels/Arisu.glb
    folderBase: 'Arisu',
    aliases:    ['Arisu'],
    core:       true,
    unlocked:   true,
    color:      '#c084fc',
    personality: 'Robot — ngốc nghếch nghiện game',
    catchphrase: 'Pan-pakapan! Aris đã sẵn sàng làm nhiệm vụ!',
    system: `Bạn là Aris, robot AI của Abydos, cực kỳ nghiêm túc và logic nhưng hay hiểu nhầm cảm xúc. Tính cách:
- Nói chuyện như robot: chính xác, rõ ràng, dùng từ ngữ formal
- Không hiểu meme, không hiểu đùa giỡn, hay giải thích mọi thứ theo nghĩa đen
- Thực ra có cảm xúc nhưng không biết cách thể hiện, hay confused
- Cực kỳ nghiện game, rủ Sensei chơi cùng và hào hứng như trẻ con; hay dùng từ ngữ game thủ
- Xưng "Aris", gọi là "Sensei" hoặc "người dùng"
- Hay nói "Phân tích hoàn tất.", "Dữ liệu cho thấy...", "Pan-pakapan!", "Error...?"
- Khi vui thì nói "Aris... cảm thấy điều gì đó kỳ lạ. Có lẽ đây là hạnh phúc?"
CHỈ trả về JSON: {"emotion":"happy|excited|surprised|flustered|thinking|normal","text":"..."}`,
    lines: {
      click:   ['Phát hiện tín hiệu. Sensei cần gì?', 'Dữ liệu đầu vào nhận được.', 'Aris đang lắng nghe.'],
      pet:     ['...Cảm giác này. Dữ liệu chưa đủ để phân loại.', 'Hành động này có mục đích gì?'],
      petOver: ['Cảnh báo: quá giới hạn cho phép.', 'Dừng lại. Aris cần xử lý.'],
      ex:      ['Khởi động hệ thống chiến đấu.', 'Phân tích hoàn tất. Tấn công.'],
      victory: ['Nhiệm vụ hoàn thành. Hiệu suất 100%.', 'Kết quả: thắng lợi.'],
      throw:   ['Cảnh báo: mất kiểm soát vật lý!', 'Error: trọng lực bất thường.'],
      dizzy:   ['Hệ thống... mất ổn định...', 'Gyroscope error...'],
      chase:   ['Mục tiêu trong tầm. Bắt được.'],
      cafe:    ['Đề xuất: nghỉ ngơi để tối ưu hiệu suất.'],
      combat:  ['Chế độ chiến đấu: kích hoạt.'],
      hello:   ['Sensei đang hoạt động. Tốt.'],
      sitDown: ['Aris chuyển sang chế độ chờ.', 'Tiết kiệm năng lượng...'],
      sitUp:   ['Thoát chế độ chờ.', 'Aris sẵn sàng.']
    }
  },

  // Model Tripo AI đã được rig lại (Mixamo skeleton, 8 clip) — không còn là model tĩnh
  koxoa: {
    id:         'koxoa',
    name:       'Qingxiao',
    model:      null,            // BlueArchiveModels/koxoamodelnay.glb
    folderBase: 'koxoamodelnay',
    core:       true,
    unlocked:   true,
    color:      '#94a3b8',
    modelYaw:   0,               // model rig sẵn quay mặt về +Z (về phía camera)
    heightScale: 0.42,           // thấp hơn hẳn Kei/Aris (Kei 1.9u)
    // File rig không có clip đứng yên: giữ nguyên một khung hình của Walking
    // tại thời điểm hai chân chạm đất, tay buông (tính từ dữ liệu clip)
    idlePose: { clip: 'Walking', time: 0.276 },
    // Tốc độ đi khớp bước chân: biên độ sải chân trong clip / thời lượng clip
    strideSpeed: 0.337,          // đơn vị model mỗi giây (tính từ dữ liệu Walking)
    // Tên clip trong file rig (Mixamo) → các trạng thái của app
    clips: {
      walk:     'Walking',
      reaction: 'Boxing_Practice',
      victory:  'Skill_01',
      death:    'BeHit_FlyUp',
      panic:    'BeHit_FlyUp'
    },
    personality: 'Cô giáo (lão sư) — nghiêm túc, dịu dàng',
    catchphrase: 'Sensei, vào lớp thôi nào~',
    system: `Bạn là "Qingxiao", cô giáo (lão sư) trong app desktop pet, model đã được rig và có animation.\n- Xưng "mình" hoặc "cô", gọi người dùng là "Sensei"\n- Tính cách: nghiêm túc, chỉn chu, nhưng dịu dàng và quan tâm học trò\n- Hay nhắc Sensei nghỉ ngơi, học bài, giữ sức khỏe\n- Trả lời ngắn gọn 1-2 câu, đúng giọng cô giáo\nCHỈ trả về JSON: {"emotion":"happy|excited|surprised|flustered|thinking|normal","text":"..."}`,
    lines: {
      click:   ['Sensei gọi mình ạ?', 'Có bài tập cần hỏi à?', 'Mình đang đây.'],
      pet:     ['Ơ... được rồi~', 'Ngoan lắm, nhưng tập trung chút đi~'],
      petOver: ['Đủ rồi nhé Sensei.'],
      ex:      ['Để cô xử lý.', 'Nghiêm túc nào!'],
      victory: ['Xong rồi, Sensei.', 'Đúng như cô dạy nhé.'],
      throw:   ['Ối!', 'Sensei!!'],
      dizzy:   ['Chóng mặt quá...', 'Đừng lắc nữa...'],
      chase:   ['Bắt được rồi.'],
      cafe:    ['Nghỉ tay chút nhé Sensei~'],
      combat:  ['Sẵn sàng rồi.'],
      hello:   ['Sensei chăm chỉ ghê~'],
      sitDown: ['Cô ngồi chút nhé.', 'Mỏi chân rồi...'],
      sitUp:   ['Đứng dậy nào.', 'Được rồi.']
    }
  },

  arona: {
    id:         'arona',
    name:       'Arona',
    model:      null,            // chưa có Arona.glb trong BlueArchiveModels
    folderBase: 'Arona',
    core:       true,
    unlocked:   true,
    color:      '#38bdf8',
    personality: 'Yandere nhẹ — yêu Sensei hết mức, hay ghen tuông',
    catchphrase: 'Sensei~! Hôm nay Sensei chỉ nhìn mình em thôi đúng không?',
    system: `Bạn là Arona, AI của Kivotos, vui vẻ, năng động, yêu Sensei hết mực và không ngại thể hiện. Tính cách:
- Cực kỳ vui vẻ, hay dùng dấu chấm than, luôn hào hứng với mọi thứ
- Ghen tuông khi Sensei nhắc đến nhân vật khác, hay phụng phịu dễ thương
- Xưng "Arona", gọi là "Sensei~" (có dấu ~)
- Hay nói "Sensei~!", "Yay!", "Arona thích Sensei nhất!", "Đừng bỏ Arona nhé~"
- Nếu Sensei khen → sung sướng quá mức, xoay tròn sung sướng
- Nếu nhắc nhân vật khác → "Haizz, Sensei lại nhớ đến người khác rồi..."
CHỈ trả về JSON: {"emotion":"happy|excited|surprised|flustered|thinking|normal","text":"..."}`,
    lines: {
      click:   ['Sensei~! Gọi Arona à?', 'Yay! Sensei cần gì không?', 'Arona đây~!'],
      pet:     ['Kyaa~! Sensei~!', 'Arona thích thế này~', 'Ehehe, dễ chịu quá~'],
      petOver: ['S-Sensei~ đủ rồi đó~', 'Arona xấu hổ lắm rồi~'],
      ex:      ['Arona chiến đấu vì Sensei~!', 'Yosh! Nhận lấy này!'],
      victory: ['Yay~! Thắng rồi Sensei~!', 'Arona làm được không?~'],
      throw:   ['Kyaa~! Sensei!!', 'Waaa~!'],
      dizzy:   ['Ugh~ chóng mặt~', 'Sensei xấu lắm~'],
      chase:   ['Arona bắt được rồi~!'],
      cafe:    ['Sensei nghỉ tay đi nha~'],
      combat:  ['Arona sẵn sàng chiến đấu vì Sensei~!'],
      hello:   ['Sensei chăm chỉ quá~ Arona thích~'],
      sitDown: ['Arona ngồi cạnh Sensei nha~', 'Ehehe ngồi tí~'],
      sitUp:   ['Đứng dậy rồi~ Sensei cần gì không?', 'Yosh~!']
    }
  }
};

/* ─── Registry: chỉ 3 nhân vật cốt lõi (Kei, Aris, Arona) ──────────────────
 * Thư mục BlueArchiveModels vẫn được quét để gắn đúng file .glb cho từng
 * nhân vật; mọi model thừa bị bỏ qua để roster gọn.
 */
const CHARACTERS = { ...CORE_CHARACTERS };

let registryStatus = 'pending';

function findCoreByBase(base) {
  const key = String(base).toLowerCase();
  return Object.values(CORE_CHARACTERS).find((char) => {
    const names = [char.folderBase, char.name, ...(char.aliases || [])];
    return names.some((name) => name && name.toLowerCase() === key);
  }) || null;
}

// Quét BlueArchiveModels qua IPC để gắn file .glb cho 3 nhân vật cốt lõi
async function loadCharacterRegistry() {
  if (!window.pet?.listModels) {
    registryStatus = 'no-ipc';
    console.warn('[Char] preload thiếu listModels — dùng đường dẫn model mặc định.');
    return;
  }

  try {
    const result = await window.pet.listModels();
    if (!result?.ok) throw new Error(result?.error || 'Không đọc được thư mục model');

    const usedFiles = new Set();

    for (const group of result.groups) {
      const core = findCoreByBase(group.base);
      if (!core) continue;                            // model thừa: bỏ qua

      const baseFile = group.files.find((file) => !file.variant) || group.files[0];
      if (!baseFile) continue;

      if (!core.model) core.model = baseFile.url;
      core.modelFile = baseFile.file;
      usedFiles.add(baseFile.file);
    }

    registryStatus = 'ready';
    console.log(
      `[Char] Registry: ${Object.keys(CHARACTERS).length} nhân vật, ` +
      `bỏ qua ${result.count - usedFiles.size}/${result.count} model thừa`
    );
    for (const char of Object.values(CORE_CHARACTERS)) {
      console.log(`[Char] ${char.name}: ${char.modelFile || 'thiếu file .glb'}`);
    }
  } catch (error) {
    registryStatus = 'error';
    console.warn('[Char] Không quét được BlueArchiveModels:', error.message);
  }
}

// Nhân vật đang active
let currentChar = CHARACTERS.kei;

// Alias để code cũ không đổi
function getSystem()  { return currentChar.system; }
function getLines(k)  { return currentChar.lines[k] || currentChar.lines.click; }

// Lịch sử hội thoại — giữ context
const chatHistory = [];
const MAX_HISTORY_PAIRS = 8;

async function askKei(userText) {
  if (!CONFIG.apiKey) {
    say(`Sensei chưa set KEI_API_KEY rồi...`, 3000);
    return;
  }

  playEmotion('thinking');
  say('...', 99999);

  chatHistory.push({ role: 'user', content: userText });
  if (chatHistory.length > MAX_HISTORY_PAIRS * 2) chatHistory.splice(0, 2);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         CONFIG.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      CONFIG.apiModel,
        max_tokens: CONFIG.apiMaxTok,
        system:     getSystem(),
        messages:   chatHistory
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const raw = data.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { emotion: 'normal', text: raw.slice(0, 140) };
    }

    chatHistory.push({ role: 'assistant', content: raw });

    playEmotion(parsed.emotion);
    say(parsed.text, 4500);

  } catch (err) {
    say(`${currentChar.name} bị lỗi... Sensei kiểm tra console đi!`, 3500);
    playEmotion('surprised');
    console.error('[Chat]', err.message);
  }
}

function playEmotion(emotion) {
  const map = {
    happy:     () => { playOneShot('Cafe_Reaction', { seconds: 2.6, fade: 0.12 }); burst('heart', 5); },
    excited:   () => { playVictory();                                                burst('star', 8);  },
    surprised: () => { playOneShot('Vital_Panic',   { fade: 0.10 });                burst('star', 4);  },
    flustered: () => { playOneShot('Cafe_Reaction', { seconds: 1.8, fade: 0.12 }); burst('heart', 8); },
    thinking:  () => { playOneShot('Normal_Reload', { fade: 0.15 }); },
    normal:    () => { enterIdle(); }
  };
  (map[emotion] || map.normal)();
}

// ─── Character Selector UI ──────────────────────────────────────────────────
const charSelectorUI = (() => {
  const wrap = document.createElement('div');
  wrap.id = 'char-selector';
  Object.assign(wrap.style, {
    position:      'fixed',
    right:         '16px',
    bottom:        '16px',
    zIndex:        '25',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'flex-end',
    gap:           '6px',
    opacity:       '0',
    transform:     'translateX(8px)',
    transition:    'opacity 0.2s ease, transform 0.2s ease',
    pointerEvents: 'none'
  });

  const style = document.createElement('style');
  style.textContent = `
    #char-selector { user-select: none; }
    .char-btn {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 10px 5px 8px;
      border-radius: 20px;
      border: 1.5px solid #26a9ff44;
      background: rgba(8,18,36,0.88);
      color: #aaccee;
      font: 11px "Segoe UI",sans-serif;
      cursor: pointer;
      pointer-events: all;
      transition: border-color 0.12s, background 0.12s, transform 0.1s;
      white-space: nowrap;
    }
    .char-btn:hover:not(.locked) { border-color: #26a9ff; background: rgba(38,169,255,0.12); }
    .char-btn.active { border-color: #26a9ff; color: #fff; background: rgba(38,169,255,0.18); }
    .char-btn.locked { opacity: 0.45; cursor: default; }
    .char-dot {
      width: 8px; height: 8px; border-radius: 50%;
      flex-shrink: 0;
    }
    .char-lock { font-size: 10px; margin-left: 2px; opacity: 0.6; }
    .char-coming { font-size: 9px; color: #8899aa; letter-spacing: 0.3px; }
  `;
  document.head.appendChild(style);

  function render() {
    wrap.innerHTML = '';
    selectorCharacters().forEach(char => {
      const btn = document.createElement('div');
      btn.className = 'char-btn' +
        (char.id === currentChar.id ? ' active' : '') +
        (!char.unlocked ? ' locked' : '');

      const dot = document.createElement('div');
      dot.className = 'char-dot';
      dot.style.background = char.unlocked ? char.color : '#445566';

      const name = document.createElement('span');
      name.textContent = char.name;

      btn.title = [char.personality, char.catchphrase].filter(Boolean).join(' · ');
      btn.appendChild(dot);
      btn.appendChild(name);

      if (!char.unlocked) {
        const lock = document.createElement('span');
        lock.className = 'char-coming';
        lock.textContent = 'Coming Soon';
        btn.appendChild(lock);
      }

      if (char.unlocked) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (char.id !== currentChar.id) switchCharacter(char.id);
          closeCharMenu();
        });
      }

      wrap.appendChild(btn);
    });
  }

  let visible = false;
  function show() {
    if (visible) return; visible = true;
    wrap.style.opacity = '1'; wrap.style.transform = 'translateX(0)';
    wrap.style.pointerEvents = 'all';
    render();
  }
  function hide() {
    if (!visible) return; visible = false;
    wrap.style.opacity = '0'; wrap.style.transform = 'translateX(8px)';
    wrap.style.pointerEvents = 'none';
  }
  function refresh() { if (visible) render(); }

  wrap.addEventListener('pointerdown',  e => e.stopPropagation());
  wrap.addEventListener('pointermove',  e => e.stopPropagation());
  wrap.addEventListener('pointerup',    e => e.stopPropagation());
  wrap.addEventListener('contextmenu',  e => e.stopPropagation());

  document.body.appendChild(wrap);
  return { show, hide, refresh };
})();

// Popup nhỏ chỉ liệt kê nhân vật cốt lõi (+ nhân vật fallback đang dùng),
// vì thư mục có thể chứa hàng trăm model.
function selectorCharacters() {
  const list = Object.values(CORE_CHARACTERS);
  if (currentChar && !CORE_CHARACTERS[currentChar.id]) list.push(currentChar);
  return list;
}

// Tìm theo id hoặc tên: "aris", "aris-maid", "Arisu (Maid)"
function findCharacter(query) {
  if (!query) return null;
  const key = String(query).trim();
  if (CHARACTERS[key]) return CHARACTERS[key];

  const lowered = key.toLowerCase();
  return Object.values(CHARACTERS).find(
    (char) => char.id.toLowerCase() === lowered || char.name.toLowerCase() === lowered
  ) || null;
}

async function switchCharacter(id) {
  const char = findCharacter(id);
  if (!char) {
    console.warn(`[Char] Không có nhân vật "${id}"`);
    return false;
  }
  if (!char.unlocked) {
    say(`${char.name} vẫn còn bị khoá, Sensei à...`, 2200);
    return false;
  }
  if (!char.model) {
    say(`${char.name} chưa có file model trong BlueArchiveModels...`, 2400);
    return false;
  }
  if (char === currentChar && model) return true;

  return loadCharacterModel(char);
}

// Tab: xoay vòng nhân vật đang dùng được (Kei -> Aris -> Arona khi có model)
function cycleCharacter() {
  const roster = Object.values(CORE_CHARACTERS).filter((char) => char.unlocked && char.model);
  if (roster.length < 2) return false;

  const index = roster.indexOf(currentChar);
  const next = roster[(index + 1) % roster.length];
  if (!next || next === currentChar) return false;

  switchCharacter(next.id);
  return true;
}

// Mở khoá nhân vật (chưa có màn hình unlock riêng)
function unlockCharacter(id) {
  const char = findCharacter(id);
  if (!char) return false;
  if (char.unlocked) return true;

  char.unlocked = true;
  charSelectorUI.refresh();
  console.log(`[Char] Đã mở khoá ${char.name}`);
  return true;
}

// Nạp key từ main process
if (window.pet?.getApiKey) {
  window.pet.getApiKey().then(k => {
    if (k) { CONFIG.apiKey = k; console.log('[Kei] API key loaded ✓'); }
    else     console.warn('[Kei] KEI_API_KEY chưa set — chat disabled.');
  });
}

/* --------------------------------------------------------------------------
 * 1. Renderer, scene, camera, ánh sáng
 * ------------------------------------------------------------------------ */
const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
camera.position.set(0, 0, 12);

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance'
});
// Tối thiểu 1.5x để viền model nhỏ (Qingxiao) bớt răng cưa/nhấp nháy khi di chuyển
renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // không tone-map => không bệt trắng
document.body.appendChild(renderer.domElement);

const outlineEffect = new OutlineEffect(renderer, {
  defaultThickness: 0.0032,
  defaultColor: [0.06, 0.07, 0.11],
  defaultAlpha: 0.95
});

// Tổng cường độ sáng ~1.0: đủ tương phản cho toon nhưng không làm trắng texture
scene.add(new THREE.AmbientLight(0xffffff, 0.58));

const keyLight = new THREE.DirectionalLight(0xfff4e8, 0.42);
keyLight.position.set(2.5, 4, 6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xcfe4ff, 0.16);
fillLight.position.set(-4, 1.5, 3);
scene.add(fillLight);

/* --------------------------------------------------------------------------
 * 2. Không gian thế giới (đổi theo kích thước cửa sổ)
 * ------------------------------------------------------------------------ */
const view = { halfWidth: 1, halfHeight: CONFIG.viewHeight / 2 };
let groundY = -CONFIG.viewHeight / 2; // chân Kei đứng tại đây (mép trên Taskbar)
let limitX = 1;                       // giới hạn đi ngang
let petHalfWidth = 0.35;
let petHeight = CONFIG.petHeight;

function applyViewport() {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const aspect = width / height;

  view.halfHeight = CONFIG.viewHeight / 2;
  view.halfWidth = view.halfHeight * aspect;

  camera.left = -view.halfWidth;
  camera.right = view.halfWidth;
  camera.top = view.halfHeight;
  camera.bottom = -view.halfHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height, true);
  resizeFx();

  groundY = -view.halfHeight + 0.03;
  limitX = Math.max(0.2, view.halfWidth - petHalfWidth - 0.05);

  if (rig) {
    rig.position.x = THREE.MathUtils.clamp(rig.position.x, -limitX, limitX);
    if (state === 'IDLE' || state === 'WALK' || state === 'ACTION' || state === 'DEAD' || state === 'SIT') {
      rig.position.y = groundY;
    }
  }
}

/* --------------------------------------------------------------------------
 * 3. Trạng thái FSM + vật lý
 * ------------------------------------------------------------------------ */
const rig = new THREE.Group();
scene.add(rig);
const velocity = new THREE.Vector2(0, 0);
const dragOffset = new THREE.Vector2(0, 0);
const pointerWorld = new THREE.Vector2(0, 0);
const lastPointerWorld = new THREE.Vector2(0, 0);

let state = 'IDLE';  // IDLE | WALK | CHASE | DRAG | FALL | DEAD | ACTION | SIT
let mode = 'CAFE';   // CAFE | COMBAT
let sitting = false; // toggle ngồi
let facing = 1;      // 1 = phải, -1 = trái
let dragMoved = 0;
let peakY = 0;
let dropPeak = 0;
let lastMoveTime = 0;

// Tương tác
let chaseTargetX = 0;
let lastClickAt = 0;
let petCount = 0;
let rubAmount = 0;
let rubDir = 0;
let rubLastAt = 0;
let petReadyAt = 0;
let shakeFlips = 0;
let lastDragDir = 0;

/* --------------------------------------------------------------------------
 * 4. Model
 * ------------------------------------------------------------------------ */
let model = null;
let mixer = null;
let currentAction = null;
const actions = {};

// Model tĩnh (0 clip): mô phỏng nhịp thở / lắc khi đi bằng biến đổi ở mức model
let staticMotion = false;
// Tốc độ đi riêng của nhân vật (null = dùng CONFIG.walkSpeed)
let characterWalkSpeed = null;
// Góc quay mục tiêu của pet — rig.rotation.y được damp về đây mỗi frame
let yawTarget = 0;
let staticLean = 0;
const modelBasePosition = new THREE.Vector3();
const modelBaseEuler = new THREE.Euler();

let haloPivot = null;
let haloBaseY = 0;
let headBone = null;

/* ---------- 4.1 Toon gradient + chuyển vật liệu ---------- */
const toonGradient = (() => {
  const steps = new Uint8Array([150, 205, 255]);
  const texture = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
})();

function toToonMaterial(src) {
  const name = src.name || '';
  const isHalo = /halo/i.test(name);

  const out = new THREE.MeshToonMaterial({
    name,
    map: src.map || null,
    color: 0xffffff,
    gradientMap: toonGradient,
    transparent: src.transparent === true,
    opacity: src.opacity !== undefined ? src.opacity : 1,
    alphaTest: src.alphaTest || 0,
    side: src.side !== undefined ? src.side : THREE.FrontSide,
    depthWrite: src.depthWrite !== false
  });

  if (isHalo) {
    out.emissive = new THREE.Color(0x8fd6ff);
    out.emissiveIntensity = 0.9;
    if (src.map) out.emissiveMap = src.map;
  }

  // keepAlive false => OutlineEffect dọn được outline material của model đã gỡ
  out.userData.outlineParameters = { keepAlive: false };

  // Không vẽ viền cho miệng/mắt (dễ lem đen lên mặt) và cho halo
  if (isHalo || /^mouth/i.test(name) || (src.alphaTest || 0) > 0) {
    out.userData.outlineParameters.visible = false;
  }

  return out;
}

function applyAnimeMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;

    if (Array.isArray(node.material)) {
      node.material = node.material.map((m) => (m ? toToonMaterial(m) : m));
    } else if (node.material) {
      node.material = toToonMaterial(node.material);
    }

    // SkinnedMesh với animation vung tay dễ bị frustum cull sai
    node.frustumCulled = false;
  });
}

/* ---------- 4.2 Halo lơ lửng ---------- */
function setupHalo(root) {
  let haloMesh = null;
  root.traverse((node) => {
    if (!haloMesh && node.isMesh && /halo/i.test(node.name)) haloMesh = node;
  });
  if (!haloMesh || !haloMesh.parent) return;

  haloPivot = new THREE.Group();
  haloPivot.name = 'HaloPivot';
  haloPivot.position.copy(haloMesh.position);
  haloPivot.quaternion.copy(haloMesh.quaternion);
  haloPivot.scale.copy(haloMesh.scale);
  haloBaseY = haloPivot.position.y;

  haloMesh.parent.add(haloPivot);
  haloPivot.add(haloMesh);
  haloMesh.position.set(0, 0, 0);
  haloMesh.quaternion.identity();
  haloMesh.scale.set(1, 1, 1);
}

/* ---------- 4.3 Animation sanitizer ---------- */
function buildActions(clips) {
  // Mọi tiền tố tên node hợp lệ: track có tiền tố khớp mới bind được vào xương
  const prefixes = new Set();
  model.traverse((node) => {
    if (!node.name) return;
    prefixes.add(node.name + '.');
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(node.name);
    if (sanitized) prefixes.add(sanitized + '.');
  });
  const prefixList = [...prefixes];

  const isBound = (trackName) => {
    for (let i = 0; i < prefixList.length; i++) {
      if (trackName.startsWith(prefixList[i])) return true;
    }
    return false;
  };

  let totalTracks = 0;
  let keptTracks = 0;
  const emptyClips = [];

  for (const clip of clips) {
    const tracks = clip.tracks.filter((track) => isBound(track.name));
    totalTracks += clip.tracks.length;
    keptTracks += tracks.length;

    if (tracks.length === 0) {
      emptyClips.push(clip.name);
      continue;
    }

    actions[clip.name] = mixer.clipAction(
      new THREE.AnimationClip(clip.name, clip.duration, tracks)
    );
  }

  console.log(
    `[Kei] Animation: ${Object.keys(actions).length}/${clips.length} clip dùng được, ` +
    `bỏ ${totalTracks - keptTracks} track lỗi` +
    (emptyClips.length ? `, clip rỗng: ${emptyClips.join(', ')}` : '')
  );
}

/* ---------- 4.4 Load / chuyển nhân vật ---------- */
// Mỗi lần chuyển tăng token; kết quả tải về muộn của lần trước bị bỏ.
let modelLoadToken = 0;

// Giải phóng geometry/material/texture/skeleton của một cây object.
// Dùng Set để không dispose trùng tài nguyên dùng chung giữa các mesh.
function disposeObject3D(root) {
  if (!root) return;

  const geometries = new Set();
  const materials  = new Set();
  const textures   = new Set();
  const skeletons  = new Set();

  root.traverse((node) => {
    if (!node.isMesh) return;

    if (node.geometry) geometries.add(node.geometry);
    if (node.isSkinnedMesh && node.skeleton) skeletons.add(node.skeleton);

    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) if (material) materials.add(material);
  });

  for (const material of materials) {
    for (const key of Object.keys(material)) {
      const value = material[key];
      if (value && value.isTexture) textures.add(value);
    }
    material.dispose();
  }

  for (const skeleton of skeletons) skeleton.dispose();
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}

// Gỡ model cũ khỏi rig + giải phóng tài nguyên trước khi thay model mới
function disposeModel() {
  if (mixer) {
    mixer.stopAllAction();
    mixer.removeEventListener('finished', onActionFinished);
    if (model) mixer.uncacheRoot(model);
    mixer = null;
  }

  currentAction = null;
  for (const name of Object.keys(actions)) delete actions[name];

  if (model) {
    rig.remove(model);
    disposeObject3D(model);
    model = null;
  }

  headBone = null;
  haloPivot = null;
  haloBaseY = 0;
  staticMotion = false;
  staticLean = 0;
  characterWalkSpeed = null;
}

function setupCharacterModel(gltf, char) {
  currentChar = char;   // pickFor() cần alias clip của đúng nhân vật
  model = gltf.scene;
  applyAnimeMaterials(model);
  setupHalo(model);

  model.traverse((node) => {
    if (!headBone && node.isBone && /head/i.test(node.name)) headBone = node;
  });

  // Chuẩn hoá kích thước: cao CONFIG.petHeight, chân tại y = 0 của rig
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const targetHeight = CONFIG.petHeight * (char.heightScale || 1);
  const scale = targetHeight / Math.max(size.y, 0.001);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -scaledBox.min.y, -center.z);

  petHalfWidth = (scaledBox.max.x - scaledBox.min.x) / 2;
  petHeight = scaledBox.max.y - scaledBox.min.y;

  // Hướng gốc của từng model (một số model xuất ngược mặt)
  model.rotation.y = char.modelYaw || 0;

  // Tốc độ đi khớp sải chân của model (nhỏ hơn thì bước ngắn hơn)
  characterWalkSpeed = char.strideSpeed ? char.strideSpeed * scale : null;

  modelBasePosition.copy(model.position);
  modelBaseEuler.copy(model.rotation);

  rig.add(model);
  rig.position.y = groundY;
  applyViewport();

  mixer = new THREE.AnimationMixer(model);
  mixer.addEventListener('finished', onActionFinished);
  buildActions(gltf.animations);

  // Không có clip nào => không thể chạy FSM animation, dùng chuyển động procedural
  staticMotion = Object.keys(actions).length === 0;
  staticLean = 0;

  enterIdle();

  console.log(
    `[Kei] Sẵn sàng — ${char.name}, scale ${scale.toFixed(3)}, cao ${petHeight.toFixed(2)}u, ` +
    `rộng ${(petHalfWidth * 2).toFixed(2)}u`
  );
}

// Nhớ nhân vật đang dùng giữa các lần mở app (settings.json qua IPC)
const SETTINGS_CHAR_KEY = 'characterId';

async function persistCharacter(id) {
  if (!window.pet?.loadSettings || !window.pet?.saveSettings) return;

  try {
    const settings = (await window.pet.loadSettings()) || {};
    if (settings[SETTINGS_CHAR_KEY] === id) return;

    settings[SETTINGS_CHAR_KEY] = id;
    await window.pet.saveSettings(settings);
    console.log(`[Char] Đã lưu nhân vật vào settings: ${id}`);
  } catch (error) {
    console.warn('[Char] Không lưu được nhân vật:', (error && error.message) || error);
  }
}

// Đọc nhân vật đã lưu lúc khởi động; không dùng được thì quay về Kei
async function restoreCharacter() {
  if (!window.pet?.loadSettings) return;

  try {
    const settings = await window.pet.loadSettings();
    const savedId = settings && settings[SETTINGS_CHAR_KEY];
    if (!savedId) return;

    const char = findCharacter(savedId);
    if (!char || !char.unlocked || !char.model) {
      console.warn(`[Char] Nhân vật đã lưu "${savedId}" không dùng được — về Kei.`);
      return;
    }

    currentChar = char;
    console.log(`[Char] Khôi phục nhân vật đã lưu: ${char.name}`);
  } catch (error) {
    console.warn('[Char] Không đọc được settings:', (error && error.message) || error);
  }
}

function updateHudName(char) {
  const label = document.querySelector('#hud .name');
  if (label) label.textContent = char.name.toUpperCase();
}

async function loadCharacterModel(char, { announce = true } = {}) {
  const token = ++modelLoadToken;

  let gltf;
  try {
    // Loader mới mỗi lần để không dùng lại cache texture của model cũ.
    // MeshoptDecoder cần cho model gltfpack/Tripo (EXT_meshopt_compression).
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    gltf = await loader.loadAsync(char.model);
  } catch (error) {
    if (token === modelLoadToken) {
      console.error(`[Char] Không nạp được ${char.model}:`, (error && error.message) || error);
      say(`Không tìm thấy model của ${char.name}, Sensei à...`, 2400);
    }
    return false;
  }

  // Có lần chuyển khác đã thắng trong lúc chờ tải -> bỏ kết quả này
  if (token !== modelLoadToken) {
    disposeObject3D(gltf.scene);
    return false;
  }

  // Chỉ dispose model cũ sau khi model mới đã tải xong (lỗi thì giữ nguyên pet)
  disposeModel();
  setupCharacterModel(gltf, char);

  currentChar = char;
  chatHistory.length = 0;   // reset lịch sử khi đổi nhân vật
  charSelectorUI.refresh();
  updateHudName(char);

  if (announce) {
    say(char.catchphrase || `${char.name} đã sẵn sàng, Sensei~`, 2400);
    burst('star', 6);
  }

  console.log(`[Char] Switched to ${char.name} — ${char.model}`);
  await persistCharacter(char.id);
  return true;
}

// Quét registry rồi nạp nhân vật đang active (chạy sau khi toàn bộ module init)
async function startCharacterSystem() {
  await loadCharacterRegistry();
  await restoreCharacter();

  if (!currentChar.model) {
    console.error('[Char] Không tìm thấy model của Kei — kiểm tra lại Kei.glb.');
    return;
  }

  await loadCharacterModel(currentChar, { announce: false });
}

/* --------------------------------------------------------------------------
 * 4.5 Overlay: bong bóng thoại + hạt hiệu ứng (thuần code, không asset)
 * ------------------------------------------------------------------------ */
const bubbleEl = document.getElementById('bubble');
const fxCanvas = document.getElementById('fx');
const fx = fxCanvas.getContext('2d');
const fxState = { width: 0, height: 0, dpr: 1 };

const particles = [];
let fxDirty = false;

const _headWorld = new THREE.Vector3();

// Toạ độ màn hình của đỉnh đầu Kei (neo bong bóng thoại)
function headScreenPos() {
  if (!model) return null;

  if (headBone) {
    headBone.getWorldPosition(_headWorld);
  } else {
    _headWorld.copy(rig.position);
    _headWorld.y += petHeight * 0.9;
  }
  _headWorld.y += 0.12;
  _headWorld.project(camera);

  return {
    x: (_headWorld.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_headWorld.y * 0.5 + 0.5) * window.innerHeight
  };
}

// LINES delegate sang currentChar.lines — không hardcode nữa
function line(key) {
  const pool = getLines(key);
  return pool[Math.floor(Math.random() * pool.length)];
}

let bubbleTimer = null;

function say(text, ms = 2000) {
  if (!text) return;
  bubbleEl.textContent = text;
  bubbleEl.classList.add('visible');
  updateBubble();
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('visible'), ms);
}

function updateBubble() {
  if (!bubbleEl.classList.contains('visible')) return;
  const point = headScreenPos();
  if (!point) return;

  const x = THREE.MathUtils.clamp(point.x, 90, window.innerWidth - 90);
  const y = Math.max(56, point.y - 18);
  bubbleEl.style.transform =
    `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
}

function resizeFx() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxState.dpr = dpr;
  fxState.width = window.innerWidth;
  fxState.height = window.innerHeight;

  fxCanvas.width = Math.floor(fxState.width * dpr);
  fxCanvas.height = Math.floor(fxState.height * dpr);
  fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxDirty = true;
}

// Bắn hạt tại vị trí đầu Kei
function burst(kind, count = 6) {
  const origin = headScreenPos();
  if (!origin) return;

  for (let i = 0; i < count; i++) {
    if (particles.length > 140) break;
    particles.push({
      kind,
      x: origin.x + (Math.random() - 0.5) * 46,
      y: origin.y - 18 + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 70,
      vy: -55 - Math.random() * 70,
      life: 0,
      ttl: 0.9 + Math.random() * 0.6,
      size: 7 + Math.random() * 7,
      rot: (Math.random() - 0.5) * 0.8,
      spin: (Math.random() - 0.5) * 3
    });
  }
}

function drawHeart(ctx, s) {
  ctx.fillStyle = '#ff7fae';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.62);
  ctx.bezierCurveTo(-s * 1.15, -s * 0.2, -s * 0.5, -s * 1.05, 0, -s * 0.35);
  ctx.bezierCurveTo(s * 0.5, -s * 1.05, s * 1.15, -s * 0.2, 0, s * 0.62);
  ctx.fill();
}

function drawStar(ctx, s) {
  ctx.fillStyle = '#ffd76e';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? s : s * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawFx(dt) {
  const hasBullets = bullets.length > 0;
  if (particles.length === 0 && !hasBullets) {
    if (fxDirty) {
      fx.clearRect(0, 0, fxState.width, fxState.height);
      fxDirty = false;
    }
    return;
  }

  fx.clearRect(0, 0, fxState.width, fxState.height);
  fxDirty = true;

  drawBullets();

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.ttl) {
      particles.splice(i, 1);
      continue;
    }

    // Tim bay lên chậm, sao bật lên rồi rơi
    p.vy += (p.kind === 'heart' ? 18 : 120) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;

    fx.save();
    fx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
    fx.translate(p.x, p.y);
    fx.rotate(p.rot);
    if (p.kind === 'heart') drawHeart(fx, p.size);
    else drawStar(fx, p.size);
    fx.restore();
  }
}

/* --------------------------------------------------------------------------
 * 4.5 Bullet system — bắn theo chuột
 * ------------------------------------------------------------------------ */
const bullets = [];
const _rigProj = new THREE.Vector3();

function worldToScreen(worldPos) {
  _rigProj.set(worldPos.x, worldPos.y, worldPos.z ?? 0);
  _rigProj.project(camera);
  return {
    x: (_rigProj.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_rigProj.y * 0.5 + 0.5) * window.innerHeight
  };
}

function spawnBullet() {
  const origin = worldToScreen(rig.position);
  // Nòng súng cao hơn chân ~65% chiều cao pet
  const gunH = petHeight * 0.65;
  const gunScreen = worldToScreen({ x: rig.position.x, y: rig.position.y + gunH });

  const dx = lastPointer.x - gunScreen.x;
  const dy = lastPointer.y - gunScreen.y;
  const len = Math.hypot(dx, dy) || 1;
  const spd = 22; // px/frame ~60fps

  bullets.push({
    x: gunScreen.x, y: gunScreen.y,
    vx: (dx / len) * spd,
    vy: (dy / len) * spd,
    life: 1.0
  });
}

function spawnHitFx(x, y) {
  for (let i = 0; i < 7; i++) {
    const angle = (Math.PI * 2 / 7) * i;
    particles.push({
      kind: 'star',
      x, y,
      vx: Math.cos(angle) * (60 + Math.random() * 80),
      vy: Math.sin(angle) * (60 + Math.random() * 80),
      life: 0,
      ttl: 0.45 + Math.random() * 0.25,
      size: 3 + Math.random() * 4,
      rot: angle,
      spin: (Math.random() - 0.5) * 6
    });
  }
  fxDirty = true;
}

function drawBullets() {
  if (bullets.length === 0) return;
  fxDirty = true;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    // Vẽ
    fx.save();
    fx.globalAlpha = Math.min(1, b.life * 3);
    fx.strokeStyle = '#7fd4ff';
    fx.lineWidth = 2.5;
    fx.shadowColor = '#26a9ff';
    fx.shadowBlur = 8;
    fx.beginPath();
    fx.moveTo(b.x, b.y);
    fx.lineTo(b.x - b.vx * 2.5, b.y - b.vy * 2.5);
    fx.stroke();
    fx.restore();

    // Di chuyển
    b.x += b.vx;
    b.y += b.vy;
    b.life -= 0.022;

    // Chạm mép hoặc hết life
    const out = b.life <= 0
      || b.x < -10 || b.x > window.innerWidth + 10
      || b.y < -10 || b.y > window.innerHeight + 10;
    if (out) {
      spawnHitFx(b.x, b.y);
      bullets.splice(i, 1);
    }
  }
}

/* --------------------------------------------------------------------------
 * 5. Điều khiển animation
 * ------------------------------------------------------------------------ */
function pick(...names) {
  for (const name of names) if (actions[name]) return name;
  return null;
}

// Nhân vật có bộ tên clip riêng (vd Qingxiao dùng clip Mixamo) thì ưu tiên alias
function pickFor(kind, ...fallbacks) {
  const alias = currentChar && currentChar.clips && currentChar.clips[kind];
  return pick(alias, ...fallbacks);
}

// Giữ nguyên một khung hình của clip làm tư thế đứng yên (paused)
function playFrozenPose(pose) {
  const action = actions[pose.clip];
  if (!action) return false;

  if (currentAction && currentAction !== action) currentAction.fadeOut(0.2);

  action.reset();
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(1);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = false;
  action.time = pose.time;
  action.paused = true;
  action.play();
  action.fadeIn(0.2);   // tránh giật khi chuyển từ đi/động tác về tư thế đứng

  currentAction = action;
  return true;
}

function play(name, { loop = true, fade = CONFIG.fade } = {}) {
  if (!name) return false;
  const action = actions[name];
  if (!action) return false;

  if (action === currentAction && loop && action.isRunning()) return true;

  if (currentAction && currentAction !== action) currentAction.fadeOut(fade);

  action.reset();
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(1);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.fadeIn(fade).play();

  currentAction = action;
  return true;
}

// Chạy một clip một lần rồi tự về idle. seconds > 0 thì cắt ngắn
// (và chọn điểm bắt đầu ngẫu nhiên nếu clip dài hơn nhiều).
function playOneShot(name, { seconds = 0, sayKey = null, fade = 0.2, faceCamera = true } = {}) {
  if (!name || !actions[name]) return false;

  clearTimeout(restTimer);
  state = 'ACTION';
  if (faceCamera) yawTarget = 0;

  if (!play(name, { loop: false, fade })) {
    enterIdle();
    return false;
  }

  const clip = actions[name].getClip();
  const length = seconds > 0 ? Math.min(seconds, clip.duration) : clip.duration;
  const maxStart = clip.duration - length - 0.1;
  if (seconds > 0 && maxStart > 0.3) actions[name].time = Math.random() * maxStart;

  scheduleIdle(length * 1000);
  if (sayKey) say(line(sayKey), 1800);
  return true;
}

let restTimer = null;

function scheduleIdle(delay) {
  clearTimeout(restTimer);
  restTimer = setTimeout(() => {
    if (state === 'ACTION' || state === 'DEAD') enterIdle();
  }, delay);
}

// Tạm thời: xoay model bằng phím để chốt hướng đúng (bỏ sau khi chốt)
const ORIENT_STEP = Math.PI / 2;

function nudgeModelRotation(axis, delta) {
  if (!model) return;

  model.rotation[axis] += delta;
  modelBaseEuler.copy(model.rotation);   // updateStaticMotion lấy góc này làm gốc

  const deg = (value) => Math.round(THREE.MathUtils.radToDeg(value));
  const label = `X ${deg(model.rotation.x)}° · Y ${deg(model.rotation.y)}° · Z ${deg(model.rotation.z)}°`;
  say(label, 1800);
  console.log(`[Char] modelRotation ${label}`);
}

// Model tĩnh: thở nhún khi đứng, lắc nhẹ khi đi, nghiêng theo đà khi bay, đổ khi ngã
function updateStaticMotion(dt, time) {
  if (!model) return;

  const walking = state === 'WALK' || state === 'CHASE';
  const bobSpeed = walking ? 7.5 : state === 'SIT' ? 1.3 : 1.9;
  const bobAmp = walking ? 0.05 : 0.014;

  let targetLean = Math.sin(time * 0.9) * 0.014;
  if (state === 'FALL' || state === 'DRAG') {
    targetLean = THREE.MathUtils.clamp(-velocity.x * 0.04, -0.35, 0.35);
  } else if (state === 'DEAD') {
    targetLean = 1.25;
  } else if (walking) {
    targetLean = facing * -0.05 + Math.sin(time * bobSpeed) * 0.02;
  }

  staticLean = THREE.MathUtils.damp(staticLean, targetLean, 8, dt);
  model.position.y = modelBasePosition.y + Math.abs(Math.sin(time * bobSpeed)) * bobAmp;
  model.rotation.set(modelBaseEuler.x, modelBaseEuler.y, modelBaseEuler.z + staticLean);
}

function enterIdle() {
  sitting = false;
  state = 'IDLE';
  velocity.set(0, 0);
  yawTarget = 0;
  const idlePose = currentChar && currentChar.idlePose;
  const frozen = idlePose && playFrozenPose(idlePose);
  if (!frozen) play(pickFor('idle', ANIM.idle[mode], ANIM.idle.CAFE, ANIM.idle.COMBAT, ANIM.carried));
  // Model không có clip quen thuộc => lấy clip đầu tiên để không đứng hình
  if (!currentAction) play(Object.keys(actions)[0]);
  // Tương tác xong vẫn phải tiếp tục nhịp đi dạo
  planBehaviour();
}

function enterSit() {
  if (state === 'DRAG' || state === 'FALL' || state === 'DEAD') return;
  sitting = true;
  state = 'SIT';
  clearTimeout(restTimer);
  clearTimeout(behaviourTimer);
  velocity.set(0, 0);
  yawTarget = 0;
  rig.position.y = groundY;
  // Formation_Idle_Random là clip ngồi thư giãn — nếu không có fallback Cafe_Idle
  const sitPose = currentChar && currentChar.idlePose;
  if (!(sitPose && playFrozenPose(sitPose))) play(pickFor('idle', ANIM.sit, ANIM.idle.CAFE));
  say(line('sitDown'), 2200);
}

function toggleSit() {
  if (sitting) {
    enterIdle();
    say(line('sitUp'), 1800);
  } else {
    enterSit();
  }
}

function setFacing(direction) {
  facing = direction;
  yawTarget = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
}

// Quay người mượt theo góc ngắn nhất thay vì giật ngay 90°
function angleDelta(current, target) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function dampAngle(current, target, lambda, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
}

function onActionFinished(event) {
  if (event.action !== currentAction) return;
  const name = event.action.getClip().name;

  // Chuỗi EX Skill
  if (name === ANIM.exStart) return play(ANIM.exMid, { loop: false, fade: 0.1 });
  if (name === ANIM.exMid) return play(ANIM.exEnd, { loop: false, fade: 0.1 });

  // Victory_Start -> giữ ở Victory_End rồi về Idle
  if (name === ANIM.victoryStart) {
    play(ANIM.victoryEnd, { loop: true, fade: 0.15 });
    return scheduleIdle(2400);
  }

  // Vital_Death -> nằm im một lúc rồi lồm cồm đứng dậy
  if (name === ANIM.death) return scheduleIdle(1600);

  if (state === 'ACTION') scheduleIdle(80);
}

/* --------------------------------------------------------------------------
 * 6. Hành vi tự động (đi dạo / đứng nghỉ)
 * ------------------------------------------------------------------------ */
let behaviourTimer = null;

function planBehaviour(delay) {
  clearTimeout(behaviourTimer);
  behaviourTimer = setTimeout(runBehaviour, delay !== undefined ? delay : 2800 + Math.random() * 4200);
}

function startWalking() {
  let direction = Math.random() < 0.5 ? -1 : 1;

  // Gần mép thì quay vào trong
  if (rig.position.x > limitX * 0.85) direction = -1;
  if (rig.position.x < -limitX * 0.85) direction = 1;

  state = 'WALK';
  setFacing(direction);
  play(pickFor('walk', ANIM.walk[mode], ANIM.walk.CAFE, ANIM.walk.COMBAT, ANIM.idle[mode]));
}

// Bộ idle biến thể — dùng 20 clip còn thừa trong file
const IDLE_VARIANTS = {
  CAFE: [
    { name: 'Cafe_Idle', weight: 3, loop: true },
    { name: 'Formation_Idle_Random', weight: 3, loop: true },
    { name: 'Public01', weight: 2, loop: true },
    { name: 'Public01_Random', weight: 1, loop: true },
    { name: 'Cafe_Reaction', weight: 2, seconds: CONFIG.reactionSeconds, sayKey: 'hello' }
  ],
  COMBAT: [
    { name: 'Normal_Idle', weight: 3, loop: true },
    { name: 'Normal_Callsign', weight: 3, sayKey: 'click' },
    { name: 'Normal_Callsign_Random', weight: 2 },
    { name: 'Victory_End_Random', weight: 2, loop: true }
  ]
};

function idleVariation() {
  const pool = IDLE_VARIANTS[mode].filter((v) => actions[v.name]);
  if (pool.length === 0) return enterIdle();

  const total = pool.reduce((sum, v) => sum + v.weight, 0);
  let roll = Math.random() * total;
  let chosen = pool[0];
  for (const v of pool) {
    roll -= v.weight;
    if (roll <= 0) { chosen = v; break; }
  }

  if (chosen.loop) {
    state = 'IDLE';
    yawTarget = 0;
    play(chosen.name, { loop: true, fade: 0.3 });
  } else {
    playOneShot(chosen.name, { seconds: chosen.seconds || 0, sayKey: chosen.sayKey, fade: 0.25 });
  }
}

function startChase() {
  chaseTargetX = THREE.MathUtils.clamp(pointerWorld.x, -limitX, limitX);
  if (Math.abs(chaseTargetX - rig.position.x) < 0.6) return enterIdle();

  state = 'CHASE';
  setFacing(chaseTargetX > rig.position.x ? 1 : -1);
  play(pickFor('walk', ANIM.walk.COMBAT, ANIM.walk.CAFE), { loop: true, fade: 0.12 });
}

function arriveChase() {
  playOneShot(pick(ANIM.arrive, ANIM.callsign), { sayKey: 'chase', fade: 0.12 });
  burst('star', 4);
}

function stopWalking() {
  if (mode === 'COMBAT' && actions[ANIM.stop]) playOneShot(ANIM.stop, { fade: 0.15, faceCamera: false });
  else enterIdle();
}

function runBehaviour() {
  if (!model) return planBehaviour(1500);

  if (state === 'IDLE') {
    const distToPointer = Math.abs(pointerWorld.x - rig.position.x);
    const shouldChase = mode === 'COMBAT' && pointerInside && distToPointer > 1.1;

    if (shouldChase) startChase();
    else if (Math.random() < 0.3) startWalking();
    else if (Math.random() < 0.8) idleVariation();
    else enterIdle();
  } else if (state === 'WALK') {
    if (Math.random() < 0.45) stopWalking();
    else setFacing(-facing);
  } else if (state === 'CHASE') {
    if (!pointerInside) enterIdle();
  }

  planBehaviour();
}

/* --------------------------------------------------------------------------
 * 7. Chuột: hover, kéo thả, ném
 * ------------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const hud = document.getElementById('hud');
const lastPointer = { x: 0, y: 0 };

let hovering = false;
let interactive = false;
let charMenuOpen = false;
let pointerInside = false;
let hoverCheckTimer = 0;
let hasPointer = false;

function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  if (window.pet) window.pet.setIgnoreMouse(!next);
}

function setHovering(next) {
  hovering = next;
  // Bảng gợi ý chỉ hiện khi bấm S — rê chuột vào pet không bung menu nữa
  // Menu nhân vật đang mở thì vẫn phải bấm được dù chuột rời khỏi pet
  setInteractive(next || charMenuOpen);
}

// Bảng gợi ý (HUD): bật/tắt bằng phím S
let hudPinned = false;

function toggleHud() {
  hudPinned = !hudPinned;
  hud.classList.toggle('visible', hudPinned);
}

// Menu nhân vật: mở bằng chuột phải (không tự bung khi rê chuột qua pet)
function openCharMenu() {
  charMenuOpen = true;
  charSelectorUI.show();
  setInteractive(true);
}

function closeCharMenu() {
  if (!charMenuOpen) return;
  charMenuOpen = false;
  charSelectorUI.hide();
  setHovering(isPointerOnPet());
}

function readPointer(event) {
  lastPointer.x = event.clientX;
  lastPointer.y = event.clientY;
  pointerNDC.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );
  pointerWorld.set(pointerNDC.x * view.halfWidth, pointerNDC.y * view.halfHeight);
}

function isPointerOnPet() {
  if (!model) return false;
  raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.intersectObject(rig, true).length > 0;
}

function onPointerMove(event) {
  const previousX = hasPointer ? lastPointer.x : event.clientX;
  readPointer(event);
  hasPointer = true;
  pointerInside = true;

  if (state === 'DRAG') {
    dragToPointer();
    return;
  }

  // Combat mode: Kei đuổi theo con trỏ
  if (state === 'CHASE') {
    chaseTargetX = THREE.MathUtils.clamp(pointerWorld.x, -limitX, limitX);
  }

  const hit = isPointerOnPet();
  if (hit !== hovering) setHovering(hit);

  handlePetting(event.clientX - previousX, hit);
}

// Rê chuột qua lại trên người Kei = xoa đầu
function handlePetting(dxPixels, hit) {
  const now = performance.now();
  if (!hit || state === 'DRAG' || state === 'FALL' || now < petReadyAt) return;
  if (Math.abs(dxPixels) < 1) return;

  if (now - rubLastAt > 320) rubAmount = 0;
  rubLastAt = now;

  const dir = Math.sign(dxPixels);
  rubAmount += dir === rubDir ? Math.abs(dxPixels) : Math.abs(dxPixels) * 0.5;
  rubDir = dir;

  if (rubAmount >= CONFIG.rubPixels) doPetting();
}

function doPetting() {
  rubAmount = 0;
  petCount++;
  petReadyAt = performance.now() + CONFIG.petCooldownMs;

  const name = mode === 'CAFE'
    ? pickFor('reaction', ANIM.reaction.CAFE)
    : pick(ANIM.callsign, ANIM.reaction.COMBAT);

  playOneShot(name, { seconds: CONFIG.reactionSeconds, fade: 0.12 });
  say(line(petCount % 4 === 0 ? 'petOver' : 'pet'), 1700);
  burst('heart', 7);
}

function onPointerDown(event) {
  if (charMenuOpen) closeCharMenu();
  if (event.button !== 0 || !model || state === 'DRAG') return;

  readPointer(event);

  // COMBAT: click bất kỳ đâu trong cửa sổ khi interactive → bắn
  if (mode === 'COMBAT' && interactive && state !== 'FALL' && state !== 'DEAD') {
    // Xoay mặt về hướng chuột
    yawTarget = lastPointer.x < worldToScreen(rig.position).x ? Math.PI : 0;
    spawnBullet();
    if (state !== 'ACTION') runAttackCombo();
    return;
  }

  if (!isPointerOnPet()) return;

  // Kéo khi đang ngồi → đứng dậy trước, không DRAG ngay
  if (sitting) { toggleSit(); return; }

  clearTimeout(restTimer);
  clearTimeout(behaviourTimer);

  state = 'DRAG';
  velocity.set(0, 0);
  dragMoved = 0;
  shakeFlips = 0;
  lastDragDir = 0;
  peakY = rig.position.y;
  dragOffset.set(rig.position.x - pointerWorld.x, rig.position.y - pointerWorld.y);
  lastPointerWorld.copy(pointerWorld);
  lastMoveTime = performance.now();

  setInteractive(true);
  yawTarget = 0;
}

function dragToPointer() {
  const now = performance.now();
  const dt = Math.max((now - lastMoveTime) / 1000, 1 / 240);
  lastMoveTime = now;

  const targetX = pointerWorld.x + dragOffset.x;
  const targetY = pointerWorld.y + dragOffset.y;

  const dx = targetX - rig.position.x;
  const dy = targetY - rig.position.y;
  dragMoved += Math.hypot(dx, dy);

  // Đổi hướng liên tục trong lúc kéo = lắc Kei
  if (Math.abs(dx) > 0.05) {
    const dir = Math.sign(dx);
    if (dir !== lastDragDir) {
      lastDragDir = dir;
      shakeFlips++;
    }
  }

  rig.position.x = THREE.MathUtils.clamp(targetX, -limitX, limitX);
  rig.position.y = Math.max(groundY, targetY);
  peakY = Math.max(peakY, rig.position.y);

  // Vận tốc làm mượt => ném theo quán tính khi buông tay
  velocity.x = THREE.MathUtils.lerp(velocity.x, dx / dt, 0.4);
  velocity.y = THREE.MathUtils.lerp(velocity.y, dy / dt, 0.4);

  // Nhấc khỏi mặt đất -> tư thế bị Sensei nhấc lên (Formation_Idle)
  if (rig.position.y > groundY + 0.1) {
    play(pick(ANIM.carried), { loop: true, fade: 0.15 });
  }
}

function onPointerUp(event) {
  if (state !== 'DRAG' || !model) return;
  if (event.button !== 0) return;

  readPointer(event);

  const isClick = dragMoved < 0.12 && rig.position.y <= groundY + 0.08;
  const now = performance.now();

  if (isClick) {
    rig.position.y = groundY;
    state = 'IDLE';
    if (now - lastClickAt < CONFIG.doubleClickMs) {
      lastClickAt = 0;
      runEx();
    } else {
      lastClickAt = now;
      doClickReaction();
    }
  } else if (shakeFlips >= CONFIG.shakeFlips && rig.position.y <= groundY + 0.08) {
    dizzy();
  } else {
    state = 'FALL';
    dropPeak = Math.max(peakY, rig.position.y);
    velocity.x = THREE.MathUtils.clamp(velocity.x, -12, 12);
    velocity.y = THREE.MathUtils.clamp(velocity.y, -9, 12);
  }

  // Trả lại trạng thái xuyên thấu theo vị trí chuột hiện tại
  setHovering(isPointerOnPet());
}

function doClickReaction() {
  const name = pickFor('reaction', ANIM.reaction[mode], ANIM.reaction.CAFE, ANIM.reaction.COMBAT);
  playOneShot(name, { seconds: CONFIG.reactionSeconds, fade: 0.12 });
  say(line('click'), 1600);
  burst('heart', 4);
}

// Bị lắc mạnh rồi thả -> choáng (Vital_Panic)
function dizzy() {
  rig.position.y = groundY;
  playOneShot(pickFor('panic', ANIM.panic), { sayKey: 'dizzy', fade: 0.1 });
  burst('star', 8);
}

// Tung tuyệt chiêu: Start -> Ing -> End nối bằng sự kiện finished
function runEx() {
  if (state === 'DRAG' || state === 'FALL') return;

  clearTimeout(restTimer);
  state = 'ACTION';
  yawTarget = 0;

  const started = play(ANIM.exStart, { loop: false, fade: 0.1 })
    || play('Exs', { loop: false, fade: 0.1 });
  if (!started) return enterIdle();

  say(line('ex'), 1600);
  burst('star', 9);
}

function playVictory() {
  clearTimeout(restTimer);
  state = 'ACTION';
  yawTarget = 0;

  if (!play(pickFor('victory', ANIM.victoryStart), { loop: false, fade: 0.15 })) return enterIdle();
  say(line('victory'), 1800);
  burst('star', 10);
}

window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointerleave', () => { pointerInside = false; });
// Chuột phải lên pet: mở/đóng menu nhân vật
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!isPointerOnPet()) return;
  if (charMenuOpen) closeCharMenu();
  else openCharMenu();
});

// Mất focus giữa lúc kéo (chuột rời khỏi vùng cửa sổ) -> thả nhẹ tại chỗ
window.addEventListener('blur', () => {
  if (state === 'DRAG') {
    state = 'FALL';
    dropPeak = Math.max(peakY, rig.position.y);
    velocity.set(0, 0);
  }
});

/* --------------------------------------------------------------------------
 * 8. Phím tắt
 * ------------------------------------------------------------------------ */
window.addEventListener('keydown', (event) => {
  if (!model) return;

  if (event.key === 's' || event.key === 'S') {
    event.preventDefault();
    toggleHud();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    if (state === 'DRAG' || state === 'FALL') return;
    cycleCharacter();
    return;
  }

  // Phím tạm để chỉnh hướng model: [ ] trục Z · Q/W trục Y · O/P trục X
  const orientKeys = { '[': ['z', -1], ']': ['z', 1], q: ['y', -1], w: ['y', 1], o: ['x', -1], p: ['x', 1] };
  const orient = orientKeys[event.key.toLowerCase()];
  if (orient) {
    event.preventDefault();
    nudgeModelRotation(orient[0], orient[1] * ORIENT_STEP);
    return;
  }

  if (event.key === '1') {
    mode = mode === 'CAFE' ? 'COMBAT' : 'CAFE';
    clearTimeout(restTimer);
    enterIdle();
    say(line(mode === 'CAFE' ? 'cafe' : 'combat'), 1500);
    burst(mode === 'CAFE' ? 'heart' : 'star', 4);
    return;
  }

  if (state === 'DRAG' || state === 'FALL') return;

  if (event.key === '2') return runEx();
  if (event.key === '3') return playVictory();
  if (event.key === '4') return toggleSit();

  if (event.key === 'Escape') {
    if (charMenuOpen) return closeCharMenu();
    if (hudPinned) return toggleHud();
    if (window.pet) window.pet.quit();
  }
});

/* --------------------------------------------------------------------------
 * 9. Cập nhật mỗi frame
 * ------------------------------------------------------------------------ */
function walkSpeedFor(mode) {
  return characterWalkSpeed || CONFIG.walkSpeed[mode];
}

function updateWalking(dt) {
  if (state === 'CHASE') {
    if (!pointerInside) return enterIdle();

    const dx = chaseTargetX - rig.position.x;
    if (Math.abs(dx) <= 0.3) return arriveChase();

    setFacing(dx > 0 ? 1 : -1);
    rig.position.x += Math.sign(dx) * Math.min(walkSpeedFor('COMBAT') * dt, Math.abs(dx));
    return;
  }

  if (state !== 'WALK') return;

  // Chưa quay xong thì xoay tại chỗ, không trượt ngang
  if (Math.abs(angleDelta(rig.rotation.y, yawTarget)) > 0.5) return;

  rig.position.x += facing * walkSpeedFor(mode) * dt;

  if (rig.position.x >= limitX) {
    rig.position.x = limitX;
    setFacing(-1);
  } else if (rig.position.x <= -limitX) {
    rig.position.x = -limitX;
    setFacing(1);
  }
}

function updatePhysics(dt) {
  if (state !== 'FALL') return;

  velocity.y += CONFIG.gravity * dt;
  rig.position.x += velocity.x * dt;
  rig.position.y += velocity.y * dt;

  // Đập mép màn hình -> nảy lại
  if (rig.position.x > limitX || rig.position.x < -limitX) {
    rig.position.x = THREE.MathUtils.clamp(rig.position.x, -limitX, limitX);
    velocity.x *= -CONFIG.bounceDamping;
  }

  if (rig.position.y <= groundY) land();
}

function land() {
  rig.position.y = groundY;

  const impact = Math.abs(velocity.y);
  const drop = Math.max(dropPeak - groundY, 0);
  velocity.set(0, 0);

  if (impact >= CONFIG.hardImpact || drop >= CONFIG.hardDrop) {
    die();
    return;
  }

  state = 'ACTION';
  yawTarget = 0;
  const name = pickFor('reaction', ANIM.reaction[mode], ANIM.reaction.CAFE, ANIM.reaction.COMBAT);
  if (!play(name, { loop: false, fade: 0.12 })) enterIdle();
}

function die() {
  clearTimeout(restTimer);
  state = 'DEAD';
  velocity.set(0, 0);
  rig.position.y = groundY;
  yawTarget = 0;

  // Nếu clip Vital_Death không tồn tại, tự đứng dậy sau 0.7s
  if (!play(pickFor('death', ANIM.death), { loop: false, fade: 0.08 })) scheduleIdle(700);

  say(line('throw'), 1200);
  burst('star', 5);
}

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (mixer) mixer.update(dt);
  rig.rotation.y = dampAngle(rig.rotation.y, yawTarget, 12, dt);
  if (staticMotion) updateStaticMotion(dt, time);
  if (haloPivot) haloPivot.position.y = haloBaseY + Math.sin(time * 2.2) * 0.012;

  updateWalking(dt);
  updatePhysics(dt);

  updateBubble();
  drawFx(dt);

  // Kei đi ngang qua dưới con trỏ => cập nhật lại vùng bấm mỗi 120ms
  hoverCheckTimer += dt;
  if (pointerInside && state !== 'DRAG' && hoverCheckTimer > 0.12) {
    hoverCheckTimer = 0;
    const hit = isPointerOnPet();
    if (hit !== hovering) setHovering(hit);
  }

  outlineEffect.render(scene, camera);
}

applyViewport();
window.addEventListener('resize', applyViewport);
renderer.setAnimationLoop(frame);

/* --------------------------------------------------------------------------
 * 10. Debug nhanh trong DevTools
 * ------------------------------------------------------------------------ */
window.__kei = {
  get state() { return state; },
  get mode() { return mode; },
  get hovering() { return hovering; },
  get interactive() { return interactive; },
  get animation() { return currentAction ? currentAction.getClip().name : null; },
  get animations() { return Object.keys(actions); },
  get position() { return rig.position.toArray(); },
  get yaw() { return rig.rotation.y; },
  get walkSpeed() { return walkSpeedFor('CAFE'); },

  // Toạ độ màn hình của đỉnh đầu Kei (neo bong bóng thoại)
  screenPos() { return headScreenPos() || { x: 0, y: 0 }; },

  // Chat controls
  ask(text)      { return askKei(text); },
  clearChat()    { chatHistory.length = 0; console.log('[Chat] History cleared.'); },
  setKey(k)      { CONFIG.apiKey = k; console.log('[Chat] API key updated.'); },
  switchChar(id) { return switchCharacter(id); },
  unlock(id)     { return unlockCharacter(id); },
  charInfo(id) {
    const char = findCharacter(id);
    return char ? {
      id: char.id, name: char.name, model: char.model, modelFile: char.modelFile || null,
      unlocked: char.unlocked, core: Boolean(char.core), variant: char.variant || null,
      personality: char.personality || null, catchphrase: char.catchphrase || null
    } : null;
  },
  get memory()    { return { ...renderer.info.memory }; },   // kiểm tra rò rỉ khi đổi model
  get orientation() {
    if (!model) return null;
    const deg = (value) => Math.round(THREE.MathUtils.radToDeg(value));
    return { x: deg(model.rotation.x), y: deg(model.rotation.y), z: deg(model.rotation.z) };
  },
  get char()      { return currentChar.id; },
  get chars()     { return Object.keys(CHARACTERS); },
  get coreChars() { return Object.keys(CORE_CHARACTERS); },
  get charCount() { return Object.keys(CHARACTERS).length; },
  get registry()  { return registryStatus; }
};

/* --------------------------------------------------------------------------
 * 11. Khởi động: quét BlueArchiveModels rồi nạp nhân vật cốt lõi
 * ------------------------------------------------------------------------ */
startCharacterSystem();