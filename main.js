'use strict';

const { app, BrowserWindow, ipcMain, protocol, screen, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const APP_ROOT = __dirname;
const SCHEME = 'pet';
const APP_URL = `${SCHEME}://kei/index.html`;

// Giao thức riêng "pet://" để nạp ES module + three.js từ node_modules mà không cần
// dev server và không cần mạng (file:// bị Chromium chặn import module).
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance'
};

async function serveFile(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(APP_ROOT, relative);
  const rootPrefix = APP_ROOT.endsWith(path.sep) ? APP_ROOT : APP_ROOT + path.sep;

  if (!filePath.startsWith(rootPrefix)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/* --------------------------------------------------------------------------
 * Settings — lưu bằng file trong userData (localStorage không đáng tin trong
 * Electron khi bật CSP). File: %APPDATA%/<tên app>/settings.json
 * ------------------------------------------------------------------------ */
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function writeSettings(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;

  const file = settingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return true;
}

/* --------------------------------------------------------------------------
 * BlueArchiveModels — quét toàn bộ file .glb và gom theo nhân vật + skin
 * "Arisu (Battle) (Carrier).glb" -> base "Arisu", variant "Battle · Carrier"
 * ------------------------------------------------------------------------ */
const MODEL_DIR = path.join(APP_ROOT, 'BlueArchiveModels');

function parseModelFileName(file) {
  const stem = file.replace(/\.glb$/i, '');
  const variants = [...stem.matchAll(/\(([^)]*)\)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const base = stem.replace(/\s*\([^)]*\)/g, '').trim() || stem;

  return { base, variant: variants.length ? variants.join(' · ') : null };
}

async function listModels() {
  try {
    const entries = await fs.readdir(MODEL_DIR, { withFileTypes: true });
    const groups = new Map();

    for (const entry of entries) {
      if (!entry.isFile() || !/\.glb$/i.test(entry.name)) continue;

      const { base, variant } = parseModelFileName(entry.name);
      if (!groups.has(base)) groups.set(base, { base, files: [] });

      groups.get(base).files.push({
        file: entry.name,
        variant,
        url: `./BlueArchiveModels/${encodeURIComponent(entry.name)}`
      });
    }

    const result = [...groups.values()];
    for (const group of result) {
      group.files.sort((a, b) => {
        if (Boolean(a.variant) !== Boolean(b.variant)) return a.variant ? 1 : -1; // bản gốc đứng trước
        return a.file.localeCompare(b.file, 'en');
      });
    }
    result.sort((a, b) => a.base.localeCompare(b.base, 'en'));

    const count = result.reduce((sum, group) => sum + group.files.length, 0);
    return { ok: true, dir: 'BlueArchiveModels', count, groups: result };
  } catch (error) {
    return { ok: false, error: error.message, count: 0, groups: [] };
  }
}

let win = null;

function createWindow() {
  // workArea đã trừ thanh Taskbar => đáy cửa sổ chính là mép trên Taskbar
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Giữ animation chạy mượt kể cả khi cửa sổ không được focus
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Mặc định xuyên thấu click; renderer bật lại khi chuột trỏ trúng Kei hoặc UI
  win.setIgnoreMouseEvents(true, { forward: true });

  // Log của renderer ra terminal để dễ debug model/animation
  win.webContents.on('console-message', (event) => {
    if (event && event.message) console.log(event.message);
  });

  win.once('ready-to-show', () => win.showInactive());
  win.loadURL(APP_URL);

  win.on('closed', () => {
    win = null;
  });
}

app.setName('Kei Desktop Pet');

app.whenReady().then(() => {
  protocol.handle(SCHEME, serveFile);

  // SpeechRecognition cần quyền micro. Electron mặc định có thể chặn vì không
  // có prompt UI, nên cho phép rõ ràng riêng quyền media/audioCapture.
  const isAudioPermission = (permission) =>
    permission === 'media' || permission === 'audioCapture' || permission === 'microphone';

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isAudioPermission(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return isAudioPermission(permission);
  });

  ipcMain.handle('pet:list-models', () => listModels());

  ipcMain.handle('pet:load-settings', () => readSettings());
  ipcMain.handle('pet:save-settings', async (_event, data) => {
    try {
      return await writeSettings(data);
    } catch (error) {
      console.error('[Kei] Không ghi được settings:', error.message);
      return false;
    }
  });

  ipcMain.on('pet:ignore-mouse', (_event, ignore) => {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
    }
  });

  ipcMain.on('pet:quit', () => {
    app.quit();
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
