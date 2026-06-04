let usersCache = [];

export function setupAdminPanel() {
    const panel = document.getElementById('adminPanelModal');
    const closePanel = document.getElementById('closeAdminPanelBtn');
    const tbody = document.getElementById('userTableBody');
    const btnCreate = document.getElementById('btnCreateUser');
    const btnAdmin = document.getElementById('adminPanelBtn');
    if (!panel || !btnAdmin) return;

    // Sub-modal form
    const formModal = document.getElementById('userFormModal');
    const formTitle = document.getElementById('userFormTitle');
    const closeForm = document.getElementById('closeUserFormBtn');
    const btnCancel = document.getElementById('btnCancelUserForm');
    const btnSave = document.getElementById('btnSaveUser');
    const ufError = document.getElementById('ufError');
    let editingUserId = null;

    btnAdmin.onclick = () => { panel.classList.add('active'); fetchUsers(); };
    closePanel.onclick = () => panel.classList.remove('active');
    closeForm.onclick = btnCancel.onclick = () => formModal.classList.remove('active');
    btnCreate.onclick = () => openForm();

    function openForm(user = null) {
        editingUserId = user ? user._id : null;
        formTitle.innerHTML = user
            ? '<i class="fa-solid fa-pen-to-square"></i> Edit User'
            : '<i class="fa-solid fa-user-plus"></i> Tambah User';
        document.getElementById('ufUsername').value = user ? user.username : '';
        document.getElementById('ufUsername').disabled = !!user;
        document.getElementById('ufDisplayName').value = user ? user.displayName : '';
        document.getElementById('ufPassword').value = '';
        document.getElementById('ufPasswordGroup').style.display = user ? 'none' : 'block';
        document.getElementById('ufActiveGroup').style.display = user ? 'block' : 'none';
        document.getElementById('ufIsActive').checked = user ? user.isActive : true;
        if (user) {
            const radio = document.querySelector(`input[name="ufRole"][value="${user.role}"]`);
            if (radio) radio.checked = true;
        } else {
            document.querySelector('input[name="ufRole"][value="operator"]').checked = true;
        }
        ufError.style.display = 'none';
        formModal.classList.add('active');
    }

    btnSave.onclick = async () => {
        const username = document.getElementById('ufUsername').value.trim();
        const password = document.getElementById('ufPassword').value;
        const displayName = document.getElementById('ufDisplayName').value.trim();
        const role = document.querySelector('input[name="ufRole"]:checked')?.value;
        const isActive = document.getElementById('ufIsActive').checked;

        if (!username || !displayName || !role) {
            showFormError('Semua field wajib diisi');
            return;
        }
        if (!editingUserId && password.length < 8) {
            showFormError('Password minimal 8 karakter');
            return;
        }

        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

        try {
            const isCreate = !editingUserId;
            const url = isCreate ? '/api/admin/users' : `/api/admin/users/${editingUserId}`;
            const method = isCreate ? 'POST' : 'PUT';
            const body = isCreate
                ? { username, password, displayName, role }
                : { displayName, role, isActive };

            const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            formModal.classList.remove('active');
            fetchUsers();
        } catch (err) {
            showFormError(err.message);
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
        }
    };

    function showFormError(msg) {
        ufError.innerText = msg;
        ufError.style.display = 'block';
    }

    async function fetchUsers() {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</td></tr>';
        try {
            const res = await fetch('/api/admin/users', { credentials: 'include' });
            if (!res.ok) throw new Error('Gagal');
            usersCache = await res.json();
            renderTable();
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#ef4444;">Gagal memuat data</td></tr>';
        }
    }

    function renderTable() {
        tbody.innerHTML = '';
        usersCache.forEach(u => {
            const isMe = u._id === window.currentUser?.id;
            const roleColors = { admin: '#ef4444', operator: '#3b82f6', viewer: '#10b981' };
            const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #e2e8f0';
            tr.innerHTML = `
                <td style="padding:12px;font-weight:500;">${u.username}${isMe ? ' <span style="font-size:10px;color:#94a3b8;">(Anda)</span>' : ''}</td>
                <td style="padding:12px;color:#475569;">${u.displayName}</td>
                <td style="padding:12px;"><span style="color:${roleColors[u.role]};font-weight:600;">${u.role.toUpperCase()}</span></td>
                <td style="padding:12px;">${u.isActive ? '<span style="background:#dcfce7;color:#059669;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Aktif</span>' : '<span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Nonaktif</span>'}</td>
                <td style="padding:12px;font-size:12px;color:#64748b;">${lastLogin}</td>
                <td style="padding:12px;text-align:right;white-space:nowrap;">
                    <button class="btn-edit" data-id="${u._id}" title="Edit" style="background:none;border:none;color:#3b82f6;cursor:pointer;margin-right:6px;font-size:16px;"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn-reset" data-id="${u._id}" title="Reset Password" style="background:none;border:none;color:#f59e0b;cursor:pointer;margin-right:6px;font-size:16px;"><i class="fa-solid fa-key"></i></button>
                    ${!isMe ? `<button class="btn-delete" data-id="${u._id}" title="Hapus" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>`;
            tbody.appendChild(tr);
        });

        // Bind events
        tbody.querySelectorAll('.btn-edit').forEach(b => b.onclick = () => {
            const u = usersCache.find(x => x._id === b.dataset.id);
            if (u) openForm(u);
        });
        tbody.querySelectorAll('.btn-delete').forEach(b => b.onclick = () => {
            if (confirm('Hapus user ini? Tindakan tidak dapat dibatalkan.')) deleteUser(b.dataset.id);
        });
        tbody.querySelectorAll('.btn-reset').forEach(b => b.onclick = () => {
            const pw = prompt('Password baru (min 8 karakter):');
            if (pw && pw.length >= 8) resetPassword(b.dataset.id, pw);
            else if (pw) alert('Password minimal 8 karakter!');
        });
    }

    async function deleteUser(id) {
        try {
            const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error((await res.json()).error);
            fetchUsers();
        } catch (e) { alert('Gagal: ' + e.message); }
    }

    async function resetPassword(id, newPassword) {
        try {
            const res = await fetch(`/api/admin/users/${id}/reset-password`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }), credentials: 'include'
            });
            if (!res.ok) throw new Error((await res.json()).error);
            alert('Password berhasil direset!');
        } catch (e) { alert('Gagal: ' + e.message); }
    }
}