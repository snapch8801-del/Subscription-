'use strict';

window.openSideMenu = () => { $("sideMenu").classList.add("open"); $("menuBackdrop").classList.add("open"); };
window.closeSideMenu = () => { $("sideMenu").classList.remove("open"); $("menuBackdrop").classList.remove("open"); };

window.addEventListener('DOMContentLoaded', () => {
    data = loadLocalBackup();
    window.render();
    setTimeout(() => {
        if(data.length === 0 && !currentUser) {
            $("syncVal").textContent = "أوفلاين 📴";
        }
    }, 3000);
});

window.addEventListener('online', async () => {
    showToast("تم استعادة الاتصال! جاري المزامنة مع السحابة ☁️...", "ok");
    if(currentUser) {
        await firebasePush();
        await firebasePushPackages();
    }
});

window.addEventListener('offline', () => {
    showToast("انقطع الاتصال، سيتم حفظ عملك محلياً 📴", "warn");
    $("syncVal").textContent = "أوفلاين 📴";
    const chip = $("syncChip");
    if(chip) {
      chip.style.borderColor = "var(--warn)";
      chip.style.background = "rgba(245,158,11,0.1)";
    }
});

(function initPWA() {
  try {
    const pwaManifest = { name: "لوحة تسيير الاشتراكات", short_name: "الاشتراكات", start_url: window.location.pathname || "/", display: "standalone", background_color: "#070a12", theme_color: "#070a12", icons: [ { src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%237c5cff'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-size='60'>🧾</text></svg>", sizes: "192x192", type: "image/svg+xml" }, { src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%237c5cff'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-size='60'>🧾</text></svg>", sizes: "512x512", type: "image/svg+xml" } ] };
    const manifestBlob = new Blob([JSON.stringify(pwaManifest)], {type: 'application/json'}); document.getElementById('manifest-link')?.setAttribute('href', URL.createObjectURL(manifestBlob));
    const swCode = `self.addEventListener('install', (e) => self.skipWaiting()); self.addEventListener('activate', (e) => self.clients.claim());`;
    const swBlob = new Blob([swCode], {type: 'text/javascript'});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(URL.createObjectURL(swBlob)).catch(()=>{});
  } catch (e) {}
})();

const FIREBASE_CONFIG = { apiKey: "AIzaSyAQPzqeazhj4rjyY1dbcGZ9YEAv8ZhLQbQ", authDomain: "dattta-6f497.firebaseapp.com", databaseURL: "https://dattta-6f497-default-rtdb.firebaseio.com", projectId: "dattta-6f497", storageBucket: "dattta-6f497.firebasestorage.app", messagingSenderId: "804914291938", appId: "1:804914291938:web:7a7d3fe8a5ebb28a306abb" };
const BASE_APP_TITLE = "لوحة تسيير الاشتراكات - الإدارة"; 
const $ = (id)=>document.getElementById(id); 
const LOCAL_BACKUP_KEY = "subs_local_backup_v12";
const LOCAL_PACKAGES_KEY = "subs_packages_backup_v12";

let data = []; let packagesData = []; let editingId = null; let currentRowId = null; let currentFilter = "all"; 
let selectedIds = new Set(); let extendMode = "single"; let currentUser = null; let currentRole = null;
let lastDeletedData = null; let storeSettings = { name: "المؤسسة", logo: "" }; let editingPkgId = null;
window.currentPage = 1; window.itemsPerPage = 50; let bulkWaQueue = [];

try {
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    var auth = firebase.auth(); 
    var db = firebase.database();
} catch(e) {}

window.openModal = (id) => { const el = $(id); if(el) el.setAttribute("aria-hidden","false"); };
window.closeModal = (id) => { const el = $(id); if(el) el.setAttribute("aria-hidden","true"); if(id === 'receiptModal' || id === 'idCardModal') document.title = BASE_APP_TITLE; };
window.showToast = (m, type="ok") => { const t=$("toast"); t.textContent=m; t.style.borderColor = type==="err"?"#ef4444":"#22c55e"; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"), 3000); };
function todayISO(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }

function toDate(iso){ 
    if(!iso) return new Date();
    const d = new Date(iso+"T00:00:00"); d.setHours(0,0,0,0); 
    return isNaN(d) ? new Date() : d;
}

function saveLocalBackup(){ 
  localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(data)); 
  localStorage.setItem(LOCAL_PACKAGES_KEY, JSON.stringify(packagesData));
}

function loadLocalBackup(){ 
  try { const j = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY)); data = Array.isArray(j) ? j : []; } catch { data = []; } 
  try { const p = JSON.parse(localStorage.getItem(LOCAL_PACKAGES_KEY)); packagesData = Array.isArray(p) ? p : []; } catch { packagesData = []; }
  window.renderPackages();
  return data;
}

function setSyncState(state){ const chip = $("syncChip"); const val = $("syncVal"); chip.className = "statChip sync " + state; if(!navigator.onLine) val.textContent = "أوفلاين 📴"; else if(state==="saving") val.textContent = "جاري الحفظ..."; else if(state==="ok") { const d = new Date(); val.textContent = d.getHours()+":"+String(d.getMinutes()).padStart(2,"0") + " ✅"; } else if(state==="fail") { val.textContent = "خطأ ❌"; chip.style.borderColor="var(--err)"; chip.style.background="rgba(239,68,68,0.1)"; } }

async function logAction(actionName, detailsStr) { if (!currentUser || typeof db === 'undefined') return; try { await db.ref("logs").push({ email: currentUser.email, action: actionName, details: detailsStr || "-", time: new Date().toISOString() }); } catch(e) {} }

let html5QrcodeScanner;
window.openScannerModal = () => { openModal('scannerModal'); if (typeof Html5QrcodeScanner !== "undefined") { if (!html5QrcodeScanner) { html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false); } html5QrcodeScanner.render(onScanSuccess, onScanFailure); } else { $("qr-reader-results").textContent = "لم يتم تحميل مكتبة الكاميرا، قد يكون متصفحك يمنعها."; } };
window.closeScannerModal = () => { closeModal('scannerModal'); if (html5QrcodeScanner) { html5QrcodeScanner.clear().catch(e => {}); } };
function onScanSuccess(decodedText, decodedResult) { if(decodedText.startsWith("ID:")) { window.closeScannerModal(); const scId = decodedText.split("ID:")[1]; window.processScannedId(scId); } else { $("qr-reader-results").textContent = "رمز غير صالح! يرجى مسح بطاقة انخراط نظامية."; } }
function onScanFailure(error) {}

window.processScannedId = (id) => {
  const rec = data.find(x => x.id === id);
  if(!rec) return showToast("هذا المشترك غير مسجل في النظام!", "err");
  currentRowId = rec.id;
  const alertD = parseInt($("alertDays")?.value) || 7;
  const st = getStatus(rec, alertD);
  $("chkInName").textContent = rec.name; $("chkInService").textContent = rec.serviceType; $("chkInStatus").textContent = st.label; $("chkInStatus").className = "badge " + st.cls;
  const btnAct = $("btnChkInAction");
  if(st.key === 'expired') { $("chkInAlert").innerHTML = "❌ الاشتراك منتهي! لا يمكن الدخول."; $("chkInAlert").style.color = "#ef4444"; btnAct.style.display = "none"; } 
  else { $("chkInAlert").innerHTML = "✅ الاشتراك صالح، يمكن الدخول."; $("chkInAlert").style.color = "#10b981"; btnAct.style.display = "block"; btnAct.style.background = "#10b981"; btnAct.style.borderColor = "#059669"; if(rec.subType === 'sessions') { btnAct.textContent = `✔️ خصم حصة وتسجيل الدخول (باقي: ${rec.sessionsLeft})`; } else { btnAct.textContent = `✔️ تسجيل الدخول (زمني)`; } btnAct.onclick = () => { window.markAttendance(rec.id); closeModal('checkInModal'); }; }
  openModal('checkInModal');
};

let selectedLogIds = new Set();
window.updateLogBulkUI = () => { if(selectedLogIds.size > 0) { $("deleteSelectedLogsBtn").style.display = "block"; $("deleteSelectedLogsBtn").textContent = `🗑️ حذف (${selectedLogIds.size})`; } else { $("deleteSelectedLogsBtn").style.display = "none"; $("selectAllLogs").checked = false; } };
window.toggleAllLogs = (e) => { const isChkd = e.target.checked; document.querySelectorAll(".logChk").forEach(chk => { chk.checked = isChkd; if(isChkd) selectedLogIds.add(chk.value); else selectedLogIds.delete(chk.value); }); window.updateLogBulkUI(); };
$("auditTbody").addEventListener("change", (e) => { if(e.target.classList.contains("logChk")) { if(e.target.checked) selectedLogIds.add(e.target.value); else selectedLogIds.delete(e.target.value); window.updateLogBulkUI(); } });
window.deleteSelectedLogs = async () => { if(!confirm(`تأكيد حذف ${selectedLogIds.size} من السجلات نهائياً؟`)) return; setSyncState("saving"); for(let id of selectedLogIds) { await db.ref("logs/" + id).remove(); } selectedLogIds.clear(); window.updateLogBulkUI(); setSyncState("ok"); showToast("تم الحذف"); window.openAuditLog(); };
window.openAuditLog = async () => { selectedLogIds.clear(); window.updateLogBulkUI(); const tb = $("auditTbody"); tb.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:20px;'>جاري تحميل السجل... ⏳</td></tr>"; openModal("auditLogModal"); try { const snap = await db.ref("logs").orderByChild("time").limitToLast(100).once("value"); const logsObj = snap.val() || {}; tb.innerHTML = ""; const logsArray = Object.entries(logsObj).map(([key, val]) => ({id: key, ...val})).sort((a,b) => new Date(b.time) - new Date(a.time)); if(logsArray.length === 0) { tb.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:20px; color:var(--muted);'>لا توجد نشاطات</td></tr>"; return; } logsArray.forEach(l => { const d = new Date(l.time); const timeStr = d.toLocaleDateString('en-GB') + " - " + d.toLocaleTimeString('en-GB'); let actionColor = "var(--text)"; if(l.action.includes("حذف")) actionColor = "#ef4444"; else if(l.action.includes("إضافة")) actionColor = "#22c55e"; else if(l.action.includes("تعديل") || l.action.includes("تجديد") || l.action.includes("تسديد")) actionColor = "#f59e0b"; const isChecked = selectedLogIds.has(l.id) ? "checked" : ""; tb.innerHTML += `<tr><td style="text-align: center;"><input type="checkbox" class="logChk" value="${l.id}" ${isChecked}></td><td style="direction:ltr; text-align:right; color:var(--muted);">${timeStr}</td><td>${l.email}</td><td style="color:${actionColor}; font-weight:bold;">${l.action}</td><td>${l.details}</td></tr>`; }); } catch(err) {} };

let adminListenerRef = null;

if(typeof auth !== 'undefined') {
    auth.onAuthStateChanged(async (u)=>{ 
        currentUser = u; 
        if(adminListenerRef) { adminListenerRef.off(); adminListenerRef = null; }
        if(u){ 
            adminListenerRef = db.ref("admins/" + u.uid);
            adminListenerRef.on('value', async (roleSnap) => {
                if (!roleSnap.exists()) { showToast("تم سحب صلاحياتك، سيتم تسجيل خروجك.", "err"); setTimeout(() => auth.signOut(), 2500); return; }
                let roleData = roleSnap.val(); 
                if(roleData === true) { try { roleData = { role: "owner", email: u.email }; await db.ref("admins/" + u.uid).set(roleData); } catch(writeErr) { roleData = { role: "owner", email: u.email }; } } 
                currentRole = (roleData && roleData.role) ? roleData.role : "admin"; 
                $("closeAuthBtn").style.display = "block"; closeModal("authModal"); await window.loadData(); window.updateAuthUI();
            });
        } else { currentRole = null; data = []; packagesData = []; window.render(); $("closeAuthBtn").style.display = "none"; openModal("authModal"); window.updateAuthUI(); } 
    });
}

window.updateAuthUI = () => { if(currentUser) { $("authLoginSection").style.display = "none"; $("authLoggedInSection").style.display = "block"; const iconEl = $("authStatusIcon"); const textEl = $("authStateText"); if (currentRole === "owner") { iconEl.innerHTML = "👑"; iconEl.style.background = "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05))"; iconEl.style.borderColor = "rgba(245,158,11,0.4)"; textEl.innerHTML = `<span style="color:var(--warn); font-size:22px; font-weight:900;">المالك</span><br/><span style="color:var(--text); font-size:15px; margin-top:8px; display:inline-block; direction:ltr;">${currentUser.email}</span>`; } else { iconEl.innerHTML = "👤"; iconEl.style.background = "linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.05))"; iconEl.style.borderColor = "rgba(34,197,94,0.3)"; textEl.innerHTML = `<span style="color:var(--text); font-size:20px; font-weight:900;">أدمن</span><br/><span style="color:var(--text); font-size:15px; margin-top:8px; display:inline-block; direction:ltr;">${currentUser.email}</span>`; } $("ownerDashboard").style.display = currentRole === "owner" ? "block" : "none"; } else { $("authLoginSection").style.display = "block"; $("authLoggedInSection").style.display = "none"; } };

window.handleLogoUpload = (e) => { 
  const file = e.target.files[0]; 
  if(file){ 
    const reader = new FileReader(); 
    reader.onload = (ev) => { 
      const img = new Image();
      img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 300; 
          const scaleSize = MAX_WIDTH / img.width;
          canvas.width = MAX_WIDTH;
          canvas.height = img.height * scaleSize;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.7); 
          $("logoPreview").src = compressedDataUrl; 
          $("logoPreview").style.display = "block"; 
          $("logoEmojiFallback").style.display = "none"; 
      };
      img.src = ev.target.result;
    }; 
    reader.readAsDataURL(file); 
  } 
};

window.saveStoreSettings = async () => { const name = $("setStoreName").value.trim() || "المؤسسة"; const logo = $("logoPreview").src || ""; storeSettings = { name, logo }; try { setSyncState("saving"); await db.ref("settings/storeInfo").set(storeSettings); setSyncState("ok"); closeModal("storeSettingsModal"); showToast("تم حفظ الإعدادات ✨"); } catch(e) { showToast("ليس لديك صلاحية", "err"); } };
window.confirmAddAdmin = async () => { const email = $("newAdminEmail").value.trim(); const pass = $("newAdminPass").value; const role = $("newAdminRole").value; if(!email || pass.length < 6) return showToast("بيانات غير صالحة", "err"); try { setSyncState("saving"); const secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, "SecondaryApp"); const userCredential = await secondaryApp.auth().createUserWithEmailAndPassword(email, pass); await db.ref("admins/" + userCredential.user.uid).set({ role: role, email: email }); await secondaryApp.auth().signOut(); await secondaryApp.delete(); closeModal("addAdminModal"); $("newAdminEmail").value = ""; $("newAdminPass").value = ""; showToast(`✅ تم الإنشاء!`); setSyncState("ok"); } catch (error) { setSyncState("fail"); } };
window.loadAdminsList = async () => { openModal("manageAdminsModal"); const tb = $("adminsTbody"); tb.innerHTML = "<tr><td colspan='3' style='text-align:center; padding:20px;'>جاري التحميل...</td></tr>"; try { const snap = await db.ref("admins").once("value"); const adminsObj = snap.val() || {}; tb.innerHTML = ""; for(let uid in adminsObj) { let uData = adminsObj[uid]; let isOwner = uData.role === "owner" || uData === true; let actionBtn = uid === currentUser.uid ? `<span style="color:var(--muted); font-size:12px;">حسابك</span>` : `<button class="btn danger" style="padding:6px 10px; font-size:12px; border-radius:10px;" onclick="window.revokeAdmin('${uid}')">سحب</button>`; tb.innerHTML += `<tr><td>${uData.email || "غير محدد"}</td><td>${isOwner?"مالك 👑":"أدمن 👤"}</td><td>${actionBtn}</td></tr>`; } } catch(err) {} };

window.revokeAdmin = async (uid) => { 
  if(confirm("تأكيد السحب؟ سيتم طرد الحساب من النظام فوراً.")) { 
    await db.ref("admins/" + uid).remove(); 
    showToast("تم سحب الصلاحية بنجاح ✅"); 
    window.loadAdminsList(); 
  } 
};

window.loadDataOffline = () => { data = loadLocalBackup(); window.render(); window.renderPackages(); };
window.loadData = async () => { 
  if(!navigator.onLine) { window.loadDataOffline(); return; } 
  try { 
    setSyncState("saving"); 
    try { const settingsSnap = await db.ref("settings/storeInfo").once('value'); if(settingsSnap.exists()) { storeSettings = settingsSnap.val(); $("setStoreName").value = storeSettings.name || ""; if(storeSettings.logo) { $("logoPreview").src = storeSettings.logo; $("logoPreview").style.display = "block"; $("logoEmojiFallback").style.display = "none"; } } } catch(errSettings) {} 
    try { const pkgSnap = await db.ref("packages").once('value'); packagesData = pkgSnap.exists() ? Object.values(pkgSnap.val()) : []; window.renderPackages(); } catch(errPkg) {}
    const snap = await db.ref("subscriptions").once('value'); data = snap.exists() ? Object.values(snap.val()) : []; saveLocalBackup(); setSyncState("ok"); window.render(); 
  } catch(e) { setSyncState("fail"); window.loadDataOffline(); } 
};

async function firebasePush() { 
  saveLocalBackup();
  if(!navigator.onLine) { $("syncVal").textContent = "محفوظ محلياً 📴"; return; }
  try { setSyncState("saving"); await db.ref("subscriptions").set(data); setSyncState("ok"); } catch(e) { showToast("خطأ في المزامنة", "err"); setSyncState("fail"); } 
}

function getStatus(r, alertDays) {
  if (r.subType === 'sessions') {
    let left = parseInt(r.sessionsLeft) || 0;
    if (left <= 0) return { key: "expired", label: "منتهي الرصيد", cls: "err", text: "0 حصة" };
    if (left <= 2) return { key: "expiring", label: "قارب على الانتهاء", cls: "warn", text: `بقي ${left} حصص` };
    return { key: "active", label: "رصيد فعّال", cls: "ok", text: `بقي ${left} حصص` };
  } else {
    if (!r.end) return { key:"expired", label:"غير محدد", cls:"err", text:`-` };
    const left = Math.round((toDate(r.end) - toDate(todayISO()))/(1000*60*60*24));
    if (isNaN(left)) return { key:"expired", label:"خطأ تاريخ", cls:"err", text:`-` };
    if(left < 0) return { key:"expired", label:"منتهي", cls:"err", text:`منذ ${Math.abs(left)} يوم` };
    if(left <= alertDays) return { key:"expiring", label:"قريب ينتهي", cls:"warn", text:`بقي ${left} يوم` };
    return { key:"active", label:"فعّال", cls:"ok", text:`بقي ${left} يوم` };
  }
}

window.toggleSubType = () => {
  const val = $("subType").value;
  if(val === 'sessions') { $("timeFieldsGrp").style.display = "none"; $("sessionsFieldsGrp").style.display = "contents"; } 
  else { $("timeFieldsGrp").style.display = "contents"; $("sessionsFieldsGrp").style.display = "none"; }
};

window.changePage = (step) => { window.currentPage += step; window.render(); };

window.render = () => {
  try {
      const searchInput = $("search"); const q = searchInput ? (searchInput.value || "").trim().toLowerCase() : "";
      const tb = $("tbody"); if(!tb) return; tb.innerHTML = ""; if($("selectAll")) $("selectAll").checked = false;
      const alertEl = $("alertDays"); const alertD = (alertEl && alertEl.value) ? parseInt(alertEl.value) : 7;
      
      let filteredRows = data.filter(r => { 
        if(!r) return false;
        const n = (r.name || "").toString().toLowerCase(); const p = (r.phone || "").toString().toLowerCase();
        const e = (r.email || "").toString().toLowerCase(); const srv = (r.serviceType || "").toString().toLowerCase(); 
        const tagsSearch = (r.tags || "").toString().toLowerCase();
        const match = !q || n.includes(q) || p.includes(q) || e.includes(q) || srv.includes(q) || tagsSearch.includes(q); 
        const st = getStatus(r, alertD); 
        
        // منطق فلتر الديون الذكي
        if (currentFilter === 'debt') {
            let pStatus = r.paymentStatus || 'paid';
            if (pStatus === 'paid') return false; 
        } else if (currentFilter !== "all" && currentFilter !== st.key) {
            return false;
        }
        
        return match; 
      });
      
      const totalPages = Math.ceil(filteredRows.length / window.itemsPerPage) || 1;
      if (window.currentPage > totalPages) window.currentPage = totalPages;
      if (window.currentPage < 1) window.currentPage = 1;
      
      const startIdx = (window.currentPage - 1) * window.itemsPerPage;
      const paginatedRows = filteredRows.slice(startIdx, startIdx + window.itemsPerPage);

      if(filteredRows.length === 0) { 
        tb.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--muted); font-size:15px;">لا توجد بيانات 📭</td></tr>`; 
        $("paginationControls").innerHTML = ""; 
        return; 
      }

      paginatedRows.forEach(r => {
        try {
            const st = getStatus(r, alertD); const isChecked = selectedIds.has(r.id) ? "checked" : ""; const tr = document.createElement("tr");
            if(st.key === "expired") tr.className = "expired-row"; else if(st.key === "expiring") tr.className = "expiring-row";
            
            let pStatus = r.paymentStatus || 'paid'; let payBadge = '';
            if(pStatus === 'unpaid') payBadge = '<span class="badge err" style="padding:4px 6px; font-size:10px;">🔴 غير مدفوع</span>';
            else if(pStatus === 'partial') { let rem = (parseFloat(r.price)||0) - (parseFloat(r.paidAmount)||0); payBadge = `<span class="badge warn" style="padding:4px 6px; font-size:10px;" title="المتبقي: ${rem}">🟡 جزئي (${r.paidAmount||0})</span>`; }
            else payBadge = '<span class="badge ok" style="padding:4px 6px; font-size:10px;">🟢 خالص</span>';
            
            const hasNotes = r.notes && r.notes.trim() !== "";
            const notesIcon = hasNotes ? `<span title="ملاحظات سرية" style="font-size:12px; margin-inline-start:6px; cursor:help;">📝</span>` : "";
            
            let tagsHtml = "";
            if(r.tags && r.tags.trim() !== "") {
              const tagsArray = r.tags.split(',').map(t => t.trim()).filter(t => t !== "");
              tagsArray.forEach(t => { tagsHtml += `<span class="tag-pill">${t}</span>`; });
            }

            const serviceHtml = `<span class="service-badge">${r.serviceType || "غير محدد"}</span>`;
            
            let dateOrSessionHtml = "";
            if(r.subType === 'sessions') {
              dateOrSessionHtml = `<div style="font-weight:bold; font-size:13px; color:var(--text);">${r.sessionsLeft||0} / ${r.sessionsTotal||0} حصة</div>
              <button class="btn soft" style="padding:4px 8px; font-size:10px; margin-top:4px; border-color:#22c55e; color:#22c55e;" onclick="window.markAttendance('${r.id}')">✔️ حضور</button>`;
            } else {
              dateOrSessionHtml = `<span style="color:var(--text)">م:</span> ${r.start||"-"}<br><span style="color:var(--text)">إ:</span> ${r.end||"-"}
              <div style="margin-top:4px;"><button class="btn soft" style="padding:4px 8px; font-size:10px; border-color:#22c55e; color:#22c55e;" onclick="window.markAttendance('${r.id}')">✔️ تسجيل دخول</button></div>`;
            }

            tr.innerHTML = `
              <td style="text-align: center;"><input type="checkbox" class="rowChk" value="${r.id}" ${isChecked}></td>
              <td>
                 <div style="font-weight:bold; color:var(--text); font-size:14px;">${r.name ? r.name : "بدون اسم"}${notesIcon}</div>
                 ${r.email ? `<div style="font-size:11px; color:var(--muted); margin-bottom:4px; direction: ltr; text-align: right;">${r.email}</div>` : ''}
                 <div>${tagsHtml}</div>
              </td>
              <td dir="ltr" style="text-align:right; font-size:14px;">${r.phone?`${r.countryCode||''} ${r.phone}`:'-'}</td>
              <td><div style="margin-bottom:4px;">${serviceHtml}</div><div style="font-size:11px; color:var(--muted); font-weight:bold;">${r.subType === 'sessions' ? 'نظام حصص' : `المدة: ${r.months||0} شهر`}</div></td>
              <td><div style="font-weight:bold; font-size:14px;">${r.price||0} <span style="font-size:10px; color:var(--muted);">${r.currency||'DZD'}</span></div><div style="margin-top:4px;">${payBadge}</div></td>
              <td style="font-size:12px; color:var(--muted); line-height:1.6;">${dateOrSessionHtml}</td>
              <td><div style="margin-bottom:4px;"><span class="badge ${st.cls}">${st.label}</span></div><div style="font-size:11px; font-weight:bold; color:${st.key === 'expired' ? 'var(--err)' : 'var(--text)'};">${st.text}</div></td>
              <td><button class="actionPill" onclick="window.openRowActions('${r.id}')">⚡ إجراء</button></td>
            `;
            tb.appendChild(tr);
        } catch(rowErr) { console.error(rowErr); }
      });

      $("paginationControls").innerHTML = `
        <button class="page-btn" onclick="window.changePage(1)" ${window.currentPage === totalPages ? 'disabled' : ''}>التالي ◀</button>
        <span class="page-info">صفحة ${window.currentPage} من ${totalPages} <span style="margin: 0 8px; color:var(--line);">|</span> الإجمالي: ${filteredRows.length} مشترك</span>
        <button class="page-btn" onclick="window.changePage(-1)" ${window.currentPage === 1 ? 'disabled' : ''}>▶ السابق</button>
      `;
  } catch(e) { console.error(e); }
};

window.markAttendance = async (id) => {
  let rec = data.find(x => x.id === id);
  if(rec) {
    if (rec.subType === 'sessions' && rec.sessionsLeft <= 0) return showToast("الرصيد منتهي، لا يمكن الخصم!", "err");
    if (rec.subType === 'time') {
      const alertD = parseInt($("alertDays")?.value) || 7;
      const st = getStatus(rec, alertD);
      if(st.key === 'expired') return showToast("الاشتراك الزمني منتهي، لا يمكن الدخول!", "err");
    }
    if(rec.subType === 'sessions') rec.sessionsLeft--;
    if(!rec.attendanceLog) rec.attendanceLog = [];
    rec.attendanceLog.push({ time: new Date().toISOString() });
    let logDetails = rec.subType === 'sessions' ? `الرصيد المتبقي: ${rec.sessionsLeft}` : `اشتراك زمني`;
    logAction("تسجيل حضور ✔️", `العميل: ${rec.name}، ${logDetails}`);
    setSyncState("saving"); await firebasePush(); window.render(); showToast("تم تسجيل الدخول بنجاح ✔️");
  }
};

window.openAttendanceLog = () => {
  const rec = data.find(x => x.id === currentRowId); if(!rec) return; closeModal("rowActionsModal");
  $("attendanceClientName").textContent = `👤 ${rec.name}`; const tb = $("attendanceTbody"); tb.innerHTML = "";
  if(!rec.attendanceLog || rec.attendanceLog.length === 0) { tb.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--muted);">لا يوجد سجل حضور لهذا المشترك بعد.</td></tr>`; } 
  else {
    const sortedLogs = [...rec.attendanceLog].reverse();
    sortedLogs.forEach((log, index) => {
      const d = new Date(log.time); const dateStr = d.toLocaleDateString('en-GB'); const timeStr = d.toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'}); 
      tb.innerHTML += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 10px; color: var(--muted);">${sortedLogs.length - index}</td><td style="padding: 10px; text-align: right; font-weight: bold; color: var(--text);">${dateStr}</td><td style="padding: 10px; text-align: left; color: var(--accent); direction: ltr; font-weight: bold;">${timeStr}</td></tr>`;
    });
  } openModal("attendanceModal");
};

window.openPaymentModal = () => {
  const rec = data.find(x => x.id === currentRowId); if(!rec) return; closeModal("rowActionsModal");
  $("paymentClientName").textContent = `👤 ${rec.name} (${rec.serviceType})`;
  
  let total = parseFloat(rec.price) || 0; let paid = parseFloat(rec.paidAmount) || 0; let debt = total - paid;
  
  $("payTotal").textContent = total.toLocaleString(); $("payPaid").textContent = paid.toLocaleString(); $("payDebt").textContent = debt > 0 ? debt.toLocaleString() : "0";
  
  if(debt <= 0) { $("newPaymentWrap").style.display = "none"; } 
  else { $("newPaymentWrap").style.display = "block"; $("newPaymentAmount").value = debt; }
  
  const tb = $("paymentTbody"); tb.innerHTML = "";
  
  if(!rec.paymentLog || rec.paymentLog.length === 0) {
    if(paid > 0) { tb.innerHTML = `<tr><td style="padding: 10px; color: var(--muted);">دفعات سابقة (غير مفصلة)</td><td style="padding: 10px; text-align: left; color: #10b981; font-weight: bold; font-size:15px;">${paid.toLocaleString()} ${rec.currency||'DZD'}</td></tr>`; } 
    else { tb.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:15px; color:var(--muted);">لا يوجد سجل دفعات.</td></tr>`; }
  } else {
    const sortedLogs = [...rec.paymentLog].reverse();
    sortedLogs.forEach((log) => {
      const d = new Date(log.time); const dateStr = d.toLocaleDateString('en-GB') + " " + d.toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'}); 
      tb.innerHTML += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 10px; color: #eaf0ff; font-weight:bold;">${dateStr}</td><td style="padding: 10px; text-align: left; color: #10b981; font-weight: bold; font-size:15px;">${parseFloat(log.amount).toLocaleString()} ${rec.currency||'DZD'}</td></tr>`;
    });
  } openModal("paymentModal");
};

window.confirmNewPayment = async () => {
  const amount = parseFloat($("newPaymentAmount").value);
  if(isNaN(amount) || amount <= 0) return showToast("أدخل مبلغاً صحيحاً", "err");
  const rec = data.find(x => x.id === currentRowId); if(!rec) return;

  let currentPaid = parseFloat(rec.paidAmount) || 0; let total = parseFloat(rec.price) || 0;
  rec.paidAmount = currentPaid + amount;
  
  if(rec.paidAmount >= total) { rec.paidAmount = total; rec.paymentStatus = 'paid'; } else { rec.paymentStatus = 'partial'; }
  if(!rec.paymentLog) rec.paymentLog = [];
  if(rec.paymentLog.length === 0 && currentPaid > 0) { rec.paymentLog.push({ time: new Date(rec.createdAt || Date.now()).toISOString(), amount: currentPaid, note: "دفعة أولية سابقة" }); }
  
  rec.paymentLog.push({ time: new Date().toISOString(), amount: amount, note: "تسديد" });
  logAction("تسديد دفعة 💸", `العميل: ${rec.name}، مبلغ: ${amount}`);
  setSyncState("saving"); await firebasePush(); window.render();
  showToast(`تم تسديد ${amount} بنجاح ✅`); window.openPaymentModal(); 
};

window.updateBulkUI = () => { const bar = $("bulkBar"); if(selectedIds.size > 0) { bar.style.display = "flex"; $("selCount").textContent = `${selectedIds.size} محدد`; } else { bar.style.display = "none"; $("selectAll").checked = false; } };
$("tbody").addEventListener("change", (e) => { if(e.target.classList.contains("rowChk")) { if(e.target.checked) selectedIds.add(e.target.value); else selectedIds.delete(e.target.value); window.updateBulkUI(); } });
window.toggleSelectAll = (el) => { const isChkd = el.checked; document.querySelectorAll(".rowChk").forEach(chk => { chk.checked = isChkd; if(isChkd) selectedIds.add(chk.value); else selectedIds.delete(chk.value); }); window.updateBulkUI(); };
window.clearSelectionAction = () => { selectedIds.clear(); window.render(); window.updateBulkUI(); };
window.bulkDeleteAction = async () => { if(!confirm(`تأكيد حذف ${selectedIds.size} اشتراكات؟`)) return; logAction("حذف جماعي", `عدد ${selectedIds.size} اشتراكات`); lastDeletedData = data.filter(x => selectedIds.has(x.id)); data = data.filter(x => !selectedIds.has(x.id)); selectedIds.clear(); await firebasePush(); window.render(); window.updateBulkUI(); showToast("تم الحذف، التراجع ممكن من الأدوات 🗑️"); };

window.bulkExtendAction = () => { 
  extendMode = "bulk"; $("extendTitle").textContent = `تجديد ${selectedIds.size} مشترك`; 
  $("extendValue").value = 1; $("extendUnit").value = "months"; $("lblExtendValue").textContent = "المدة المضافة (أو الحصص المضافة)"; openModal("extendModal"); 
};
window.confirmExtend = async () => { 
  const val = parseInt($("extendValue").value); const unit = $("extendUnit").value; 
  if(isNaN(val) || val < 1) return showToast("غير صالح", "err"); 
  if(extendMode === "bulk") { logAction("تجديد جماعي", `عدد ${selectedIds.size} بمقدار ${val} ${unit}`); } 
  else { const recToExtend = data.find(x => x.id === currentRowId); logAction("تجديد اشتراك", `الاسم: ${recToExtend.name}، إضافة: ${val} ${unit}`); } 
  const processRecord = (rec) => { 
    if(rec.subType === 'sessions') { rec.sessionsLeft = (parseInt(rec.sessionsLeft)||0) + val; rec.sessionsTotal = (parseInt(rec.sessionsTotal)||0) + val; } 
    else { const endD = new Date(rec.end); if(unit === "months") { endD.setMonth(endD.getMonth() + val); rec.months = (parseInt(rec.months)||0) + val; } else { endD.setDate(endD.getDate() + val); } rec.end = endD.toISOString().split('T')[0]; } return rec; 
  }; 
  if(extendMode === "bulk") { data = data.map(x => selectedIds.has(x.id) ? processRecord(x) : x); selectedIds.clear(); window.updateBulkUI(); } 
  else { data = data.map(x => x.id === currentRowId ? processRecord(x) : x); } await firebasePush(); window.render(); closeModal("extendModal"); showToast("تم التجديد 🔁"); 
};

window.openBulkWhatsAppModal = () => {
  bulkWaQueue = data.filter(x => selectedIds.has(x.id) && x.phone && x.phone.trim() !== "");
  if(bulkWaQueue.length === 0) return showToast("لم يتم تحديد أي عميل يملك رقم هاتف!", "err");
  $("bulkWaCount").textContent = bulkWaQueue.length; window.updateBulkWaUI(); openModal("bulkWhatsAppModal");
};
window.updateBulkWaUI = () => {
  if(bulkWaQueue.length === 0) { $("bulkWaCurrentTarget").textContent = "تم الإرسال للجميع ✅"; $("bulkWaCurrentTarget").style.color = "#22c55e"; $("btnSendNextWa").style.display = "none"; setTimeout(() => { closeModal("bulkWhatsAppModal"); }, 3000); return; }
  $("btnSendNextWa").style.display = "inline-block"; $("bulkWaCurrentTarget").style.color = "var(--text)"; const nextUser = bulkWaQueue[0]; $("bulkWaCurrentTarget").textContent = `العميل التالي: ${nextUser.name} (${bulkWaQueue.length} متبقي)`;
};
window.sendNextBulkWhatsApp = () => {
  if(bulkWaQueue.length === 0) return; const user = bulkWaQueue.shift(); const templateStr = $("bulkWaMsg").value;
  let endDateStr = user.subType === 'sessions' ? `الرصيد المتبقي: ${user.sessionsLeft} حصة` : `تاريخ: ${user.end}`;
  let msg = templateStr.replace(/{name}/g, user.name || "عميلنا العزيز").replace(/{end}/g, endDateStr).replace(/{service}/g, user.serviceType || "الخدمة");
  let cleanPhone = ((user.countryCode||'')+user.phone).replace(/[^0-9+]/g, ''); logAction("رسالة واتساب جماعية", `إلى: ${user.name}`);
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank'); window.updateBulkWaUI();
};

window.openRowActions = (id) => { 
  currentRowId = id; const rec = data.find(x => x.id === id); $("rowActionsHint").textContent = rec.name; 
  
  const hasNotes = rec.notes && rec.notes.trim() !== ""; const btnNotes = $("btnViewNotes");
  if(hasNotes) { btnNotes.disabled = false; btnNotes.style.opacity = "1"; btnNotes.onclick = window.openNotesAction; } 
  else { btnNotes.disabled = true; btnNotes.style.opacity = "0.4"; btnNotes.onclick = null; }
  
  const btnMsg = $("btnMessengerAction");
  if(btnMsg) {
      if(rec.messengerLink && rec.messengerLink.trim() !== "") { btnMsg.disabled = false; btnMsg.style.opacity = "1"; }
      else { btnMsg.disabled = true; btnMsg.style.opacity = "0.4"; }
  }

  const logCount = rec.attendanceLog ? rec.attendanceLog.length : 0; $("btnViewAttendance").textContent = `📅 سجل الحضور (${logCount})`;
  openModal("rowActionsModal"); 
};

window.openMembershipCard = () => {
  const rec = data.find(x => x.id === currentRowId); if(!rec) return; closeModal("rowActionsModal");
  $("idCardStoreName").textContent = storeSettings.name || "المؤسسة"; $("idCardClientName").textContent = rec.name || "-"; $("idCardService").textContent = rec.serviceType || "غير محدد";
  let alertD = parseInt($("alertDays")?.value) || 7; let st = getStatus(rec, alertD);
  $("idCardStatus").textContent = st.label; $("idCardStatus").style.color = st.cls === 'ok' ? '#10b981' : (st.cls === 'warn' ? '#f59e0b' : '#ef4444');
  $("idCardType").textContent = rec.subType === 'sessions' ? 'نظام حصص' : 'زمني';
  const qrBox = $("idCardQR"); qrBox.innerHTML = "";
  if(typeof QRCode !== 'undefined') { new QRCode(qrBox, { text: "ID:" + String(rec.id), width: 130, height: 130, colorDark : "#0f172a", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.M }); } else { qrBox.innerHTML = "<span style='color:red;'>مكتبة QR محظورة</span>"; }
  openModal("idCardModal");
};

window.openNotesAction = () => { const rec = data.find(x => x.id === currentRowId); if(!rec || !rec.notes) return; closeModal("rowActionsModal"); $("viewNotesContent").textContent = rec.notes; openModal("viewNotesModal"); };

window.actExtendAction = () => { extendMode = "single"; const rec = data.find(x => x.id === currentRowId); $("extendTitle").textContent = `تجديد لـ ${rec.name}`; $("lblExtendValue").textContent = rec.subType === 'sessions' ? "الحصص المضافة" : "المدة المضافة"; if(rec.subType === 'sessions') $("grpExtendUnit").style.display = "none"; else $("grpExtendUnit").style.display = "block"; $("extendValue").value = 1; $("extendUnit").value = "months"; closeModal("rowActionsModal"); openModal("extendModal"); };
window.actCopyEmailAction = () => { const rec = data.find(x => x.id === currentRowId); if(!rec || !rec.email) { closeModal("rowActionsModal"); return showToast("لا يوجد بريد.", "err"); } navigator.clipboard.writeText(rec.email); closeModal("rowActionsModal"); showToast("تم نسخ الإيميل 📋"); };
window.actWhatsAppAction = () => { const rec = data.find(x => x.id === currentRowId); if(!rec || !rec.phone) { closeModal("rowActionsModal"); return showToast("لا يوجد هاتف.", "err"); } let cleanPhone = ((rec.countryCode||'')+rec.phone).replace(/[^0-9+]/g, ''); let endTxt = rec.subType === 'sessions' ? `رصيدك المتبقي: ${rec.sessionsLeft} حصة` : `ينتهي بتاريخ: ${rec.end}`; window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(`مرحباً ${rec.name}، نود تذكيرك بخصوص اشتراكك الذي ${endTxt}.`)}`, '_blank'); closeModal("rowActionsModal"); };

window.actMessengerAction = () => { 
  const rec = data.find(x => x.id === currentRowId); 
  if(!rec || !rec.messengerLink) { closeModal("rowActionsModal"); return showToast("لا يوجد رابط تواصل مسجل لهذا العميل.", "err"); } 
  let link = rec.messengerLink.trim();
  if (link.includes("facebook.com/messages/t/")) { let id = link.split("facebook.com/messages/t/")[1].split("/")[0].split("?")[0]; link = "https://m.me/" + id; } 
  else if (link.includes("facebook.com/profile.php?id=")) { let id = link.split("id=")[1].split("&")[0]; link = "https://m.me/" + id; } 
  else if (link.includes("facebook.com/") && !link.includes("m.me")) { let id = link.split("facebook.com/")[1].split("/")[0].split("?")[0]; link = "https://m.me/" + id; }
  logAction("مراسلة العميل", `إلى: ${rec.name}`);
  window.open(link, '_blank'); closeModal("rowActionsModal"); 
};

window.actSMSAction = () => { const rec = data.find(x => x.id === currentRowId); if(!rec || !rec.phone) { closeModal("rowActionsModal"); return showToast("لا يوجد هاتف مسجل لهذا العميل.", "err"); } let cleanPhone = ((rec.countryCode||'')+rec.phone).replace(/[^0-9+]/g, ''); let endTxt = rec.subType === 'sessions' ? `رصيدك المتبقي: ${rec.sessionsLeft} حصة` : `ينتهي بتاريخ: ${rec.end}`; let msg = `مرحباً ${rec.name}، نود تذكيرك بخصوص اشتراكك الذي ${endTxt}.`; logAction("إرسال SMS", `إلى: ${rec.name}`); window.open(`sms:${cleanPhone}?body=${encodeURIComponent(msg)}`, '_self'); closeModal("rowActionsModal"); };

window.actDeleteAction = async () => { if(confirm("حذف المشترك نهائياً؟")) { const recToDelete = data.find(x => x.id === currentRowId); logAction("حذف اشتراك", `الاسم: ${recToDelete.name}`); lastDeletedData = data.filter(x => x.id === currentRowId); data = data.filter(x => x.id !== currentRowId); await firebasePush(); window.render(); closeModal("rowActionsModal"); showToast("تم الحذف 🗑️"); } };

window.calcDebt = () => { const p = parseFloat($("price").value) || 0; let valRaw = $("paidAmount").value; let a = valRaw === "" ? p : (parseFloat(valRaw) || 0); let d = p - a; $("debtAmount").value = d > 0 ? d : 0; };
window.handleQuickPlan = () => { if($("quickPlan").value) $("months").value = $("quickPlan").value; };

async function firebasePushPackages() { 
  saveLocalBackup();
  if(!navigator.onLine) return; 
  try { 
    await db.ref("packages").set(packagesData); 
  } catch(e) {} 
}

window.renderPackages = () => {
  const tb = $("packagesTbody"); if(tb) tb.innerHTML = ""; const sel = $("packageSelector"); if(sel) sel.innerHTML = '<option value="">✍️ لا أريد باقة، سأكتب البيانات بنفسي</option>';
  if(packagesData.length === 0) { if(tb) tb.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:15px; color:var(--muted);">لا توجد باقات جاهزة.</td></tr>`; return; }
  packagesData.forEach(p => { 
    let typeTxt = p.type === 'sessions' ? `${p.value} حصص` : `${p.value} شهر`; 
    if(tb) tb.innerHTML += `<tr><td style="font-weight:bold; color:var(--accent);">${p.name}</td><td>${p.serviceType}</td><td>${typeTxt}</td><td style="font-weight:bold;">${p.price}</td><td style="display:flex; gap:4px;">
      <button class="btn soft" style="padding:6px 10px; font-size:12px; border-radius:10px;" onclick="window.editPackage('${p.id}')">✏️</button>
      <button class="btn danger" style="padding:6px 10px; font-size:12px; border-radius:10px;" onclick="window.deletePackage('${p.id}')">🗑️</button>
    </td></tr>`; 
    if(sel) sel.innerHTML += `<option value="${p.id}">${p.name} - ${p.serviceType} (${p.price} DZD)</option>`; 
  });
};

window.editPackage = (id) => {
  const p = packagesData.find(x => x.id === id); if(!p) return;
  editingPkgId = id; $("pkgName").value = p.name; $("pkgService").value = p.serviceType; $("pkgType").value = p.type; $("pkgValue").value = p.value; $("pkgPrice").value = p.price;
  $("btnSavePackage").innerHTML = "💾 حفظ التعديل"; $("btnSavePackage").style.background = "#f59e0b"; $("btnSavePackage").style.borderColor = "#d97706";
  $("btnCancelPkgEdit").style.display = "block";
};

window.cancelEditPackage = () => {
  editingPkgId = null; $("pkgName").value = ""; $("pkgService").value = ""; $("pkgValue").value = ""; $("pkgPrice").value = "";
  $("btnSavePackage").innerHTML = "➕ إضافة الباقة"; $("btnSavePackage").style.background = ""; $("btnSavePackage").style.borderColor = "";
  $("btnCancelPkgEdit").style.display = "none";
};

window.savePackage = async () => { 
  const name = $("pkgName").value.trim(); const serviceType = $("pkgService").value.trim(); const type = $("pkgType").value; const val = parseInt($("pkgValue").value); const price = parseFloat($("pkgPrice").value) || 0; 
  if(!name || !serviceType || isNaN(val)) return showToast("بيانات ناقصة!", "err"); 
  const newId = editingPkgId || Date.now().toString(); const pkg = { id: newId, name, serviceType, type, value: val, price }; 
  if(editingPkgId) packagesData = packagesData.map(x => x.id === editingPkgId ? pkg : x); else packagesData.push(pkg); 
  setSyncState("saving"); await firebasePushPackages(); window.renderPackages(); window.cancelEditPackage(); setSyncState("ok"); showToast("تم حفظ الباقة 📦"); 
  const formModal = $("formModal"); if(formModal && formModal.getAttribute("aria-hidden") === "false") { $("packageSelector").value = newId; window.applyPackage(); closeModal('packagesModal'); }
};

window.deletePackage = async (id) => { if(!confirm("حذف الباقة؟")) return; packagesData = packagesData.filter(x => x.id !== id); setSyncState("saving"); await firebasePushPackages(); window.renderPackages(); setSyncState("ok"); showToast("تم الحذف"); };
window.applyPackage = () => { const pid = $("packageSelector").value; if(!pid) return; const p = packagesData.find(x => x.id === pid); if(p) { $("subType").value = p.type || 'time'; window.toggleSubType(); $("serviceType").value = p.serviceType; if(p.type === 'sessions') { $("sessionsTotal").value = p.value; } else { $("months").value = p.value; } $("price").value = p.price; $("quickPlan").value = ""; window.calcDebt(); } };

window.toggleAdvancedFields = (forceShow = false) => { const adv = $("advancedFields"); const btn = $("btnToggleAdvanced"); if(!adv || !btn) return; if (adv.style.display === "none" || forceShow === true) { adv.style.display = "block"; btn.innerHTML = "🔼 إخفاء الخيارات الإضافية"; btn.style.background = "rgba(124,92,255,0.1)"; btn.style.borderColor = "rgba(124,92,255,0.3)"; btn.style.color = "var(--text)"; } else { adv.style.display = "none"; btn.innerHTML = "🔽 إظهار الخيارات الإضافية (الإيميل، الملاحظات، الأوسمة، الميسنجر...)"; btn.style.background = "rgba(255,255,255,0.04)"; btn.style.borderColor = "rgba(255,255,255,0.14)"; btn.style.color = "var(--muted)"; } };

window.openAddSub = () => { editingId=null; $("formTitle").textContent="إضافة اشتراك"; $("name").value=""; $("email").value=""; $("phone").value=""; $("tags").value=""; $("messengerLink").value=""; $("countryCode").value="+213"; $("serviceType").value=""; $("quickPlan").value=""; $("months").value=""; $("sessionsTotal").value=""; $("sessionsLeft").value=""; $("price").value=""; $("start").value=todayISO(); $("paidAmount").value = ""; $("notes").value = ""; $("packageSelector").value = ""; $("subType").value = "time"; window.toggleSubType(); $("advancedFields").style.display = "block"; window.toggleAdvancedFields(false); window.calcDebt(); openModal("formModal"); };

window.actEditAction = () => { const rec = data.find(x => x.id === currentRowId); if(!rec) return; closeModal("rowActionsModal"); editingId = rec.id; $("formTitle").textContent = "تعديل اشتراك"; $("subType").value = rec.subType || "time"; window.toggleSubType(); $("name").value = rec.name||""; $("email").value = rec.email||""; $("phone").value = rec.phone||""; $("messengerLink").value = rec.messengerLink||""; $("countryCode").value = rec.countryCode||"+213"; $("tags").value = rec.tags||""; $("serviceType").value = rec.serviceType||""; $("months").value = rec.months||""; $("sessionsTotal").value = rec.sessionsTotal||""; $("sessionsLeft").value = rec.sessionsLeft||""; $("price").value = rec.price||""; $("currency").value = rec.currency||"DZD"; $("start").value = rec.start; $("alertDays").value = rec.alertDays||"7"; $("notes").value = rec.notes || ""; $("packageSelector").value = ""; $("quickPlan").value = ""; if(rec.paymentStatus === 'unpaid') $("paidAmount").value = 0; else if(rec.paymentStatus === 'partial') $("paidAmount").value = rec.paidAmount || 0; else $("paidAmount").value = ""; const hasAdvancedData = (rec.email && rec.email !== "") || (rec.tags && rec.tags !== "") || (rec.messengerLink && rec.messengerLink !== "") || (rec.notes && rec.notes.trim() !== "") || (rec.currency && rec.currency !== "DZD"); window.toggleAdvancedFields(hasAdvancedData); window.calcDebt(); openModal("formModal"); };

window.saveSubscription = async () => {
  const subType = $("subType").value; const start = $("start").value; const emailVal = $("email") ? $("email").value.trim() : ""; const messengerLinkVal = $("messengerLink") ? $("messengerLink").value.trim() : ""; const serviceVal = $("serviceType").value.trim(); const nameVal = $("name").value.trim(); let months = parseInt($("months").value); let sessionsTot = parseInt($("sessionsTotal").value); let sessionsLft = parseInt($("sessionsLeft").value);
  if(!nameVal || !serviceVal) return showToast("أدخل الاسم والخدمة", "err"); if(subType === 'time' && (!start || isNaN(months))) return showToast("أدخل تاريخ البداية والمدة", "err"); if(subType === 'sessions' && isNaN(sessionsTot)) return showToast("أدخل إجمالي الحصص", "err");
  const priceInput = $("price").value; const priceFloat = parseFloat(priceInput) || 0; const paidInput = $("paidAmount").value; const paidFloat = paidInput === "" ? priceFloat : (parseFloat(paidInput) || 0);
  let pStatus = 'paid'; if(paidFloat === 0 && priceFloat > 0) pStatus = 'unpaid'; else if(paidFloat < priceFloat) pStatus = 'partial';
  const actionName = editingId ? "تعديل اشتراك" : "إضافة اشتراك"; logAction(actionName, `الاسم: ${nameVal} - الخدمة: ${serviceVal}`); 
  let endISO = ""; if(subType === 'time') { const endD = new Date(start); endD.setMonth(endD.getMonth() + months); endISO = endD.toISOString().split('T')[0]; } if(subType === 'sessions' && isNaN(sessionsLft)) sessionsLft = sessionsTot; 
  const alertEl = $("alertDays");
  const rec = { id: editingId || Date.now().toString(), subType, name: nameVal, email: emailVal, messengerLink: messengerLinkVal, tags: $("tags").value, phone: $("phone").value, countryCode: $("countryCode").value, serviceType: serviceVal, alertDays: (alertEl && alertEl.value)?alertEl.value:7, price: priceInput, currency: $("currency").value, paymentStatus: pStatus, paidAmount: paidFloat, notes: $("notes").value };
  if(subType === 'time') { rec.start = start; rec.months = months; rec.end = endISO; } else { rec.sessionsTotal = sessionsTot; rec.sessionsLeft = sessionsLft; }
  
  if(editingId) {
    const oldRec = data.find(x => x.id === editingId);
    if(oldRec && oldRec.attendanceLog) rec.attendanceLog = oldRec.attendanceLog;
    if(oldRec && oldRec.paymentLog) rec.paymentLog = oldRec.paymentLog;
  } else {
    if(paidFloat > 0) { rec.paymentLog = [{ time: new Date().toISOString(), amount: paidFloat, note: "دفعة مبدئية" }]; }
  }

  if(editingId) data = data.map(x => x.id === editingId ? rec : x); else data.unshift(rec);
  await firebasePush(); window.render(); closeModal("formModal"); showToast("تم الحفظ ✨");
};

window.openReceiptAction = () => {
  const rec = data.find(x => x.id === currentRowId); if(!rec) return; closeModal("rowActionsModal"); 
  const sName = (storeSettings.name || "متجر_الاشتراكات").replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim().replace(/\s+/g, '_'); const cName = (rec.name || "عميل").replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim().replace(/\s+/g, '_'); const d = new Date(); const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.title = `فاتورة_${sName}_${cName}_${dateStr}`;
  $("receiptStoreName").textContent = storeSettings.name || "المؤسسة";
  if(storeSettings.logo) { $("receiptLogoImg").src = storeSettings.logo; $("receiptLogoImg").style.display = "block"; $("receiptLogoEmoji").style.display = "none"; } else { $("receiptLogoImg").style.display = "none"; $("receiptLogoEmoji").style.display = "block"; }
  $("recName").textContent = rec.name || "-"; $("recPhone").textContent = rec.phone ? `${rec.countryCode||''}${rec.phone}` : "-"; $("recService").textContent = rec.serviceType || "غير محدد"; 
  
  if(rec.subType === 'sessions') { $("recRowSessions").style.display = "flex"; $("recSessions").textContent = `${rec.sessionsTotal} حصة`; $("recRowMonths").style.display = "none"; $("recRowStart").style.display = "none"; $("recRowEnd").style.display = "none"; } 
  else { $("recRowMonths").style.display = "flex"; $("recMonths").textContent = `${rec.months || 0} شهر`; $("recRowStart").style.display = "flex"; $("recStart").textContent = rec.start || "-"; $("recRowEnd").style.display = "flex"; $("recEnd").textContent = rec.end || "-"; $("recRowSessions").style.display = "none"; }

  $("recPrice").textContent = `${parseFloat(rec.price || 0).toLocaleString()} ${rec.currency || 'DZD'}`;
  let pStatus = rec.paymentStatus || 'paid'; let pText = pStatus === 'paid' ? '🟢 مدفوع بالكامل' : (pStatus === 'unpaid' ? '🔴 غير مدفوع' : '🟡 دفع جزئي'); $("recPaymentStatus").textContent = pText;
  if(pStatus === 'partial') { $("recPaidAmountRow").style.display = "flex"; $("recPaidAmount").textContent = `${parseFloat(rec.paidAmount || 0).toLocaleString()} ${rec.currency || 'DZD'}`; } else { $("recPaidAmountRow").style.display = "none"; }
  if(pStatus === 'partial' || pStatus === 'unpaid') { $("recRemainingRow").style.display = "flex"; let total = parseFloat(rec.price) || 0; let paid = pStatus === 'unpaid' ? 0 : (parseFloat(rec.paidAmount) || 0); let rem = total - paid; $("recRemaining").textContent = `${rem.toLocaleString()} ${rec.currency || 'DZD'}`; } else { $("recRemainingRow").style.display = "none"; }
  
  const pList = $("receiptPaymentLogList"); pList.innerHTML = "";
  if(rec.paymentLog && rec.paymentLog.length > 0) {
      $("receiptPaymentLogSection").style.display = "block";
      rec.paymentLog.forEach(log => {
          const logD = new Date(log.time); const logDStr = logD.toLocaleDateString('en-GB') + " " + logD.toLocaleTimeString('en-GB', {hour: '2-digit', minute:'2-digit'});
          pList.innerHTML += `<div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9;">
              <span style="color:#64748b; font-size: 13px;">${logDStr}</span>
              <strong style="color:#10b981; font-size: 14px;">${parseFloat(log.amount).toLocaleString()} ${rec.currency||'DZD'}</strong>
          </div>`;
      });
  } else { $("receiptPaymentLogSection").style.display = "none"; }

  $("recToday").textContent = `${d.toLocaleDateString('en-GB')} - ${d.toLocaleTimeString('en-GB')}`; logAction("إصدار وصل", `للعميل: ${rec.name}`); openModal("receiptModal"); 
};

// وظائف الإرسال والطباعة المدمجة
window.sendWhatsAppReceipt = () => {
    const rec = data.find(x => x.id === currentRowId);
    if(!rec || !rec.phone) return showToast("لا يوجد هاتف مسجل لهذا العميل.", "err");
    let cleanPhone = ((rec.countryCode||'')+rec.phone).replace(/[^0-9+]/g, '');
    let msg = `مرحباً ${rec.name} 📄\nمرفق تفاصيل اشتراكك في (${rec.serviceType}).\n- السعر الإجمالي: ${rec.price||0} ${rec.currency||'DZD'}\n- ما تم دفعه: ${rec.paidAmount||0}\n\nشكراً لثقتكم بنا. (يمكنك إرسال ملف الـ PDF أو الصورة هنا)`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.sendWhatsAppIdCard = () => {
    const rec = data.find(x => x.id === currentRowId);
    if(!rec || !rec.phone) return showToast("لا يوجد هاتف مسجل لهذا العميل.", "err");
    let cleanPhone = ((rec.countryCode||'')+rec.phone).replace(/[^0-9+]/g, '');
    let msg = `مرحباً ${rec.name} 🪪\nتم إصدار بطاقة الانخراط الرقمية الخاصة بك لخدمة (${rec.serviceType}).\nيرجى إبراز البطاقة عند الدخول.\n\n(يمكنك إرسال ملف الـ PDF أو الصورة هنا)`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.printReceiptAction = () => { 
    document.body.classList.add("print-mode-receipt"); 
    $("receiptModal").classList.add("print-active"); 
    window.print(); 
    setTimeout(()=>{ 
        document.body.classList.remove("print-mode-receipt"); 
        $("receiptModal").classList.remove("print-active"); 
    }, 500); 
};

window.printIdCardAction = () => { 
    document.body.classList.add("print-mode-idcard"); 
    $("idCardModal").classList.add("print-active"); 
    window.print(); 
    setTimeout(()=>{ 
        document.body.classList.remove("print-mode-idcard"); 
        $("idCardModal").classList.remove("print-active"); 
    }, 500); 
};

// دوال تصدير الـ PDF الجديدة والمضمونة للعربية (عبر html-to-image)
window.downloadReceiptPDF = () => {
    const element = document.querySelector('.receipt-content');
    const clientName = ($("recName").textContent || "Client").replace(/\s+/g, '_');
    showToast("جاري تجهيز الفاتورة... ⏳", "ok");
    
    element.querySelectorAll('canvas').forEach(c => {
        const img = new Image(); img.src = c.toDataURL(); img.style.cssText = c.style.cssText;
        c.parentNode.replaceChild(img, c);
    });

    htmlToImage.toPng(element, { backgroundColor: '#ffffff', pixelRatio: 2 })
        .then(function (dataUrl) {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a5');
            const imgProps = pdf.getImageProperties(dataUrl);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`Invoice_${clientName}.pdf`);
            showToast("تم تحميل الفاتورة بنجاح 📥", "ok");
        })
        .catch(err => { console.error(err); showToast("حدث خطأ أثناء التوليد", "err"); });
};

window.downloadIdCardPDF = () => {
    const element = document.querySelector('.id-card-content');
    const clientName = ($("idCardClientName").textContent || "Client").replace(/\s+/g, '_');
    showToast("جاري تجهيز البطاقة... ⏳", "ok");
    
    element.querySelectorAll('canvas').forEach(c => {
        const img = new Image(); img.src = c.toDataURL(); img.style.cssText = c.style.cssText;
        img.style.width = "100%"; 
        c.parentNode.replaceChild(img, c);
    });

    htmlToImage.toPng(element, { backgroundColor: '#ffffff', pixelRatio: 3 })
        .then(function (dataUrl) {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a6');
            const imgProps = pdf.getImageProperties(dataUrl);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`MembershipCard_${clientName}.pdf`);
            showToast("تم تحميل البطاقة بنجاح 📥", "ok");
        })
        .catch(err => { console.error(err); showToast("حدث خطأ أثناء التوليد", "err"); });
};

let financeChartInstance = null;
let servicesChartInstance = null;

window.openTotalsReport = () => { 
  const alertEl = $("alertDays"); 
  const alertD = (alertEl && alertEl.value) ? parseInt(alertEl.value) : 7; 
  const activeData = data.filter(r => getStatus(r, alertD).key !== "expired"); 
  
  const totalsByCurrency = {}; 
  const debtsByCurrency = {}; 
  const serviceCounts = {};

  let totalPaidForChart = 0;
  let totalDebtForChart = 0;

  activeData.forEach(r => { 
    const curr = r.currency || "DZD"; 
    const price = parseFloat(r.price) || 0; 
    let paid = 0;

    if(r.paymentStatus === 'unpaid') { 
      debtsByCurrency[curr] = (debtsByCurrency[curr] || 0) + price; 
      totalDebtForChart += price;
    } else if(r.paymentStatus === 'partial') { 
      paid = parseFloat(r.paidAmount) || 0; 
      totalsByCurrency[curr] = (totalsByCurrency[curr] || 0) + paid; 
      debtsByCurrency[curr] = (debtsByCurrency[curr] || 0) + (price - paid); 
      totalPaidForChart += paid;
      totalDebtForChart += (price - paid);
    } else { 
      totalsByCurrency[curr] = (totalsByCurrency[curr] || 0) + price; 
      totalPaidForChart += price;
    } 

    const srv = r.serviceType || "غير محدد"; 
    serviceCounts[srv] = (serviceCounts[srv] || 0) + 1; 
  });

  let totalsHtml = ""; 
  if (Object.keys(totalsByCurrency).length === 0) { totalsHtml = `<div style="color:var(--accent); font-size:32px; margin-bottom:10px;">0 <span style="font-size:18px; color:var(--muted);">DZD</span></div>`; } 
  else { for (let curr in totalsByCurrency) { totalsHtml += `<div style="color:var(--accent); font-size:32px; margin-bottom:5px;">${totalsByCurrency[curr].toLocaleString()} <span style="font-size:18px; color:var(--muted);">${curr}</span></div>`; } }
  
  let debtsHtml = ""; 
  if (Object.keys(debtsByCurrency).length > 0) { debtsHtml = `<div style="margin-top:10px; padding:10px; background:rgba(239,68,68,0.1); border-radius:12px; border:1px solid rgba(239,68,68,0.3);"><div style="color:#ef4444; font-size:12px; font-weight:bold; margin-bottom:5px;">❗ الديون المعلقة (غير المحصلة):</div>`; for (let curr in debtsByCurrency) { debtsHtml += `<div style="color:#ef4444; font-size:16px; font-weight:900;">${debtsByCurrency[curr].toLocaleString()} ${curr}</div>`; } debtsHtml += `</div>`; }
  
  $("totalsBody").innerHTML = `${totalsHtml}<div style="font-size:13px; color:var(--muted);">المداخيل الصافية من الاشتراكات الفعّالة فقط.</div>${debtsHtml}`; 
  openModal("totalsModal"); 

  setTimeout(() => {
      const ctxFin = document.getElementById('financeChart');
      if(ctxFin) {
          if(financeChartInstance) financeChartInstance.destroy();
          financeChartInstance = new Chart(ctxFin.getContext('2d'), {
              type: 'doughnut', 
              data: {
                  labels: ['المُحصّل', 'الديون'],
                  datasets: [{
                      data: [totalPaidForChart, totalDebtForChart],
                      backgroundColor: ['#10b981', '#ef4444'],
                      borderWidth: 0, hoverOffset: 4
                  }]
              },
              options: { plugins: { legend: { labels: { color: '#eaf0ff', font: { family: 'system-ui' } }, position: 'bottom' }, title: { display: true, text: 'الوضع المالي العام', color: '#a78bfa', font: {size: 14} } } }
          });
      }

      const ctxSrv = document.getElementById('servicesChart');
      if(ctxSrv) {
          if(servicesChartInstance) servicesChartInstance.destroy();
          servicesChartInstance = new Chart(ctxSrv.getContext('2d'), {
              type: 'pie', 
              data: {
                  labels: Object.keys(serviceCounts),
                  datasets: [{
                      data: Object.values(serviceCounts),
                      backgroundColor: ['#7c5cff', '#0ea5e9', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6', '#64748b'],
                      borderWidth: 0
                  }]
              },
              options: { plugins: { legend: { labels: { color: '#eaf0ff', font: { family: 'system-ui' } }, position: 'bottom' }, title: { display: true, text: 'توزيع المشتركين حسب الخدمات', color: '#a78bfa', font: {size: 14} } } }
          });
      }
  }, 100);
};

window.exportCSV = () => { 
  if(data.length === 0) return showToast("لا توجد بيانات لتصديرها", "warn"); 
  let csv = "\uFEFFالاسم,الأوسمة,الإيميل,الهاتف,رابط ميسنجر,النوع,الخدمة,المدة/الحصص,السعر,حالة الدفع,تاريخ البداية,تاريخ الانتهاء,الرصيد المتبقي,عدد مرات الدخول\n"; 
  data.forEach(r => { 
    let phone = r.phone ? `${r.countryCode||''}${r.phone}` : ''; let payStat = r.paymentStatus === 'unpaid' ? 'غير مدفوع' : (r.paymentStatus === 'partial' ? 'جزئي' : 'خالص'); let typeTxt = r.subType === 'sessions' ? 'حصص' : 'زمني'; let valTxt = r.subType === 'sessions' ? `${r.sessionsTotal} حصة` : `${r.months} شهر`; let safeTags = (r.tags||'').replace(/"/g, '""'); let attendanceCount = r.attendanceLog ? r.attendanceLog.length : 0;
    csv += `"${r.name||''}","${safeTags}","${r.email||''}","${phone}","${r.messengerLink||''}","${typeTxt}","${r.serviceType||''}","${valTxt}","${r.price||0} ${r.currency||'DZD'}","${payStat}","${r.start||''}","${r.end||''}","${r.sessionsLeft||''}","${attendanceCount}"\n`; 
  }); 
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Subscriptions_Excel_${todayISO()}.csv`; a.click(); closeSideMenu(); showToast("تم التصدير بنجاح 📥"); 
};

window.undoDelete = async () => { if(!lastDeletedData || lastDeletedData.length === 0) { closeSideMenu(); return showToast("لا يوجد أي حذف أخير لاسترجاعه", "warn"); } logAction("تراجع عن الحذف", `استرجاع ${lastDeletedData.length} اشتراكات`); data = [...lastDeletedData, ...data]; lastDeletedData = null; await firebasePush(); window.render(); closeSideMenu(); showToast("تم الاسترجاع ↩️"); };
window.exportJson = () => { if(data.length === 0) return showToast("لا توجد بيانات", "warn"); const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data)); const a = document.createElement("a"); a.href = dataStr; a.download = `Backup_${todayISO()}.json`; a.click(); closeSideMenu(); showToast("تم التنزيل 📥"); };
window.importFile = () => $("fileInput").click();
window.handleFileSelect = (e) => { const file = e.target.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = async (event) => { try { const imported = JSON.parse(event.target.result); if(Array.isArray(imported)) { data = imported; await firebasePush(); window.render(); closeModal("backupModal"); closeSideMenu(); showToast("تم الاستيراد ✅"); } } catch(err) { showToast("ملف غير صالح", "err"); } }; reader.readAsText(file); };
window.confirmPaste = async () => { try { const imported = JSON.parse($("pasteArea").value); if(Array.isArray(imported)) { data = imported; await firebasePush(); window.render(); closeModal("pasteModal"); closeModal("backupModal"); closeSideMenu(); $("pasteArea").value=""; showToast("تم الاستيراد ✅"); } } catch(e) { showToast("كود غير صالح", "err"); } };
window.clearAllData = async () => { if(confirm("⚠️ تحذير خطير: سيتم مسح كل البيانات!")) { logAction("تصفير اللوحة", "حذف كافة البيانات ⚠️"); lastDeletedData = [...data]; data = []; await firebasePush(); window.render(); closeSideMenu(); showToast("تم المسح 🗑️ (يمكنك التراجع من الأدوات)"); } };
window.shareApp = () => { closeSideMenu(); if (navigator.share) { navigator.share({ title: 'لوحة الاشتراكات', url: window.location.href }); } else { showToast("المشاركة غير مدعومة", "warn"); } };

window.loginUser = () => { auth.signInWithEmailAndPassword($("authEmailAuth").value, $("authPass").value).catch(e => showToast("بيانات الدخول خاطئة", "err")); };
window.logoutUser = () => { auth.signOut(); };

let searchTimeout;
window.debounceSearch = () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { window.currentPage = 1; window.render(); }, 400); };
window.clearSearch = () => { $("search").value = ""; window.currentPage = 1; window.render(); };
window.pasteSearch = async () => { try { const text = await navigator.clipboard.readText(); $("search").value = text; window.currentPage = 1; window.render(); } catch(e) { showToast("فشل اللصق، يرجى منح صلاحية الحافظة", "warn"); } };
window.setFilter = (btn, filterType) => { document.querySelectorAll(".filterBtn").forEach(x=>x.classList.remove("active")); btn.classList.add("active"); currentFilter = filterType; window.currentPage = 1; window.render(); };

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btnInstallApp');
    if(installBtn) installBtn.style.display = 'block';
});

window.installPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { console.log('تم قبول التثبيت'); }
    deferredPrompt = null;
    document.getElementById('btnInstallApp').style.display = 'none';
    closeSideMenu();
};

window.addEventListener('appinstalled', (evt) => {
    window.showToast("تم تثبيت التطبيق بنجاح! 🎉", "ok");
});

window.generatePortalLink = () => {
    const rec = data.find(x => x.id === currentRowId);
    if(!rec) return;

    let debt = (parseFloat(rec.price)||0) - (parseFloat(rec.paidAmount)||0);
    if(debt < 0) debt = 0;

    const payload = {
        n: rec.name || "عميل", srv: rec.serviceType || "غير محدد", ty: rec.subType || "time",
        sl: rec.sessionsLeft || 0, st: rec.sessionsTotal || 0, sd: rec.start || "-", ed: rec.end || "-",
        db: debt, cr: rec.currency || "DZD", sn: storeSettings.name || "المؤسسة"
    };

    try {
        const jsonStr = JSON.stringify(payload);
        const base64 = window.btoa(unescape(encodeURIComponent(jsonStr)));
        const safeBase64 = encodeURIComponent(base64);

        let currentUrl = window.location.href.split('?')[0];
        if(currentUrl.endsWith('/')) currentUrl = currentUrl.slice(0, -1);
        if(currentUrl.endsWith('.html')) currentUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/'));
        
        const link = currentUrl + "/portal.html?p=" + safeBase64;

        closeModal("rowActionsModal");

        const safeClientName = (rec.name || "Client").replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim().replace(/\s+/g, '_');

        const overlay = document.createElement('div');
        overlay.id = "qrOverlayModal";
        overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(5px);";
        
        const box = document.createElement('div');
        box.style.cssText = "background:#0a0e1a; border:1px solid #c084fc; border-radius:24px; padding:30px 20px; width:100%; max-width:360px; text-align:center; box-shadow: 0 20px 50px rgba(0,0,0,0.5);";
        
        box.innerHTML = `
            <style>
                #tempQrBox canvas, #tempQrBox img { width: 100% !important; height: auto !important; }
            </style>
            <h3 style="color:#c084fc; margin:0 0 5px 0; font-size:20px;">🌐 بوابة المشترك</h3>
            <p style="color:#94a3b8; font-size:13px; margin-bottom:20px;">حمل الكود أو ارسل الرابط للعميل</p>
            
            <div id="tempQrBox" style="background:#fff; padding:15px; border-radius:16px; width: 200px; margin: 0 auto 20px auto; aspect-ratio: 1/1;"></div>
            
            <input type="text" value="${link}" readonly style="width:100%; padding:12px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:12px; margin-bottom:20px; text-align:left; direction:ltr; outline:none;" id="tempLinkInput">
            
            <div style="display:flex; flex-direction:column; gap:10px;">
                <button class="btn primary" style="font-size:14px; padding:12px; box-shadow: 0 4px 15px rgba(124,92,255,0.3);" onclick="document.getElementById('tempLinkInput').select(); navigator.clipboard.writeText(document.getElementById('tempLinkInput').value); window.showToast('تم النسخ! 📋');">📋 نسخ الرابط النصي</button>
                <div style="display:flex; gap:10px;">
                    <button class="btn soft" id="btnDownloadQR" style="flex:1; font-size:14px; padding:12px; color:#10b981; border-color:rgba(16,185,129,0.4); background:rgba(16,185,129,0.1);">📥 تحميل كصورة</button>
                    <button class="btn danger" style="flex:1; font-size:14px; padding:12px;" onclick="document.getElementById('qrOverlayModal').remove()">✕ إغلاق</button>
                </div>
            </div>
        `;
        
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        new QRCode(document.getElementById("tempQrBox"), {
            text: link,
            width: 512,
            height: 512,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });

        document.getElementById("btnDownloadQR").onclick = () => {
            const qrBox = document.getElementById("tempQrBox");
            const canvas = qrBox.querySelector("canvas");
            if(canvas) {
                const a = document.createElement("a");
                a.href = canvas.toDataURL("image/png", 1.0);
                a.download = `QR_Portal_${safeClientName}.png`;
                a.click();
                window.showToast("تم تحميل الصورة بنجاح! 📥");
            } else {
                window.showToast("حدث خطأ في تجهيز الصورة", "err");
            }
        };

    } catch(err) {
        showToast("حدث خطأ أثناء التشفير", "err");
    }
};
