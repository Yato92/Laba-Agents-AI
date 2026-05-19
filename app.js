// ============================================================
//  Vein's — Full Application Logic (SPA)
//  All data stored in localStorage
//  EmailJS integration for sending verification codes
// ============================================================

// ===================== EMAILJS CONFIG =====================
// Для реальной отправки: зарегистрируйтесь на https://www.emailjs.com/
// Создайте сервис, шаблон и получите ключи. Вставьте их ниже.
// Пока работает в демо-режиме (код показывается в консоли)
const EMAILJS_CONFIG = {
    publicKey: 'K40OdfIbGQ0Qp0_Q1',
    serviceID: 'service_k1uzenn',
    templateID: 'template_46bb7vl',
    useEmailJS: true
};

// ===================== DATA LAYER =====================
const DB = {
    get(key, def = null) {
        try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : def; } catch { return def; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
    remove(key) { localStorage.removeItem(key); },

    getUsers() { return this.get('veins_users', {}); },
    saveUsers(u) { this.set('veins_users', u); },
    getCurrentUser() { return this.get('veins_current_user', null); },
    setCurrentUser(u) { this.set('veins_current_user', u); },
    clearCurrentUser() { this.remove('veins_current_user'); },

    getNotes(email) {
        const all = this.get('veins_notes', {});
        return all[email] || [];
    },
    saveNotes(email, notes) {
        const all = this.get('veins_notes', {});
        all[email] = notes;
        this.set('veins_notes', all);
    },

    getContacts(email) {
        const all = this.get('veins_contacts', {});
        return all[email] || [];
    },
    saveContacts(email, contacts) {
        const all = this.get('veins_contacts', {});
        all[email] = contacts;
        this.set('veins_contacts', all);
    },
};

// ===================== STATE =====================
let currentUser = null;
let editingNoteId = null;
let currentChatContact = null;
let calMonth = 4;
let calYear = 2026;
let selectedCalDate = '';
let pendingVerificationEmail = '';
let pendingVerificationCode = '';
let verificationPurpose = ''; // 'register' | 'reset'
let lastResendTime = 0;

// ===================== HELPERS =====================
function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function formatDateDisplay(d) {
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getCurrentLang() {
    return document.getElementById('langSelect')?.value || (currentUser ? DB.get('veins_lang_' + currentUser.email, 'ru') : 'ru');
}

function tr(key) {
    const lang = getCurrentLang();
    const t = translations[lang] || translations.ru;
    return t[key] !== undefined ? t[key] : key;
}

function getPriorityLabel(p) {
    const lang = getCurrentLang();
    const t = translations[lang] || translations.ru;
    return t.priorityLabels[p] || t.medium;
}

function getPriorityClass(p) {
    return 'priority-' + (p || 'medium');
}

// ===================== PAGE NAV =====================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
}

// ===================== AUTH PAGES NAV =====================
function showAuthPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
}

// ===================== AUTH =====================
// --- REGISTER ---
document.getElementById('registerForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    const errEl = document.getElementById('regError');

    if (!email || !username || !password || !password2) {
        errEl.textContent = 'Заполните все поля'; return;
    }
    if (!email.includes('@')) { errEl.textContent = 'Введите корректный email'; return; }
    if (password.length < 6) { errEl.textContent = 'Пароль должен быть минимум 6 символов'; return; }
    if (password !== password2) { errEl.textContent = 'Пароли не совпадают'; return; }

    const users = DB.getUsers();
    if (users[email]) { errEl.textContent = 'Пользователь с таким email уже существует'; return; }

    // Сохраняем данные временно
    pendingVerificationEmail = email;
    DB.set('veins_pending_reg', { email, name: username, password });
    verificationPurpose = 'register';

    errEl.textContent = '';
    sendVerificationCode(email);
});

// --- LOGIN ---
document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');

    if (!email || !password) { errEl.textContent = 'Заполните все поля'; return; }

    const users = DB.getUsers();
    const user = users[email];

    if (!user) { errEl.textContent = 'Пользователь с таким email не найден'; return; }
    if (user.password !== password) { errEl.textContent = 'Неверный пароль'; return; }

    errEl.textContent = '';
    
    // Вход успешен — сразу переходим в приложение
    currentUser = user;
    DB.setCurrentUser(user);
    initApp();
});

// --- FORGOT PASSWORD ---
document.getElementById('forgotForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim().toLowerCase();
    const errEl = document.getElementById('forgotError');

    if (!email) { errEl.textContent = 'Введите email'; return; }

    const users = DB.getUsers();
    if (!users[email]) { errEl.textContent = 'Пользователь с таким email не найден'; return; }

    pendingVerificationEmail = email;
    verificationPurpose = 'reset';
    errEl.textContent = '';
    sendVerificationCode(email);
});

// --- RESET PASSWORD ---
document.getElementById('resetForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const password = document.getElementById('resetPassword').value;
    const password2 = document.getElementById('resetPassword2').value;
    const errEl = document.getElementById('resetError');

    if (!password || !password2) { errEl.textContent = 'Заполните все поля'; return; }
    if (password.length < 6) { errEl.textContent = 'Пароль должен быть минимум 6 символов'; return; }
    if (password !== password2) { errEl.textContent = 'Пароли не совпадают'; return; }

    const users = DB.getUsers();
    if (users[pendingVerificationEmail]) {
        users[pendingVerificationEmail].password = password;
        DB.saveUsers(users);
        errEl.textContent = '';
        showToast('Пароль успешно изменён! Войдите с новым паролем.', 'success');
        showAuthPage('login');
        document.getElementById('loginEmail').value = pendingVerificationEmail;
    }
});

// ===================== SEND VERIFICATION CODE =====================
function sendVerificationCode(email) {
    const code = generateCode();
    pendingVerificationEmail = email;
    pendingVerificationCode = code;

    // Отображаем код в консоли (на случай если EmailJS не настроен)
    console.log(`%c[Vein's] Код подтверждения для ${email}: ${code}`, 'color:#3B82F6;font-size:16px;font-weight:bold;');
    
    // Показываем код на странице
    document.getElementById('verifyHint').innerHTML = `Код отправлен на <strong>${email}</strong>. Демо-код: <strong style="color:#3B82F6;font-size:18px;">${code}</strong>`;
    document.getElementById('verifyStatus').textContent = '';
    document.getElementById('verifyStatus').className = 'verify-status';
    
    // Очищаем поля ввода кода
    document.querySelectorAll('.code-digit').forEach(inp => inp.value = '');

    // Пробуем отправить через EmailJS
    if (EMAILJS_CONFIG.useEmailJS && emailjs) {
        try {
            emailjs.init(EMAILJS_CONFIG.publicKey);
            emailjs.send(EMAILJS_CONFIG.serviceID, EMAILJS_CONFIG.templateID, {
                to_email: email,
                to_name: email.split('@')[0],
                verification_code: code,
                message: `Ваш код подтверждения: ${code}`
            }).then(() => {
                document.getElementById('verifyHint').innerHTML = `Код отправлен на <strong>${email}</strong>`;
            }).catch(() => {
                // Если EmailJS не сработал, оставляем демо-режим
            });
        } catch(e) {}
    }

    // Переходим на страницу подтверждения
    if (verificationPurpose === 'reset') {
        document.getElementById('verifySubtitle').textContent = 'Введите код для сброса пароля';
    } else {
        document.getElementById('verifySubtitle').textContent = 'Мы отправили код на вашу почту';
    }
    
    showAuthPage('verify');
    
    // Фокус на первый инпут
    const firstInput = document.querySelector('.code-digit');
    if (firstInput) firstInput.focus();
}

// ===================== VERIFY CODE =====================
function verifyCode() {
    const inputs = document.querySelectorAll('.code-digit');
    const code = Array.from(inputs).map(i => i.value).join('');
    const status = document.getElementById('verifyStatus');

    if (code.length !== 6) {
        status.textContent = 'Введите 6-значный код';
        status.className = 'verify-status error';
        return;
    }

    // Демо: любой 6-значный код или совпадающий с отправленным
    if (code !== pendingVerificationCode && code !== '123456') {
        status.textContent = 'Неверный код!';
        status.className = 'verify-status error';
        return;
    }

    status.textContent = 'УСПЕШНО!';
    status.className = 'verify-status success';

    if (verificationPurpose === 'register') {
        // Создаём пользователя
        const pending = DB.get('veins_pending_reg');
        if (pending) {
            const users = DB.getUsers();
            users[pending.email] = { email: pending.email, name: pending.name, password: pending.password, createdAt: new Date().toISOString() };
            DB.saveUsers(users);
            DB.remove('veins_pending_reg');
            
            currentUser = users[pending.email];
            DB.setCurrentUser(currentUser);
            
            setTimeout(() => initApp(), 1000);
        }
    } else if (verificationPurpose === 'reset') {
        // Переходим на страницу смены пароля
        setTimeout(() => {
            showAuthPage('reset');
        }, 1000);
    }
}

// ===================== RESEND CODE =====================
function resendCode() {
    const now = Date.now();
    if (now - lastResendTime < 30000) {
        showToast('Подождите 30 секунд перед повторной отправкой', 'info');
        return;
    }
    lastResendTime = now;
    sendVerificationCode(pendingVerificationEmail);
    showToast('Код отправлен снова!', 'success');
}

// ===================== LOGOUT =====================
function logout() {
    if (!confirm('Вы уверены, что хотите выйти?')) return;
    currentUser = null;
    DB.clearCurrentUser();
    showAuthPage('login');
    document.getElementById('loginForm').reset();
    showToast('Вы вышли из аккаунта', 'info');
}

// ===================== TOAST =====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.style.cssText = `background:${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};color:white;padding:12px 18px;border-radius:10px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn 0.3s ease;margin-bottom:8px;`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100px)'; toast.style.transition = '0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ===================== CODE INPUTS INIT =====================
document.querySelectorAll('.code-digit').forEach((input, idx, inputs) => {
    input.addEventListener('input', function() {
        if (this.value && idx < inputs.length - 1) inputs[idx + 1].focus();
        document.getElementById('verifyStatus').textContent = '';
        document.getElementById('verifyStatus').className = 'verify-status';
    });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !this.value && idx > 0) inputs[idx - 1].focus();
    });
});

// ===================== INIT APP (after login) =====================
function initApp() {
    showPage('page-app');
    if (!currentUser) currentUser = DB.getCurrentUser();
    if (!currentUser) return;

    updateTopBar();
    updateProfileDisplay();
    loadTheme();
    loadLanguage();
    loadAvatar();
    initDemoData();
    selectedCalDate = getTodayStr();
    renderAll();
    navigateTo('workspace');
}

function initDemoData() {
    // Новый пользователь начинает с пустыми заметками и контактами
}

function updateTopBar() {
    const name = currentUser.name || '';
    const email = currentUser.email || '';
    document.getElementById('topName').textContent = name;
    document.getElementById('topMail').textContent = email;
    const avatarData = DB.get('veins_avatar_' + currentUser.email);
    if (avatarData) {
        document.getElementById('topAvatar').innerHTML = `<img src="${avatarData}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">`;
    } else {
        document.getElementById('topAvatar').innerHTML = '';
    }
}

function renderAll() {
    renderNotes();
    renderCalendar();
    renderSelectedDayNotes();
    renderImportantTasks();
    renderContacts();
}

// ===================== THEME =====================
function applyTheme() {
    const theme = document.getElementById('themeSelect').value;
    document.body.classList.toggle('light-theme', theme === 'light');
    DB.set('veins_theme_' + currentUser.email, theme);
}

function loadTheme() {
    const theme = DB.get('veins_theme_' + currentUser.email, 'dark');
    document.getElementById('themeSelect').value = theme;
    document.body.classList.toggle('light-theme', theme === 'light');
}

// ===================== AVATAR =====================
function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        DB.set('veins_avatar_' + currentUser.email, dataUrl);
        loadAvatar();
        showToast('Аватар обновлён', 'success');
    };
    reader.readAsDataURL(file);
}

function loadAvatar() {
    const avatarData = DB.get('veins_avatar_' + currentUser.email);
    if (avatarData) {
        document.getElementById('profAvatar').innerHTML = `<img src="${avatarData}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        document.getElementById('profAvatar').style.background = 'transparent';
        document.getElementById('profAvatar').style.fontSize = '0';
        document.getElementById('topAvatar').innerHTML = `<img src="${avatarData}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">`;
    } else {
        document.getElementById('profAvatar').innerHTML = '';
        document.getElementById('profAvatar').style.background = 'var(--primary)';
        document.getElementById('profAvatar').style.fontSize = '26px';
        document.getElementById('topAvatar').innerHTML = '';
    }
}

// ===================== SIDEBAR NAV =====================
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
        e.preventDefault();
        const page = this.dataset.page;
        if (page) navigateTo(page);
    });
});

function navigateTo(page) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');
    const content = document.getElementById(`page-${page}`);
    if (content) content.classList.add('active');
    const lang = getCurrentLang();
    const t = translations[lang] || translations.ru;
    const titles = { workspace: t.topBarWorkspace, profile: t.topBarProfile, contacts: t.topBarContacts };
    document.querySelector('.top-bar-title').textContent = titles[page] || t.topBarWorkspace;
    if (page === 'workspace') { renderNotes(); renderCalendar(); renderSelectedDayNotes(); renderImportantTasks(); }
    if (page === 'profile') updateProfileDisplay();
    if (page === 'contacts') renderContacts();
}

function scrollToSettings() {
    navigateTo('profile');
    setTimeout(() => {
        const el = document.getElementById('profileSettings');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

// ===================== PROFILE =====================
function updateProfileDisplay() {
    const p = DB.get('veins_profile_' + currentUser.email) || {};
    const name = p.name || currentUser.name || '';
    const email = p.email || currentUser.email || '';
    const phone = p.phone || '';
    const birth = p.birth || '';
    const city = p.city || '';
    const position = p.position || '';
    const team = p.team || '';
    document.getElementById('profName').textContent = name;
    document.getElementById('profEmail').textContent = email;
    document.getElementById('profPhone').textContent = phone;
    document.getElementById('profBirth').textContent = birth;
    document.getElementById('profCity').textContent = city;
    document.getElementById('profPosition').textContent = position;
    document.getElementById('profTeam').textContent = team;
    loadAvatar();
    updateTopBar();
}

function openEditProfile() {
    const p = DB.get('veins_profile_' + currentUser.email) || {};
    document.getElementById('epName').value = p.name || currentUser.name || '';
    document.getElementById('epEmail').value = p.email || currentUser.email || '';
    document.getElementById('epPhone').value = p.phone || '';
    document.getElementById('epBirth').value = p.birth || '';
    document.getElementById('epPosition').value = p.position || '';
    document.getElementById('epCity').value = p.city || '';
    document.getElementById('epTeam').value = p.team || '';
    openModal('modalEditProfile');
}

function saveProfile() {
    const data = { name: document.getElementById('epName').value.trim(), email: document.getElementById('epEmail').value.trim(), phone: document.getElementById('epPhone').value.trim(), birth: document.getElementById('epBirth').value, position: document.getElementById('epPosition').value.trim(), city: document.getElementById('epCity').value.trim(), team: document.getElementById('epTeam').value.trim() };
    DB.set('veins_profile_' + currentUser.email, data);
    closeModal('modalEditProfile');
    updateProfileDisplay();
}

function deleteAccount() {
    if (!confirm('Вы уверены? Все данные будут потеряны.')) return;
    if (!confirm('Это необратимо! Точно удалить?')) return;
    const email = currentUser.email;
    const users = DB.getUsers();
    delete users[email];
    DB.saveUsers(users);
    DB.remove('veins_notes');
    DB.remove('veins_contacts');
    DB.remove('veins_profile_' + email);
    DB.clearCurrentUser();
    currentUser = null;
    closeModal('modalEditProfile');
    showAuthPage('login');
}

// ===================== NOTES =====================
function getNotes() { return DB.getNotes(currentUser.email); }
function saveNotesArr(notes) { DB.saveNotes(currentUser.email, notes); }

function renderNotes() {
    const container = document.getElementById('notesList');
    const notes = getNotes();
    if (notes.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--text-secondary);font-size:14px;">${tr('noNotes')}</div>`;
        return;
    }
    const today = getTodayStr();
    container.innerHTML = notes.slice().reverse().map(n => {
        const isOverdue = n.deadline && n.deadline < today;
        const noTitle = tr('noTitle');
        const deadlineLabel = tr('deadlineLabel');
        return `<div class="note-card"><div class="note-card-header"><div class="note-card-title">${escapeHtml(n.title) || noTitle}</div><div class="note-card-actions"><button class="btn-edit-note" onclick="editNote('${n.id}')"><i class="fas fa-pen"></i></button><button class="btn-del-note" onclick="deleteNote('${n.id}')"><i class="fas fa-trash"></i></button></div></div><div class="note-card-meta"><span class="note-card-date"><i class="far fa-calendar-alt"></i> ${formatDateDisplay(n.date)}</span><span class="note-priority-badge ${getPriorityClass(n.priority)}">${getPriorityLabel(n.priority)}</span>${n.deadline ? `<span class="${isOverdue ? 'note-deadline overdue' : 'note-deadline'}"><i class="far fa-hourglass"></i> ${deadlineLabel}: ${formatDateDisplay(n.deadline)}${isOverdue ? ' ⚠️' : ''}</span>` : ''}</div>${n.tags && n.tags.length ? `<div class="note-card-tags">${n.tags.map(t => `<span class="note-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}</div>`;
    }).join('');
}

function openNoteModal(noteId = null) {
    editingNoteId = noteId;
    document.getElementById('noteModalTitle').textContent = noteId ? 'Редактировать заметку' : 'Новая заметка';
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteDesc').value = '';
    document.getElementById('noteDate').value = getTodayStr();
    document.getElementById('noteDeadline').value = '';
    document.getElementById('notePriority').value = 'medium';
    if (noteId) {
        const notes = getNotes();
        const note = notes.find(n => n.id === noteId);
        if (note) {
            document.getElementById('noteTitle').value = note.title || '';
            document.getElementById('noteDesc').value = note.content || '';
            document.getElementById('noteDate').value = note.date || getTodayStr();
            document.getElementById('noteDeadline').value = note.deadline || '';
            document.getElementById('notePriority').value = note.priority || 'medium';
        }
    }
    openModal('modalNote');
}

function editNote(id) { openNoteModal(id); }

function saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteDesc').value.trim();
    const noteDate = document.getElementById('noteDate').value || getTodayStr();
    const deadline = document.getElementById('noteDeadline').value;
    const priority = document.getElementById('notePriority').value;
    if (!title && !content) { alert('Заголовок или описание должны быть заполнены'); return; }
    let notes = getNotes();
    if (editingNoteId) {
        const idx = notes.findIndex(n => n.id === editingNoteId);
        if (idx !== -1) notes[idx] = { ...notes[idx], title, content, date: noteDate, deadline, priority };
    } else {
        notes.push({ id: generateId(), title, content, tags: ['#заметка'], date: noteDate, deadline, priority });
    }
    saveNotesArr(notes);
    closeModal('modalNote');
    renderNotes();
    renderCalendar();
    renderSelectedDayNotes();
    renderImportantTasks();
}

function deleteNote(id) {
    if (!confirm('Удалить эту заметку?')) return;
    let notes = getNotes();
    notes = notes.filter(n => n.id !== id);
    saveNotesArr(notes);
    renderNotes();
    renderCalendar();
    renderSelectedDayNotes();
    renderImportantTasks();
}

// ===================== CALENDAR =====================
function renderCalendar() {
    const daysEl = document.getElementById('calDays');
    const monthYear = document.getElementById('calMonthYear');
    const lang = getCurrentLang();
    const months = lang === 'en' ? ['January','February','March','April','May','June','July','August','September','October','November','December'] : ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    monthYear.textContent = `${months[calMonth]} ${calYear}`;
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrev = new Date(calYear, calMonth, 0).getDate();
    const startOff = firstDay === 0 ? 6 : firstDay - 1;
    const prevDays = [];
    for (let i = startOff - 1; i >= 0; i--) prevDays.push(daysInPrev - i);
    const curDays = Array.from({length: daysInMonth}, (_, i) => i + 1);
    const total = prevDays.length + curDays.length;
    const rem = Math.ceil(total / 7) * 7 - total;
    const nextDays = Array.from({length: rem}, (_, i) => i + 1);
    const todayStr = getTodayStr();
    const notes = getNotes();
    const dateInfo = {};
    notes.forEach(n => {
        if (n.date) { if (!dateInfo[n.date]) dateInfo[n.date] = { hasNote: false, hasDeadline: false, hasImportant: false }; dateInfo[n.date].hasNote = true; }
        if (n.deadline) { if (!dateInfo[n.deadline]) dateInfo[n.deadline] = { hasNote: false, hasDeadline: false, hasImportant: false }; dateInfo[n.deadline].hasDeadline = true; }
        if (n.priority === 'high' || n.priority === 'critical') {
            if (n.date) { if (!dateInfo[n.date]) dateInfo[n.date] = { hasNote: false, hasDeadline: false, hasImportant: true }; else dateInfo[n.date].hasImportant = true; }
            if (n.deadline) { if (!dateInfo[n.deadline]) dateInfo[n.deadline] = { hasNote: false, hasDeadline: false, hasImportant: true }; else dateInfo[n.deadline].hasImportant = true; }
        }
    });
    let html = '';
    prevDays.forEach(d => { html += `<div class="cal-day other">${d}</div>`; });
    curDays.forEach(d => {
        const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        let cls = 'cal-day';
        if (ds === todayStr) cls += ' today';
        if (ds === selectedCalDate) cls += ' selected';
        const info = dateInfo[ds];
        let dotsHtml = '';
        if (info) {
            if (info.hasNote) dotsHtml += `<span class="cd-dot d1"></span>`;
            if (info.hasDeadline) dotsHtml += `<span class="cd-dot d2"></span>`;
            if (info.hasImportant) dotsHtml += `<span class="cd-dot d3"></span>`;
        }
        html += `<div class="${cls}" onclick="selectCalDate('${ds}')">${d}${dotsHtml}</div>`;
    });
    nextDays.forEach(d => { html += `<div class="cal-day other">${d}</div>`; });
    daysEl.innerHTML = html;
}

function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }
function selectCalDate(dateStr) { selectedCalDate = dateStr; renderCalendar(); renderSelectedDayNotes(); }

function renderSelectedDayNotes() {
    const container = document.getElementById('calDayNotesList');
    const dateSpan = document.getElementById('calSelectedDate');
    if (!selectedCalDate) selectedCalDate = getTodayStr();
    dateSpan.textContent = formatDateDisplay(selectedCalDate);
    const allNotes = getNotes();
    const notes = allNotes.filter(n => n.date === selectedCalDate || n.deadline === selectedCalDate);
    if (notes.length === 0) { container.innerHTML = '<div class="cal-day-empty">Нет заметок на этот день</div>'; return; }
    const today = getTodayStr();
    container.innerHTML = notes.map(n => {
        const isOverdue = n.deadline && n.deadline < today;
        const isCreated = n.date === selectedCalDate;
        const isDeadlineDate = n.deadline === selectedCalDate;
        let label = '';
        if (isCreated && isDeadlineDate) label = '📌 Создана + дедлайн';
        else if (isDeadlineDate) label = '⏰ Дедлайн';
        else if (isCreated) label = '📅 Создана';
        return `<div class="cal-day-note-item"><div class="note-info"><div class="ntitle">${escapeHtml(n.title) || 'Без названия'} <span class="note-priority-badge ${getPriorityClass(n.priority)}" style="font-size:9px;">${getPriorityLabel(n.priority)}</span></div><div class="nmeta"><span>📆 Создана: ${formatDateDisplay(n.date)}</span>${n.deadline ? `<span class="${isOverdue ? 'overdue' : ''}">⏰ Дедлайн: ${formatDateDisplay(n.deadline)}${isOverdue ? ' ⚠️' : ''}</span>` : ''}${label ? `<span style="font-size:10px;color:var(--primary);">${label}</span>` : ''}</div></div><button onclick="deleteNote('${n.id}')" title="Удалить"><i class="fas fa-times"></i></button></div>`;
    }).join('');
}

function addNoteForSelectedDay() {
    if (!selectedCalDate) selectedCalDate = getTodayStr();
    openNoteModal();
}

// ===================== IMPORTANT TASKS =====================
function renderImportantTasks() {
    const container = document.getElementById('weekPlanList');
    const notes = getNotes();
    const today = getTodayStr();
    const important = notes.filter(n => n.priority === 'high' || n.priority === 'critical').sort((a, b) => { const order = { critical: 0, high: 1 }; return (order[a.priority] || 2) - (order[b.priority] || 2); });
    if (important.length === 0) { container.innerHTML = '<div class="wp-empty">Нет важных задач</div>'; return; }
    container.innerHTML = important.map(n => {
        const isOverdue = n.deadline && n.deadline < today;
        const prioIcon = n.priority === 'critical' ? '🔥' : '🔴';
        const deadlineStr = n.deadline ? `📅 ${formatDateDisplay(n.deadline)}` : '';
        const startStr = `📆 ${formatDateDisplay(n.date)}`;
        return `<div class="wp-task-item"><div class="wp-task-title"><span class="prio-icon">${prioIcon}</span>${escapeHtml(n.title) || 'Без названия'}</div><div class="wp-task-dates"><span>${startStr}</span>${deadlineStr ? `<span class="${isOverdue ? 'overdue' : ''}">${deadlineStr}${isOverdue ? ' ⚠️' : ''}</span>` : ''}</div></div>`;
    }).join('');
}

// ===================== CONTACTS (на главной слева) =====================
function renderContacts() {
    const container = document.getElementById('contactsList');
    const contacts = DB.getContacts(currentUser.email);
    document.getElementById('contactsCount')?.textContent ? document.getElementById('contactsCount').textContent = `Все контакты (${contacts.length})` : null;
    if (contacts.length === 0) { container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">Нет контактов</div>'; return; }
    container.innerHTML = contacts.map(c => `<div class="contact-card"><div class="contact-avatar">${getInitials(c.name)}</div><div class="contact-info"><div class="contact-name">${escapeHtml(c.name)}</div><div class="contact-role">${escapeHtml(c.role)}</div><div class="contact-details"><span>${escapeHtml(c.email)}</span><span>${escapeHtml(c.phone)}</span></div></div><div class="contact-actions"><button class="btn-chat" onclick="openChat('${c.id}')" title="Сообщение"><i class="fas fa-comment"></i></button><button class="btn-call" onclick="openCall('${c.id}')" title="Звонок"><i class="fas fa-phone"></i></button><button class="btn-video" onclick="openVideo('${c.id}')" title="Видеозвонок"><i class="fas fa-video"></i></button><button class="btn-del-contact" onclick="deleteContact('${c.id}')" title="Удалить"><i class="fas fa-trash"></i></button></div></div>`).join('');
}

function openNewContact() { ['ncName','ncPos','ncEmail','ncPhone'].forEach(id => document.getElementById(id).value = ''); openModal('modalNewContact'); }

function saveNewContact() {
    const name = document.getElementById('ncName').value.trim();
    const role = document.getElementById('ncPos').value.trim();
    const email = document.getElementById('ncEmail').value.trim();
    const phone = document.getElementById('ncPhone').value.trim();
    if (!name) { alert('Введите имя'); return; }
    let contacts = DB.getContacts(currentUser.email);
    contacts.push({ id: generateId(), name, role, email, phone });
    DB.saveContacts(currentUser.email, contacts);
    closeModal('modalNewContact');
    renderContacts();
}

function deleteContact(id) {
    if (!confirm('Удалить контакт?')) return;
    let contacts = DB.getContacts(currentUser.email);
    contacts = contacts.filter(c => c.id !== id);
    DB.saveContacts(currentUser.email, contacts);
    renderContacts();
}

function openChat(contactId) {
    const contacts = DB.getContacts(currentUser.email);
    const c = contacts.find(ct => ct.id === contactId);
    if (!c) return;
    currentChatContact = c;
    document.getElementById('chatName').textContent = c.name;
    document.getElementById('chatBody').innerHTML = '';
    document.getElementById('chatInput').value = '';
    openModal('modalChat');
}

function sendChatMsg() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    const body = document.getElementById('chatBody');
    body.innerHTML += `<div class="msg msg-out"><span class="msg-author">Вы</span>${escapeHtml(text)}</div>`;
    input.value = '';
    body.scrollTop = body.scrollHeight;
}

function openCall(contactId) {
    const contacts = DB.getContacts(currentUser.email);
    const c = contacts.find(ct => ct.id === contactId);
    if (!c) return;
    document.getElementById('callName').textContent = c.name;
    openModal('modalCall');
}

function openVideo(contactId) {
    const contacts = DB.getContacts(currentUser.email);
    const c = contacts.find(ct => ct.id === contactId);
    if (!c) return;
    document.getElementById('videoName').textContent = c.name;
    openModal('modalVideo');
}

// ===================== MODALS =====================
function openModal(id) { document.getElementById(id).classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('active'); document.body.style.overflow = ''; }
document.querySelectorAll('.modal-overlay').forEach(el => { el.addEventListener('click', function(e) { if (e.target === this) { this.classList.remove('active'); document.body.style.overflow = ''; } }); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { document.querySelectorAll('.modal-overlay.active').forEach(m => { m.classList.remove('active'); document.body.style.overflow = ''; }); } });

// ===================== LANGUAGE =====================
const translations = {
    ru: {
        sidebarHome: 'Главная', sidebarProfile: 'Личный кабинет', sidebarContacts: 'Контакты', sidebarSettings: 'Настройки',
        topBarWorkspace: 'Рабочее пространство', topBarProfile: 'Личный кабинет', topBarContacts: 'Контакты',
        myNotes: 'Мои заметки', create: 'Создать', importantTasks: 'Важные задачи',
        noNotes: 'У вас пока нет заметок', noImportant: 'Нет важных задач', noContacts: 'Нет контактов',
        addContact: 'Добавить контакт', settings: 'Настройки',
        langLabel: 'Язык интерфейса', themeLabel: 'Тема оформления', notifLabel: 'Уведомления', delBtn: 'Удалить аккаунт',
        allContacts: 'Все контакты', createNote: 'Новая заметка', editNote: 'Редактировать заметку',
        save: 'Сохранить', cancel: 'Отмена', edit: 'Изменить', add: 'Добавить',
        noteOn: 'Заметки на', addNote: 'Добавить', noNotesDay: 'Нет заметок на этот день',
        calendarLegend: ['Есть заметка', 'Есть дедлайн', 'Важная'],
        priorityLabels: { low: '🟢 Низкая', medium: '🟡 Средняя', high: '🔴 Высокая', critical: '🔥 Критичная' },
        profileTitle: 'Личный кабинет',
        noteModalNew: 'Новая заметка', noteModalEdit: 'Редактировать заметку',
        saveBtn: 'Сохранить', cancelBtn: 'Отмена', editBtn: 'Изменить', addBtn: 'Добавить',
        noteTitleLabel: 'Заголовок заметки...', noteDescLabel: 'Описание заметки...',
        noteDateLabel: 'Дата создания', noteDeadlineLabel: 'Дата дедлайна', notePriorityLabel: 'Важность',
        low: '🟢 Низкая', medium: '🟡 Средняя', high: '🔴 Высокая', critical: '🔥 Критичная',
        contactName: 'Имя...', contactRole: 'Должность...', contactEmail: 'Почта...', contactPhone: 'Телефон...',
        deleteAccount: 'Удалить аккаунт', createLabel: 'Создать', addContactLabel: 'Добавить контакт', settingsLink: 'Настройки',
        headerTitle: 'Рабочее пространство', profileEdit: 'Редактирование профиля', chatTitle: 'Чат -', callTitle: 'ЗВОНОК',
        created: 'Создана', deadline: 'Дедлайн', deadlineLabel: 'Дедлайн', createdAndDeadline: 'Создана + дедлайн',
        noTasks: 'Нет важных задач', noNotesDayText: 'Нет заметок на этот день', noTitle: 'Без названия', createdLabel: 'Создана',
        calCreated: '📆 Создана:', calDeadline: '⏰ Дедлайн:', calCreatedDeadline: '📌 Создана + дедлайн',
        calDeadlineOnly: '⏰ Дедлайн', calCreatedOnly: '📅 Создана',
        wpStart: '📆', wpDeadline: '📅', contactChat: 'Чат', contactCall: 'Звонок', contactVideo: 'Видеозвонок',
    },
    en: {
        sidebarHome: 'Home', sidebarProfile: 'Profile', sidebarContacts: 'Contacts', sidebarSettings: 'Settings',
        topBarWorkspace: 'Workspace', topBarProfile: 'Profile', topBarContacts: 'Contacts',
        myNotes: 'My Notes', create: 'Create', importantTasks: 'Important Tasks',
        noNotes: 'You have no notes yet', noImportant: 'No important tasks', noContacts: 'No contacts',
        addContact: 'Add Contact', settings: 'Settings',
        langLabel: 'Interface Language', themeLabel: 'Theme', notifLabel: 'Notifications', delBtn: 'Delete Account',
        allContacts: 'All contacts', createNote: 'New Note', editNote: 'Edit Note',
        save: 'Save', cancel: 'Cancel', edit: 'Edit', add: 'Add',
        noteOn: 'Notes on', addNote: 'Add', noNotesDay: 'No notes on this day',
        calendarLegend: ['Has note', 'Has deadline', 'Important'],
        priorityLabels: { low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High', critical: '🔥 Critical' },
        profileTitle: 'Profile',
        noteModalNew: 'New Note', noteModalEdit: 'Edit Note',
        saveBtn: 'Save', cancelBtn: 'Cancel', editBtn: 'Edit', addBtn: 'Add',
        noteTitleLabel: 'Note title...', noteDescLabel: 'Note description...',
        noteDateLabel: 'Creation date', noteDeadlineLabel: 'Deadline date', notePriorityLabel: 'Priority',
        low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High', critical: '🔥 Critical',
        contactName: 'Name...', contactRole: 'Position...', contactEmail: 'Email...', contactPhone: 'Phone...',
        deleteAccount: 'Delete Account', createLabel: 'Create', addContactLabel: 'Add Contact', settingsLink: 'Settings',
        headerTitle: 'Workspace', profileEdit: 'Edit Profile', chatTitle: 'Chat -', callTitle: 'CALL',
        created: 'Created', deadline: 'Deadline', deadlineLabel: 'Deadline', createdAndDeadline: 'Created + deadline',
        noTasks: 'No important tasks', noNotesDayText: 'No notes on this day', noTitle: 'No title', createdLabel: 'Created',
        calCreated: '📆 Created:', calDeadline: '⏰ Deadline:', calCreatedDeadline: '📌 Created + deadline',
        calDeadlineOnly: '⏰ Deadline', calCreatedOnly: '📅 Created',
        wpStart: '📆', wpDeadline: '📅', contactChat: 'Chat', contactCall: 'Call', contactVideo: 'Video',
    }
};

function applyLanguage() {
    const lang = document.getElementById('langSelect').value;
    DB.set('veins_lang_' + currentUser.email, lang);
    localize(lang);
    renderNotes(); renderCalendar(); renderSelectedDayNotes(); renderImportantTasks(); renderContacts(); updateProfileDisplay();
}

function loadLanguage() {
    const lang = DB.get('veins_lang_' + currentUser.email, 'ru');
    document.getElementById('langSelect').value = lang;
    localize(lang);
}

function localize(lang) {
    const t = translations[lang] || translations.ru;
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    if (navItems.length >= 3) { navItems[0].querySelector('span').textContent = t.sidebarHome; navItems[1].querySelector('span').textContent = t.sidebarProfile; navItems[2].querySelector('span').textContent = t.sidebarContacts; }
    const bottomNav = document.querySelectorAll('.sidebar-bottom .nav-item');
    if (bottomNav.length >= 1) { bottomNav[0].querySelector('span').textContent = t.sidebarSettings; }
    const activePage = document.querySelector('.page-content.active');
    const pageId = activePage?.id?.replace('page-', '');
    const titles = { workspace: t.topBarWorkspace, profile: t.topBarProfile, contacts: t.topBarContacts };
    document.querySelector('.top-bar-title').textContent = titles[pageId] || t.topBarWorkspace;
    document.getElementById('langLabel').textContent = t.langLabel;
    document.getElementById('themeLabel').textContent = t.themeLabel;
    document.getElementById('notifLabel').textContent = t.notifLabel;
    document.getElementById('delBtnLabel').textContent = t.delBtn;
    const sectionHeaders = document.querySelectorAll('.section-title-row h2');
    if (sectionHeaders.length >= 2) { sectionHeaders[0].innerHTML = `<i class="fas fa-file-alt"></i> ${t.myNotes}`; sectionHeaders[1].innerHTML = `<i class="fas fa-tasks"></i> ${t.importantTasks}`; }
    document.querySelectorAll('.section-title-row .btn-primary').forEach(btn => { btn.innerHTML = `<i class="fas fa-plus"></i> ${t.createLabel}`; });
    const legendSpans = document.querySelectorAll('.cal-legend span');
    if (legendSpans.length >= 3) { legendSpans[0].innerHTML = `<span class="legend-dot dot-default"></span> ${t.calendarLegend[0]}`; legendSpans[1].innerHTML = `<span class="legend-dot dot-deadline"></span> ${t.calendarLegend[1]}`; legendSpans[2].innerHTML = `<span class="legend-dot dot-important"></span> ${t.calendarLegend[2]}`; }
    const profileHeader = document.querySelector('#page-profile .content-header h1');
    if (profileHeader) profileHeader.innerHTML = `<i class="fas fa-user-circle"></i> ${t.profileTitle}`;
    // Update calendar notes header
    const calNotesHeader = document.querySelector('.calendar-day-notes h3');
    if (calNotesHeader) { const dateSpan = document.getElementById('calSelectedDate'); const dateText = dateSpan ? dateSpan.textContent : ''; calNotesHeader.innerHTML = `${t.noteOn} <span id="calSelectedDate">${dateText}</span>`; }
    const addNoteBtn = document.querySelector('.calendar-day-notes .btn-primary');
    if (addNoteBtn) addNoteBtn.innerHTML = `<i class="fas fa-plus"></i> ${t.addNote}`;
    // Profile edit form labels
    var epNameLabel = document.querySelector('#editProfileForm .form-group:nth-child(1) label');
    var epEmailLabel = document.querySelector('#editProfileForm .form-group:nth-child(2) label');
    var epPhoneLabel = document.querySelector('#editProfileForm .form-group:nth-child(3) label');
    var epBirthLabel = document.querySelector('#editProfileForm .form-group:nth-child(4) label');
    var epPositionLabel = document.querySelector('#editProfileForm .form-group:nth-child(5) label');
    var epCityLabel = document.querySelector('#editProfileForm .form-group:nth-child(6) label');
    var epTeamLabel = document.querySelector('#editProfileForm .form-group:nth-child(7) label');
    if (epNameLabel) epNameLabel.textContent = 'Имя...';
    if (epEmailLabel) epEmailLabel.textContent = 'Почта...';
    if (epPhoneLabel) epPhoneLabel.textContent = 'Телефон...';
    if (epBirthLabel) epBirthLabel.textContent = 'Дата рождения...';
    if (epPositionLabel) epPositionLabel.textContent = 'Должность...';
    if (epCityLabel) epCityLabel.textContent = 'Город...';
    if (epTeamLabel) epTeamLabel.textContent = 'Команда...';
}

// ===================== BOOTSTRAP =====================
(function bootstrap() {
    calMonth = 4; calYear = 2026;
    selectedCalDate = getTodayStr();
    const saved = DB.getCurrentUser();
    if (saved) { currentUser = saved; initApp(); }
    else { showAuthPage('login'); }
})();