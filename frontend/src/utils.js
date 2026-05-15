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
