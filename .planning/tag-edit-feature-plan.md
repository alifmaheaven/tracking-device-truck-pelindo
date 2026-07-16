# Plan: Tag Edit Feature

**Goal:** Tambah tombol edit pada area tags di sidebar device card. Hover → muncul edit button → klik → modal edit tags dengan GET/PUT N8N API.

**Date:** 2026-07-15

---

## Files yang Akan Dimodifikasi

| File | Perubahan |
|------|-----------|
| `backend/server.js` | Extend N8N proxy dari `app.get` ke `app.all` untuk support PUT method + forward request body |
| `frontend/index.html` | Tambah modal `tagEditModal` di bawah modal lainnya |
| `frontend/src/map.js` | Tambah `tags-wrapper` container + edit button di `renderDeviceList()`, tambah logic buka/tutup modal + API calls |
| `frontend/style.css` | Style baru: `.tags-wrapper`, `.tag-edit-btn`, `.tag-chips-container`, `.tag-chip`, dll |

---

## Phase 1: Backend — Extend N8N Proxy untuk PUT

**File: `backend/server.js` line 127**

**Current state:**
```js
app.get('/api/proxy/n8n', authMiddleware, async (req, res) => {
```

**Masalah:** Hanya support GET. `PUT /webhook/update-tags` tidak bisa lewat sini.

**Rencana:**
- Ubah `app.get` → `app.all` supaya semua HTTP method diterima (GET, PUT, POST, dll)
- Forward `req.method`, `req.body`, dan `content-type` header ke upstream N8N
- Jaga backward compatibility — existing GET calls tetap jalan tanpa perubahan
- Tambah check: jika `req.body` ada, forward sebagai JSON body di fetch call

**Kode baru (pseudocode):**
```js
app.all('/api/proxy/n8n', authMiddleware, async (req, res) => {
  // ... SSRF check, host rewrite (existing logic, ga berubah) ...
  
  const fetchOptions = {
    method: req.method,
    redirect: 'manual',
    signal: controller.signal,
  };
  
  // Forward body for non-GET methods
  if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(req.body);
  }
  
  response = await fetch(finalUrl, fetchOptions);
  // ... rest existing logic ...
});
```

**Security considerations:**
- Auth middleware tetap berlaku — hanya user authenticated yang bisa panggil PUT
- SSRF check tetap jalan (allowed hosts)
- Timeout + body cap tetap berlaku
- Admin-only untuk tag edit? User bilang ga perlu explicit role check, tapi auth middleware sudah memastikan user terautentikasi

---

## Phase 2: Frontend HTML — Modal Tag Edit

**File: `frontend/index.html`**

Tambah modal baru setelah `historyModal` (sekitar line 260):

```html
<!-- Tag Edit Modal -->
<div id="tagEditModal" class="modal-overlay">
    <div class="modal-content" style="max-width: 480px; height: auto; min-height: 380px;">
        <div class="modal-header">
            <h3><i class="fa-solid fa-tags"></i> Edit Tag: <span id="tagModalDeviceName">-</span></h3>
            <button id="closeTagModalBtn" class="close-btn"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body" style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
            <div id="tagModalLoading" style="text-align: center; color: var(--text-muted); padding: 20px;">
                <i class="fa-solid fa-spinner fa-spin"></i> Memuat tags...
            </div>
            <div id="tagModalContent" style="display: none; flex-direction: column; gap: 16px;">
                <!-- Current tags as chips -->
                <div>
                    <label style="font-size: 13px; font-weight: 600; color: #475569;">
                        <i class="fa-solid fa-tag"></i> Tags Saat Ini
                    </label>
                    <div id="tagChipsContainer" class="tag-chips-container">
                        <!-- Chips rendered dynamically -->
                    </div>
                </div>
                <!-- Add new tag -->
                <div>
                    <label style="font-size: 13px; font-weight: 600; color: #475569;">
                        <i class="fa-solid fa-plus"></i> Tambah Tag Baru
                    </label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="newTagInput" 
                               placeholder="Nama tag..." maxlength="30"
                               style="flex: 1; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px;">
                        <button id="addTagBtn" 
                                style="padding: 10px 16px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            <i class="fa-solid fa-plus"></i> Tambah
                        </button>
                    </div>
                </div>
                <div id="tagError" style="display: none; padding: 10px 14px; background: #fee2e2; color: #dc2626; border-radius: 8px; font-size: 13px; font-weight: 500;"></div>
            </div>
        </div>
        <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end;">
            <button id="cancelTagEditBtn" style="padding: 10px 20px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; font-weight: 600;">
                Batal
            </button>
            <button id="saveTagBtn" style="padding: 10px 20px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                <i class="fa-solid fa-floppy-disk"></i> Simpan
            </button>
        </div>
    </div>
</div>
```

---

## Phase 3: Frontend — Tag Edit Logic (di `map.js`)

**File: `frontend/src/map.js`**

### 3a. Modifikasi `renderDeviceList()` — tags wrapper + edit button

**Current (line 227-231):**
```js
let tagsHtml = '<div style="color: var(--text-muted); font-size: 13px; font-style: italic;">No Tag</div>';
if (device.tags && device.tags.length > 0) {
  const badges = device.tags.map(tag => ...).join('');
  tagsHtml = `<div class="device-tags" style="display: flex; flex-wrap: wrap; gap: 8px;">${badges}</div>`;
}
```

**New:**
```js
let tagsHtml = `<div class="tags-wrapper" style="flex: 1; display: flex; align-items: center; gap: 6px;">`;
if (device.tags && device.tags.length > 0) {
  const badges = device.tags.map(tag => `<span class="tag-badge" ...>...</span>`).join('');
  tagsHtml += `<div class="device-tags" ...>${badges}</div>`;
} else {
  tagsHtml += `<div style="color: var(--text-muted); font-size: 13px; font-style: italic;">No Tag</div>`;
}
tagsHtml += `<button class="tag-edit-btn" id="edit-tag-btn-${escapeHtml(device.id)}" 
               title="Edit tags" data-device-id="${escapeHtml(device.id)}" 
               data-device-name="${escapeHtml(device.truckNumber || device.id)}">
               <i class="fa-solid fa-pen-to-square"></i>
             </button>`;
tagsHtml += `</div>`;
```

Edit button muncul via CSS hover pada `.tags-wrapper`.

### 3b. Bind edit button click handler

Di `renderDeviceList()`, setelah innerHTML card di-set, tambah:

```js
// Bind tag edit button
const editTagBtn = card.querySelector('.tag-edit-btn');
if (editTagBtn) {
  editTagBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // jangan trigger focusDevice
    openTagModal(device.id, device.truckNumber || device.id);
  });
}
```

### 3c. Ekspor fungsi `openTagModal` dari `map.js`

```js
export function openTagModal(deviceId, truckNumber) {
  const modal = document.getElementById('tagEditModal');
  const nameEl = document.getElementById('tagModalDeviceName');
  const loading = document.getElementById('tagModalLoading');
  const content = document.getElementById('tagModalContent');
  const error = document.getElementById('tagError');
  
  if (!modal) return;
  
  // Reset state
  nameEl.textContent = truckNumber;
  loading.style.display = 'block';
  content.style.display = 'none';
  error.style.display = 'none';
  document.getElementById('newTagInput').value = '';
  
  modal.classList.add('active');
  modal._tagDeviceId = deviceId; // store device ID for save
  
  // Fetch current tags
  fetchDeviceTags(deviceId);
}

async function fetchDeviceTags(deviceId) {
  const proxyUrl = `/api/proxy/n8n?url=${encodeURIComponent('https://ptt.teluklamong.co.id/webhook/tags?deviceId=' + deviceId)}`;
  
  try {
    const resp = await fetch(proxyUrl, { credentials: 'include' });
    if (!resp.ok) throw new Error('Failed to fetch tags');
    const data = await resp.json();
    
    const tags = Array.isArray(data) ? data : (data.tags || []);
    renderTagChips(tags);
    
    document.getElementById('tagModalLoading').style.display = 'none';
    document.getElementById('tagModalContent').style.display = 'flex';
  } catch (err) {
    console.error('Gagal fetch tags:', err);
    document.getElementById('tagModalLoading').innerHTML = 
      '<i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat tags. <button onclick="document.getElementById(\'closeTagModalBtn\').click()">Tutup</button>';
  }
}

function renderTagChips(tags) {
  const container = document.getElementById('tagChipsContainer');
  if (!container) return;
  
  const normalized = tags.map(t => typeof t === 'string' ? { tagValue: t } : t);
  container.innerHTML = normalized.map((tag, idx) => `
    <span class="tag-chip">
      <i class="fa-solid fa-tag"></i> ${escapeHtml(tag.tagValue || tag)}
      <button class="tag-chip-remove" data-tag-idx="${idx}" title="Hapus tag">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>
  `).join('');
  
  // Bind remove buttons
  container.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove from internal array, re-render
      const idx = parseInt(btn.dataset.tagIdx);
      const currentTags = getCurrentTagsFromUI();
      currentTags.splice(idx, 1);
      renderTagChips(currentTags);
    });
  });
}
```

### 3d. Save logic

Bind save button click (di `openTagModal` atau di `script.js`):

```js
document.getElementById('saveTagBtn').addEventListener('click', async () => {
  const deviceId = document.getElementById('tagEditModal')._tagDeviceId;
  const tags = getCurrentTagsFromUI();
  
  try {
    const resp = await fetch('/api/proxy/n8n', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://ptt.teluklamong.co.id/webhook/update-tags',
        deviceId: deviceId,
        tags: tags
      })
    });
    
    if (!resp.ok) throw new Error('Failed to update tags');
    
    // Close modal
    document.getElementById('closeTagModalBtn').click();
    
    // Refresh device data
    fetchDeviceData();
  } catch (err) {
    console.error('Gagal update tags:', err);
    const errorEl = document.getElementById('tagError');
    errorEl.style.display = 'block';
    errorEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Gagal menyimpan tags. Silakan coba lagi.';
  }
});
```

Wait, untuk PUT body — karena N8N proxy mem-forward PUT body ke N8N, yang dikirim harus sesuai format N8N webhook. User bilang:
- `PUT /webhook/update-tags` dengan body `{ deviceId, tags: [] }`

Jadi body yang dikirim ke N8N melalui proxy:
```json
{ "deviceId": "...", "tags": ["tag1", "tag2"] }
```

Dan tags harus diflatten dari `[{tagValue: "x"}]` menjadi `["x", "y"]` array of strings.

### 3e. Helper: `getCurrentTagsFromUI()`

```js
function getCurrentTagsFromUI() {
  const chips = document.querySelectorAll('#tagChipsContainer .tag-chip');
  return Array.from(chips).map(chip => {
    const text = chip.textContent.trim();
    return { tagValue: text };
  });
}
```

Atau lebih baik simpan array internal (biar ga parse DOM). Gunakan closure variable `_currentTags` di module scope.

### 3f. Add tag button

```js
document.getElementById('addTagBtn').addEventListener('click', () => {
  const input = document.getElementById('newTagInput');
  const value = input.value.trim();
  if (!value) return;
  
  const currentTags = _tagModalCurrentTags;
  currentTags.push({ tagValue: value });
  renderTagChips(currentTags);
  input.value = '';
  input.focus();
});
```

Juga bind Enter key di input:
```js
document.getElementById('newTagInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('addTagBtn').click();
});
```

### 3g. Close modal logic

```js
document.getElementById('closeTagModalBtn').addEventListener('click', () => {
  document.getElementById('tagEditModal').classList.remove('active');
});
document.getElementById('cancelTagEditBtn').addEventListener('click', () => {
  document.getElementById('closeTagModalBtn').click();
});
```

---

## Phase 4: CSS — Styling

**File: `frontend/style.css`**

```css
/* Tags Wrapper + Edit Button */
.tags-wrapper {
    position: relative;
}

.tag-edit-btn {
    display: none;
    background: none;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 4px 8px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.tags-wrapper:hover .tag-edit-btn {
    display: inline-flex;
    align-items: center;
}

.tag-edit-btn:hover {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
}

/* Tag Chips in Modal */
.tag-chips-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px;
    background: var(--bg-light);
    border: 1px solid var(--border);
    border-radius: 8px;
    min-height: 44px;
}

.tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #e0e7ff;
    color: #4f46e5;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
}

.tag-chip-remove {
    background: none;
    border: none;
    color: #6366f1;
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
    display: flex;
    align-items: center;
    border-radius: 50%;
    transition: all 0.2s;
}

.tag-chip-remove:hover {
    background: #c7d2fe;
    color: #4338ca;
}

/* Modal Footer */
.modal-footer {
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    background: var(--bg-light);
    border-radius: 0 0 12px 12px;
}
```

---

## N8N Webhook Contracts

### GET /webhook/tags?deviceId={deviceId}
**Response:** `[{tagValue: "priority"}, {tagValue: "VIP"}, ...]` (array of tag objects)
OR kemungkinan: `{ tags: [...] }` — perlu dicek pas test

### PUT /webhook/update-tags
**Request body:** `{ deviceId: "...", tags: ["tag1", "tag2", ...] }` (tags as string array)
**Response:** `{ success: true }` atau sejenisnya

Karena user bilang endpoint sudah ada di n8n, aku perlu test dulu format response persisnya saat implementasi.

---

## Solusi: Handling N8N Proxy PUT Body

Masalah: `app.all('/api/proxy/n8n')` menerima body `{ url, deviceId, tags }` dari frontend. Ini perlu dipisah — `url` adalah tujuan di N8N, sisanya (`deviceId`, `tags`) adalah body ke N8N.

**Pendekatan 1 (Clean — Separate URL from body):**
Frontend kirim body `{ tags: [...], deviceId: "..." }` ke proxy, sementara URL target dikirim via query param. Backend forward body ke N8N, buang `url` param dari body.

**Pendekatan 2 (Simple — Direct proxy of full body):**
Backend hanya forward seluruh `req.body` ke N8N. Frontend gabung `url` dan `deviceId` + `tags` dalam satu body. Backend extract `url` dari body untuk target, sisanya forward.

Aku pilih **Pendekatan 1** — lebih clean. URL tetap di query param seperti GET, body hanya berisi data untuk N8N (tanpa `url` field). Ini backward compatible karena GET calls tidak kirim body.

---

## Risk & Edge Cases

1. **Tags kosong** — GET return empty array `[]` → tampilkan "Belum ada tag" di modal
2. **Tags max length** — input maxlength="30", chip juga dibatasi jumlah (suggest max 10 tags)
3. **Concurrent edits** — setelah save, refresh penuh `fetchDeviceData()` supaya data sinkron
4. **Network error** — tampilkan error di modal, jangan tutup modal
5. **Auth** — semua API call pakai `credentials: 'include'`, jika session expired user akan di-redirect ke login oleh existing middleware
6. **Empty tag value** — validasi client-side, jangan izinkan whitespace-only tag
7. **Duplicate tags** — bisa dicek saat add, case-insensitive

---

## Implementation Notes

### Actual Changes (vs Plan)

| Step | File | Status | Notes |
|------|------|--------|-------|
| 1 | `backend/server.js:127` | ✅ DONE | `app.get` → `app.all`, tambah `fetchOptions` method + body forwarding for non-GET |
| 2 | `frontend/index.html` | ✅ DONE | Modal `tagEditModal` setelah `resetPasswordModal` (~373) |
| 3 | `frontend/src/map.js` | ✅ DONE | Modif `renderDeviceList()` tags wrapper + edit button; tambah `openTagModal()`, `_fetchDeviceTags()`, `_renderTagChips()`, `_saveTags()`, `_addTag()`, `_initTagModalHandlers()` (~274 lines) |
| 4 | `frontend/style.css` | ✅ DONE | `.tags-wrapper`, `.tag-edit-btn`, `.tag-chips-container`, `.tag-chip`, `.tag-chip-remove`, `.tag-modal-footer`, `.tag-modal-btn` (~142 lines) |

### Deviasi dari Plan

1. **Wiring di `script.js` tidak perlu** — semua tag modal logic self-contained di `map.js`, event handlers binding via `_initTagModalHandlers()` pada module load. Edit button click di-bind pake `btn.onclick` di `renderDeviceList()` (pattern sama kayak `bindForceLogoutButtons`).
2. **PUT body ke proxy**: URL target tetap di query param (`?url=...`), body hanya `{ deviceId, tags }` tanpa field `url` — backend forward body mentah ke N8N.
3. **Tags disimpan sebagai `string[]`** ke N8N (`["VIP", "Priority"]`), bukan `[{tagValue: "x"}]`. Normalisasi di `_fetchDeviceTags()` handle format apapun dari N8N response.
4. **Internal internal state** `_tagState` (closure di module) untuk tracking tags tanpa parse DOM — lebih reliable.

### Summary of Changes

| Step | File | Action |
|------|------|--------|
| 1 | `backend/server.js:127` | Ubah `app.get` → `app.all`, add method + body forwarding |
| 2 | `frontend/index.html` | Tambah `tagEditModal` HTML (47 lines) |
| 3 | `frontend/src/map.js` | Modifikasi `renderDeviceList()` tag rendering + edit button bind, tambah `openTagModal()` + helper functions (~274 lines) |
| 4 | `frontend/style.css` | Tambah CSS untuk tag edit feature (~142 lines) |
