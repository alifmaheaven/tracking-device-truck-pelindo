/**
 * Mendapatkan informasi tampilan baterai berdasarkan nilai persentase.
 * @param {number|string} batteryVal 
 * @returns {object} { color, icon, text }
 */
export function getBatteryDisplay(batteryVal) {
    const val = parseFloat(batteryVal || 0);
    let color = '#ef4444'; // Merah
    let icon = 'fa-battery-quarter';
    
    if (val >= 70) {
        color = '#10b981'; // Hijau
        icon = 'fa-battery-full';
    } else if (val >= 30) {
        color = '#f59e0b'; // Kuning
        icon = 'fa-battery-half';
    } else if (val <= 10) {
        icon = 'fa-battery-empty';
    }
    
    const text = !isNaN(val) ? val.toFixed(0) + '%' : 'N/A';
    
    return { color, icon, text };
}

/**
 * Memainkan audio PCM mentah menggunakan Web Audio API.
 * @param {AudioContext} audioCtx 
 * @param {ArrayBuffer} arrayBuffer 
 * @param {number} nextStartTime 
 * @returns {number} Waktu mulai audio berikutnya
 */
export function playPcmAudio(audioCtx, arrayBuffer, nextStartTime) {
    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }
    
    const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 16000);
    audioBuffer.getChannelData(0).set(float32Array);

    const currentTime = audioCtx.currentTime;
    let startTime = nextStartTime;
    if (startTime < currentTime) {
        startTime = currentTime;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(startTime);
    
    return startTime + audioBuffer.duration;
}

/**
 * SECURITY (M02 L10): escape user-controlled strings before they hit innerHTML.
 * Fleet data comes from N8N webhook which is unauthenticated — a malicious deviceId
 * or serialNumber could inject <script>/<img onerror>. Apply to all dynamic values
 * interpolated into HTML strings.
 * @param {*} val
 * @returns {string}
 */
export function escapeHtml(val) {
    if (val == null) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape for safe inclusion inside a single-quoted JS string literal in an
 * inline HTML event handler (onclick="... 'value' ...").
 * @param {*} val
 * @returns {string}
 */
export function escapeJsString(val) {
    if (val == null) return '';
    return String(val)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/</g, '\\x3c')
        .replace(/>/g, '\\x3e');
}
