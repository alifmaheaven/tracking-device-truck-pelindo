(function(){const a=document.createElement("link").relList;if(a&&a.supports&&a.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))o(t);new MutationObserver(t=>{for(const s of t)if(s.type==="childList")for(const n of s.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&o(n)}).observe(document,{childList:!0,subtree:!0});function i(t){const s={};return t.integrity&&(s.integrity=t.integrity),t.referrerPolicy&&(s.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?s.credentials="include":t.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function o(t){if(t.ep)return;t.ep=!0;const s=i(t);fetch(t.href,s)}})();const k="https://n8n.freeat.me/webhook/device-cordinate";let c=[];const d={},l=L.map("map").setView([-7.195,112.68],15);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(l);const I=L.divIcon({html:`<div style="background-color: #2563eb; color: white; width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 12px rgba(37,99,235,0.4); border: 2px solid white;">
            <i class="fa-solid fa-truck"></i>
           </div>`,className:"custom-div-icon",iconSize:[36,36],iconAnchor:[18,18],popupAnchor:[0,-18]}),E=L.divIcon({html:`<div style="background-color: #f59e0b; color: white; width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 12px rgba(245,158,11,0.4); border: 2px solid white;">
            <i class="fa-solid fa-truck"></i>
           </div>`,className:"custom-div-icon",iconSize:[36,36],iconAnchor:[18,18],popupAnchor:[0,-18]});async function b(){try{r.innerHTML='<p style="text-align:center; margin-top: 20px;">Mengambil data API...</p>',c=(await(await fetch(k)).json()).map(t=>{const s=t.lastConnectionDate?new Date(t.lastConnectionDate.time):new Date,x=Math.floor((new Date-s)/(1e3*60))<120?"active":"idle";return{id:t.deviceId,truckNumber:t.serialNumber,coordinates:[parseFloat(t.latitude),parseFloat(t.longitude)],status:x,speed:"- km/h",lastUpdate:s.toLocaleString("id-ID",{timeZone:"Asia/Jakarta",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" WIB",tags:t.deviceTags||[]}}),B();const i=v.value.toLowerCase(),o=c.filter(t=>{const s=t.tags&&t.tags.some(n=>(n.tagValue||n).toString().toLowerCase().includes(i));return t.truckNumber.toLowerCase().includes(i)||t.id.toLowerCase().includes(i)||s});w(o)}catch(e){console.error("Gagal mengambil data dari API:",e),r.innerHTML='<p style="text-align:center; color: var(--idle-orange); margin-top: 20px;"><i class="fa-solid fa-triangle-exclamation"></i> Gagal mengambil data. Pastikan Webhook N8N menyala.</p>'}}function B(){Object.values(d).forEach(e=>{l.removeLayer(e)}),c.forEach(e=>{if(isNaN(e.coordinates[0])||isNaN(e.coordinates[1]))return;const a=e.status==="active"?I:E,i=L.marker(e.coordinates,{icon:a}).addTo(l),o=`
            <div class="custom-popup-content">
                <h3><i class="fa-solid fa-truck"></i> ${e.truckNumber}</h3>
                <p><strong>Device ID:</strong> ${e.id.substring(0,8)}...</p>
                <p><strong>Koordinat:</strong> ${e.coordinates[0]}, ${e.coordinates[1]}</p>
                <p><strong>Status:</strong> <span style="text-transform: capitalize;">${e.status}</span></p>
                <p><strong>Update:</strong> ${e.lastUpdate}</p>
                <button class="history-btn" onclick="openHistoryModal('${e.id}', '${e.truckNumber}')">
                    <i class="fa-solid fa-route"></i> Riwayat Perjalanan
                </button>
                <a href="https://www.google.com/maps/search/?api=1&query=${e.coordinates[0]},${e.coordinates[1]}" target="_blank" class="gmaps-link">
                    <i class="fa-solid fa-location-arrow"></i> Buka di Google Maps
                </a>
            </div>
        `;i.bindPopup(o),d[e.id]=i})}const r=document.getElementById("deviceList"),v=document.getElementById("searchInput");function w(e){if(r.innerHTML="",e.length===0){r.innerHTML='<p style="text-align:center; color: var(--text-muted); margin-top: 20px;">Tidak ada device/truk ditemukan.</p>';return}e.forEach(a=>{const i=document.createElement("div");i.className="device-card",i.id=`card-${a.id}`,i.onclick=()=>D(a.id);const o=a.status==="active"?"status-active":"status-idle";let t="";a.tags&&a.tags.length>0&&(t=`<div class="device-tags">${a.tags.map(n=>`<span class="tag-badge"><i class="fa-solid fa-tag"></i> ${n.tagValue||n}</span>`).join("")}</div>`),i.innerHTML=`
            <div class="card-header">
                <div class="truck-id">
                    <i class="fa-solid fa-microchip"></i> ${a.truckNumber}
                </div>
                <div class="status-badge ${o}">${a.status}</div>
            </div>
            ${t}
            <div class="device-details">
                <div class="detail-row">
                    <i class="fa-solid fa-barcode"></i>
                    <span>Device: ${a.id.substring(0,10)}...</span>
                </div>
                <div class="detail-row">
                    <i class="fa-solid fa-location-dot"></i>
                    <span>${a.coordinates[0].toFixed(5)}, ${a.coordinates[1].toFixed(5)}</span>
                </div>
                <!-- 
                <div class="detail-row">
                    <i class="fa-solid fa-gauge-high"></i>
                    <span>Speed: ${a.speed}</span>
                </div>
                -->
            </div>
        `,r.appendChild(i)})}function D(e){const a=c.find(t=>t.id===e);if(!a)return;document.querySelectorAll(".device-card").forEach(t=>t.classList.remove("active-card"));const o=document.getElementById(`card-${e}`);o&&o.classList.add("active-card"),l.flyTo(a.coordinates,16,{duration:1.5}),setTimeout(()=>{d[e]&&d[e].openPopup()},1500)}v.addEventListener("input",e=>{const a=e.target.value.toLowerCase(),i=c.filter(o=>{const t=o.tags&&o.tags.some(s=>(s.tagValue||s).toString().toLowerCase().includes(a));return o.truckNumber&&o.truckNumber.toLowerCase().includes(a)||o.id&&o.id.toLowerCase().includes(a)||t});w(i)});b();setInterval(b,6e4);const N=document.getElementById("sidebar"),g=document.getElementById("toggleSidebarBtn");g.addEventListener("click",()=>{N.classList.toggle("collapsed"),g.classList.toggle("collapsed"),setTimeout(()=>{l.invalidateSize()},400)});const $=document.getElementById("historyModal"),M=document.getElementById("closeHistoryModalBtn"),m=document.getElementById("loadingHistory");L.divIcon({html:'<div style="background-color: #10b981; color: white; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid white;"><i class="fa-solid fa-play" style="margin-left: 2px;"></i></div>',className:"custom-div-icon",iconSize:[30,30],iconAnchor:[15,15]});L.divIcon({html:'<div style="background-color: #ef4444; color: white; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; border-radius: 50%; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid white;"><i class="fa-solid fa-flag-checkered"></i></div>',className:"custom-div-icon",iconSize:[30,30],iconAnchor:[15,15]});const C=document.getElementById("distanceInfo");document.getElementById("totalDistance");const u=document.getElementById("historyTimePreset"),p=document.getElementById("customDateRange"),f=document.getElementById("histStartDate"),h=document.getElementById("histEndDate"),y=document.getElementById("applyHistoryFilterBtn");u&&u.addEventListener("change",e=>{e.target.value==="custom"?p.style.display="flex":p.style.display="none"});y&&y.addEventListener("click",()=>{});M.addEventListener("click",()=>{$.classList.remove("active"),C.style.display="none",u&&(u.value="1day"),p&&(p.style.display="none"),f&&(f.value=""),h&&(h.value=""),setTimeout(()=>{m.innerHTML="Sedang memuat data rute perjalanan...",m.style.display="none"},500)});
