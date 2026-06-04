import { state } from './state.js';

let _config = {};
let apiUrl = '';

export function setupAuth(config) {
    _config = config;
    apiUrl = config.apiUrl || '';
    const { onAuthenticated } = config;

    const overlay = document.getElementById('captchaOverlay');
    const imgContainer = document.getElementById('captchaImage');
    const input = document.getElementById('captchaInput');
    const submitBtn = document.getElementById('captchaSubmit');
    const errorMsg = document.getElementById('captchaError');
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');

    // Ambil Captcha dari backend
    async function refreshCaptcha() {
        try {
            imgContainer.innerHTML = '<div style="color: #64748b; font-size: 12px; line-height: 50px;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';
            // Gunakan path relatif, dilayani proxy Vite saat dev, nginx saat prod
            const res = await fetch('/api/captcha');
            if (res.ok) {
                const svgText = await res.text();
                imgContainer.innerHTML = svgText;
            }
        } catch (err) {
            console.error('Gagal memuat captcha:', err);
            imgContainer.innerHTML = '<div style="color: #ef4444; font-size: 12px; line-height: 50px;">Gagal memuat</div>';
        }
        input.value = '';
    }

    async function checkExistingAuth() {
        try {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            if (res.ok) {
                const user = await res.json();
                window.currentUser = user;
                overlay.classList.remove('active');
                onAuthenticated();
                return true;
            }
            return false;
        } catch (err) {
            console.error('Cek auth error:', err);
            return false;
        }
    }

    async function handleLogin() {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const captchaCode = input.value.trim();

        if (!username || !password || !captchaCode) {
            errorMsg.innerText = 'Harap isi semua field';
            errorMsg.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, captchaCode }),
                credentials: 'include'
            });
            
            const data = await res.json();
            
            if (res.ok && data.success) {
                window.currentUser = data.user;
                overlay.classList.remove('active');
                onAuthenticated();
            } else {
                // Gagal (wrong password, lockout, etc)
                errorMsg.innerText = data.message || 'Login gagal';
                errorMsg.style.display = 'block';
                passwordInput.value = '';
                refreshCaptcha();
            }
        } catch (err) {
            console.error('Login error:', err);
            errorMsg.innerText = 'Terjadi kesalahan jaringan';
            errorMsg.style.display = 'block';
            refreshCaptcha();
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }

    // Bindings
    imgContainer.addEventListener('click', refreshCaptcha);

    submitBtn.addEventListener('click', handleLogin);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Initial check
    checkExistingAuth().then(isAuth => {
        if (!isAuth) refreshCaptcha();
    });
}