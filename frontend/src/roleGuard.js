import { setupAdminPanel } from './admin.js';

export function initRoleGuard() {
    const user = window.currentUser;
    if (!user) return;

    // Update User Badge
    const userBadge = document.getElementById('userBadge');
    if (userBadge) {
        userBadge.innerHTML = `<i class="fa-solid fa-user"></i> ${user.displayName} (${user.role.toUpperCase()})`;
    }

    // Role-based visibility
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    
    if (user.role === 'admin') {
        // Admin
        if (adminPanelBtn) adminPanelBtn.style.display = 'block';
        setupAdminPanel();
    } else {
        // Operator / Viewer
        if (adminPanelBtn) adminPanelBtn.style.display = 'none';
        
        if (user.role === 'viewer') {
            // Sembunyikan elemen-elemen spesifik PTT jika rolenya viewer
            document.querySelectorAll('[data-require-operator]').forEach(el => {
                el.style.display = 'none';
            });
            // Hapus event click pop-up Panggilan Operator
            // (akan dihandle di map.js tapi sebagai jaring pengaman, hide saja)
            const style = document.createElement('style');
            style.innerHTML = `
                .popup-call-btn { display: none !important; }
            `;
            document.head.appendChild(style);
        }
    }

    // Logout button handler
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (!confirm('Apakah Anda yakin ingin keluar?')) return;
            try {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            } catch (err) {
                console.error(err);
            } finally {
                location.reload();
            }
        });
    }
}