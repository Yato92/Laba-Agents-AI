// ============================================================
//  Vein's Notes — Сервер + VK Bot + Ollama API
//  Стек: Node.js + Express + SQLite + bcrypt + VK-IO
// ============================================================

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

// ===================== VK БОТ =====================
let vkBot = null;
let vkNotify = null;
let vkNotes = null;

try {
    const vkModule = require('./vk-bot');
    vkBot = vkModule.startBot;
    vkNotify = vkModule.notifyVKUser;
    vkNotes = vkModule.loadNotes;
} catch (e) {
    console.log('⚠️ VK-бот не подключен (vk-io может быть не установлен):', e.message);
}

// ===================== МИДЛВАРЫ =====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===================== ПОДКЛЮЧЕНИЕ К БД =====================
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err.message);
    } else {
        console.log('✅ Подключено к SQLite БД.');
    }
});

// ===================== МИГРАЦИИ =====================
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            vk_id TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT DEFAULT '',
            date TEXT NOT NULL,
            deadline TEXT,
            priority TEXT DEFAULT 'medium',
            tags TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS vk_users (
            vk_id INTEGER PRIMARY KEY,
            user_email TEXT,
            first_name TEXT,
            last_name TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    console.log('✅ Таблицы готовы.');
});

// ===================== ВАЛИДАЦИЯ =====================
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ===================== РЕГИСТРАЦИЯ =====================
app.post('/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        if (!email || !name || !password) {
            return res.status(400).json({ success: false, error: 'Все поля обязательны: email, name, password' });
        }
        const normalizedEmail = email.trim().toLowerCase();
        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ success: false, error: 'Невалидный email' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Пароль должен быть минимум 6 символов' });
        }

        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (existingUser) {
            return res.status(409).json({ success: false, error: 'Пользователь с таким email уже существует' });
        }

        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
                [normalizedEmail, name.trim(), password_hash],
                function (err) { if (err) reject(err); else resolve(this); }
            );
        });

        res.status(201).json({
            success: true,
            user: { id: result.lastID, email: normalizedEmail, name: name.trim() }
        });
    } catch (err) {
        console.error('❌ Ошибка регистрации:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ===================== ЛОГИН (проверка пароля) =====================
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email и пароль обязательны' });
        }
        const normalizedEmail = email.trim().toLowerCase();
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, error: 'Неверный пароль' });
        }
        res.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name, vk_id: user.vk_id }
        });
    } catch (err) {
        console.error('❌ Ошибка логина:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ===================== ПРИВЯЗКА VK ID К ПОЛЬЗОВАТЕЛЮ =====================
app.post('/api/link-vk', async (req, res) => {
    try {
        const { email, vk_id } = req.body;
        if (!email || !vk_id) {
            return res.status(400).json({ success: false, error: 'email и vk_id обязательны' });
        }
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET vk_id = ? WHERE email = ?', [String(vk_id), email], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        // Также сохраняем в таблицу vk_users
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT OR REPLACE INTO vk_users (vk_id, user_email) VALUES (?, ?)',
                [parseInt(vk_id), email],
                (err) => { if (err) reject(err); else resolve(); }
            );
        });
        res.json({ success: true, message: 'VK ID привязан' });
    } catch (err) {
        console.error('❌ Ошибка привязки VK:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ===================== API ЗАМЕТОК =====================

// Получить все заметки пользователя
app.get('/api/notes', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ success: false, error: 'email обязателен' });
        const notes = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM notes WHERE user_email = ? ORDER BY created_at DESC', [email], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })));
            });
        });
        res.json({ success: true, notes });
    } catch (err) {
        console.error('❌ Ошибка получения заметок:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Создать заметку
app.post('/api/notes', async (req, res) => {
    try {
        const { email, title, content, date, deadline, priority, tags } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'email обязателен' });

        const noteId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        const noteDate = date || new Date().toISOString().split('T')[0];
        const tagStr = JSON.stringify(tags || []);

        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO notes (id, user_email, title, content, date, deadline, priority, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [noteId, email, title || '', content || '', noteDate, deadline || '', priority || 'medium', tagStr],
                function (err) { if (err) reject(err); else resolve(); }
            );
        });

        const note = { id: noteId, user_email: email, title, content, date: noteDate, deadline, priority, tags: tags || [] };
        
        // Уведомление в VK через прямой API вызов
        try {
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT vk_id FROM users WHERE email = ?', [email], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            if (user && user.vk_id) {
                const vkToken = process.env.VK_TOKEN;
                const emojiMap = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
                let msg = `✅ Новая заметка!\n\n${emojiMap[note.priority] || '📝'} ${note.title || 'Без названия'}`;
                if (note.deadline) msg += `\n⏰ Дедлайн: ${note.deadline}`;
                msg += `\n\n🌐 http://localhost:${PORT}`;
                
                fetch(`https://api.vk.com/method/messages.send?user_id=${user.vk_id}&message=${encodeURIComponent(msg)}&random_id=${Date.now()}&access_token=${vkToken}&v=5.199`)
                    .catch(e => console.log('VK notify unavailable:', e.message));
            }
        } catch (e) {
            console.error('VK notify error:', e.message);
        }

        res.status(201).json({ success: true, note });
    } catch (err) {
        console.error('❌ Ошибка создания заметки:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Обновить заметку
app.put('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, date, deadline, priority, tags } = req.body;
        const tagStr = tags ? JSON.stringify(tags) : undefined;
        
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE notes SET 
                    title = COALESCE(?, title),
                    content = COALESCE(?, content),
                    date = COALESCE(?, date),
                    deadline = COALESCE(?, deadline),
                    priority = COALESCE(?, priority),
                    tags = COALESCE(?, tags),
                    updated_at = datetime('now')
                WHERE id = ?`,
                [title, content, date, deadline, priority, tagStr, id],
                function (err) { if (err) reject(err); else resolve(); }
            );
        });
        res.json({ success: true, message: 'Заметка обновлена' });
    } catch (err) {
        console.error('❌ Ошибка обновления заметки:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Удалить заметку
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM notes WHERE id = ?', [id], function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true, message: 'Заметка удалена' });
    } catch (err) {
        console.error('❌ Ошибка удаления заметки:', err);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ===================== OLLAMA API (ИИ-ассистент) =====================
app.post('/api/ollama', async (req, res) => {
    try {
        const { prompt, context } = req.body;
        if (!prompt) return res.status(400).json({ success: false, error: 'prompt обязателен' });

        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';

        // Формируем промпт с контекстом
        const systemPrompt = `Ты — дружелюбный и полезный ИИ-ассистент Vein's Notes. Твоя задача — помогать пользователю управлять его заметками.

ФУНКЦИИ:
1. Если пользователь ПРОСИТ СОЗДАТЬ ЗАМЕТКУ — напиши "#CREATE_NOTE" и после него JSON с полями: title, description, deadline (YYYY-MM-DD), importance (low/medium/high/critical).
   Пример: "Создай заметку купить подарок, дедлайн 25.12.2026, важно"
   Ответ: "Хорошо! #CREATE_NOTE {"title": "Купить подарок", "description": "Купить подарок на день рождения", "deadline": "2026-12-25", "importance": "high"} Заметка создана! 🎉"

2. Если пользователь ПРОСИТ ОТКРЫТЬ СТРАНИЦУ или ПЕРЕЙТИ куда-то — напиши "#NAVIGATE" и название страницы: workspace (главная/рабочее пространство), profile (личный кабинет), contacts (контакты).
   Пример: "Открой профиль" → "#NAVIGATE profile" или "Покажи контакты" → "#NAVIGATE contacts"
   Доступные страницы: workspace (главная), profile (личный кабинет/профиль), contacts (контакты)
   
3. Если пользователь просто общается — отвечай дружелюбно, помогай с вопросами, давай советы по организации задач.

4. Если информации для создания заметки не хватает — вежливо спроси: "Уточните заголовок", "Какой дедлайн?", "Какая важность?"

Будь вежливым, используй эмодзи, говори кратко и по делу. На сайте тебя открывают через чат-виджет справа снизу.`;

        const fullPrompt = context
            ? `${systemPrompt}\n\nКонтекст:\n${context}\n\nВопрос пользователя: ${prompt}`
            : `${systemPrompt}\n\nВопрос пользователя: ${prompt}`;

        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    top_p: 0.9
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama HTTP error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.response || '';
        
        // Парсим #CREATE_NOTE для создания заметки
        let noteCreated = null;
        const createNoteMatch = aiResponse.match(/#CREATE_NOTE\s*(\{.*?\})/s);
        if (createNoteMatch) {
            try {
                const noteData = JSON.parse(createNoteMatch[1]);
                // Извлекаем email из контекста
                let userEmail = 'ai@vein.notes';
                if (context) {
                    const emailMatch = context.match(/email:\s*([^\s,]+)/i);
                    if (emailMatch) userEmail = emailMatch[1];
                }
                
                console.log(`📝 AI создаёт заметку для ${userEmail}: "${noteData.title}"`);
                
                const noteId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
                const noteDate = new Date().toISOString().split('T')[0];
                const tagStr = JSON.stringify(['#ai', '#auto']);
                
                await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT INTO notes (id, user_email, title, content, date, deadline, priority, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [noteId, userEmail, noteData.title || 'Заметка от AI', noteData.description || '', noteDate, noteData.deadline || '', noteData.importance || 'medium', tagStr],
                        function (err) { if (err) reject(err); else resolve(); }
                    );
                });
                
                noteCreated = {
                    id: noteId,
                    title: noteData.title,
                    description: noteData.description,
                    deadline: noteData.deadline,
                    importance: noteData.importance,
                    date: noteDate
                };
                console.log(`✅ AI создал заметку: "${noteData.title}" (дедлайн: ${noteData.deadline || 'нет'})`);
            } catch (e) {
                console.error('❌ Ошибка парсинга #CREATE_NOTE:', e.message);
            }
        }
        
        // Очищаем ответ от технических тегов для пользователя
        let cleanResponse = aiResponse.replace(/#CREATE_NOTE\s*\{.*?\}/s, '').trim();
        
        res.json({ 
            success: true, 
            response: cleanResponse || aiResponse,
            note_created: !!noteCreated,
            note: noteCreated
        });
    } catch (err) {
        console.error('❌ Ошибка Ollama:', err.message);
        res.json({ success: false, error: 'Ollama недоступна. Убедитесь, что она запущена (ollama serve)', response: null, note_created: false, note: null });
    }
});

// ===================== ОТПРАВКА УВЕДОМЛЕНИЯ В VK =====================
app.post('/api/notify-vk', async (req, res) => {
    try {
        const { vk_id, note, action } = req.body;
        if (!vk_id || !note) return res.status(400).json({ success: false, error: 'vk_id и note обязательны' });
        
        const token = process.env.VK_TOKEN;
        if (!token) return res.status(400).json({ success: false, error: 'VK_TOKEN не настроен' });
        
        const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
        let msg = action === 'created'
            ? `✅ Новая заметка создана!\n\n${emoji[note.importance || note.priority] || '📝'} ${note.title || 'Без названия'}`
            : `🔄 Заметка обновлена: ${note.title || 'Без названия'}`;
        
        if (note.deadline) msg += `\n⏰ Дедлайн: ${note.deadline}`;
        if (note.description) msg += `\n📄 ${note.description.substring(0, 100)}`;
        msg += `\n\n🌐 Подробнее: http://localhost:${PORT}`;
        
        const vkRes = await fetch(`https://api.vk.com/method/messages.send?user_id=${vk_id}&message=${encodeURIComponent(msg)}&random_id=${Date.now()}&access_token=${token}&v=5.199`);
        const vkData = await vkRes.json();
        
        console.log(`📨 VK notify sent to ${vk_id}:`, vkData);
        
        if (vkData.error && vkData.error.error_code === 7) {
            // Ошибка "Permission denied" — нужно, чтобы пользователь написал боту первым
            console.log(`⚠️ Пользователь ${vk_id} не разрешил сообщения. Нужно написать боту в ЛС.`);
            return res.json({ 
                success: false, 
                error: 'user_not_initiated', 
                message: 'Для получения уведомлений напишите боту в ВК: https://vk.me/club238851353' 
            });
        }
        
        if (vkData.error) {
            console.error('VK API error:', vkData.error);
            return res.json({ success: false, error: vkData.error.error_msg || 'VK API error' });
        }
        
        res.json({ success: true, response: vkData.response });
    } catch (e) {
        console.error('VK notify error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ===================== ПОЛУЧИТЬ ПОЛЬЗОВАТЕЛЕЙ =====================
app.get('/users', (req, res) => {
    db.all('SELECT id, email, name, vk_id FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
        res.json(rows);
    });
});

// ===================== VK CALLBACK API =====================
app.post('/vk-callback', express.json(), (req, res) => {
    const data = req.body;
    const secretKey = process.env.VK_SECRET_KEY || '';
    const confirmationCode = process.env.VK_CONFIRMATION_CODE || '';
    
    if (data.type === 'confirmation') {
        return res.send(confirmationCode);
    }
    
    if (data.type === 'message_new') {
        const msg = data.object.message;
        const userId = msg.from_id;
        const text = msg.text || '';
        
        // Отвечаем пользователю
        handleVkMessage(userId, text);
    }
    
    res.send('ok');
});

async function handleVkMessage(userId, text) {
    try {
        const vkModule = require('./vk-bot');
        // Отправляем ответ через VK API напрямую
        const fetch = require('node-fetch') || globalThis.fetch;
        const token = process.env.VK_TOKEN;
        if (!token) return;
        
        // Проверяем команды
        const lower = text.toLowerCase();
        if (lower === '/start' || lower === '/help' || lower === 'помощь') {
            await fetch(`https://api.vk.com/method/messages.send?user_id=${userId}&message=${encodeURIComponent('🤖 Vein\'s Notes Bot\n\n📝 Напишите "создай заметку [описание]" чтобы создать заметку\n📋 "мои заметки" — список\n⏰ "дедлайны" — сроки\n🌐 Зайдите на сайт для полного функционала')}&random_id=${Date.now()}&access_token=${token}&v=5.199`, { method: 'GET' });
            return;
        }
        
        // Отправляем в AI через наш сервер
        const ollamaRes = await fetch(`http://localhost:${PORT}/api/ollama`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt: text, 
                context: `Пользователь VK ID: ${userId}. Приветствуй его дружелюбно.`
            })
        });
        const data = await ollamaRes.json();
        const reply = data.response || '🤖 Привет! Я ИИ-ассистент. Напиши "создай заметку" или задай вопрос.';
        
        await fetch(`https://api.vk.com/method/messages.send?user_id=${userId}&message=${encodeURIComponent(reply.substring(0, 4000))}&random_id=${Date.now()}&access_token=${token}&v=5.199`, { method: 'GET' });
    } catch (e) {
        console.error('VK callback error:', e.message);
    }
}

// ===================== VK OAuth =====================
app.get('/api/vk-oauth-url', (req, res) => {
    const clientId = process.env.VK_APP_ID || '51661919'; // ID приложения VK
    const redirectUri = `${req.protocol}://${req.get('host')}/api/vk-oauth-callback`;
    const url = `https://id.vk.com/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&v=5.199&scope=email`;
    res.json({ url });
});

app.get('/api/vk-oauth-callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.redirect('/?error=no_code');
        
        // Получаем токен
        const clientId = process.env.VK_APP_ID || '51661919';
        const clientSecret = process.env.VK_CLIENT_SECRET || '';
        const redirectUri = `${req.protocol}://${req.get('host')}/api/vk-oauth-callback`;
        
        const tokenRes = await fetch('https://oauth.vk.com/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: redirectUri
            })
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.access_token) {
            // Получаем данные пользователя
            const userRes = await fetch(`https://api.vk.com/method/users.get?user_ids=${tokenData.user_id}&fields=first_name,last_name,photo_200&access_token=${tokenData.access_token}&v=5.199`);
            const userData = await userRes.json();
            const user = userData.response?.[0] || {};
            
            const vkId = String(tokenData.user_id);
            const email = tokenData.email || `vk_${vkId}@vk.user`;
            const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || `VK User ${vkId}`;
            
            // Сохраняем в users
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR REPLACE INTO users (email, name, password_hash, vk_id) VALUES (?, ?, ?, ?)',
                    [email, name, 'vk_oauth_' + vkId, vkId],
                    function (err) { if (err) reject(err); else resolve(); }
                );
            });
            
            // Сохраняем в vk_users
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR REPLACE INTO vk_users (vk_id, user_email, first_name, last_name) VALUES (?, ?, ?, ?)',
                    [parseInt(vkId), email, user.first_name || '', user.last_name || ''],
                    function (err) { if (err) reject(err); else resolve(); }
                );
            });
            
            // Редиректим обратно на сайт с данными
            res.redirect(`/?vk_auth=${encodeURIComponent(JSON.stringify({ email, name, vkId }))}`);
        } else {
            res.redirect('/?error=auth_failed');
        }
    } catch (e) {
        console.error('VK OAuth error:', e.message);
        res.redirect('/?error=server_error');
    }
});

// ===================== CRON: ПРОВЕРКА ДЕДЛАЙНОВ =====================
app.get('/cron/check-deadlines', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const token = process.env.VK_TOKEN;
        
        // Находим все заметки с дедлайном сегодня или завтра
        const notesDue = await new Promise((resolve, reject) => {
            db.all('SELECT n.*, u.vk_id FROM notes n JOIN users u ON u.email = n.user_email WHERE (n.deadline = ? OR n.deadline = ?) AND u.vk_id IS NOT NULL',
                [today, tomorrow],
                (err, rows) => { if (err) reject(err); else resolve(rows); }
            );
        });
        
        let sent = 0;
        for (const note of notesDue) {
            const isToday = note.deadline === today;
            const msg = isToday 
                ? `⚠️ ДЕДЛАЙН СЕГОДНЯ!\n\n📌 "${note.title}"\n⏰ Дедлайн: ${note.deadline}`
                : `⏰ Напоминание!\n\n📌 "${note.title}"\n📅 Дедлайн ЗАВТРА: ${note.deadline}`;
            
            try {
                const vkRes = await fetch(`https://api.vk.com/method/messages.send?user_id=${note.vk_id}&message=${encodeURIComponent(msg)}&random_id=${Date.now()}&access_token=${token}&v=5.199`);
                const vkData = await vkRes.json();
                if (vkData.response) sent++;
            } catch (e) {
                console.error('Cron VK send error:', e.message);
            }
        }
        
        res.json({ success: true, sent, total: notesDue.length });
    } catch (e) {
        console.error('Cron error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ===================== ЗАПУСК =====================
app.listen(PORT, () => {
    console.log(`============================================`);
    console.log(`  🚀 Vein's Notes Server запущен!`);
    console.log(`  📍 http://localhost:${PORT}`);
    console.log(`  📝 API: POST http://localhost:${PORT}/api/notes`);
    console.log(`  🤖 Ollama: POST http://localhost:${PORT}/api/ollama`);
    console.log(`  👥 Users: GET http://localhost:${PORT}/users`);
    console.log(`  🔄 VK OAuth: GET http://localhost:${PORT}/api/vk-oauth-url`);
    console.log(`  ⏰ Cron: GET http://localhost:${PORT}/cron/check-deadlines`);
    console.log(`  📞 VK Callback: POST http://localhost:${PORT}/vk-callback`);
    console.log(`============================================`);

    // Запускаем VK бота
    if (vkBot) {
        try {
            vkBot().catch(e => console.error('❌ Ошибка VK бота:', e.message));
        } catch (e) {
            console.log('⚠️ VK-бот не запущен (установите vk-io: npm install vk-io)');
        }
    } else {
        console.log('⚠️ VK-бот не запущен (установите vk-io: npm install vk-io)');
    }
});