// ============================================================
//  Vein's Notes — VK Bot (чистый HTTP API, без vk-io)
//  Функции: отправка уведомлений, напоминания о дедлайнах
//  Получение сообщений — через Callback API в server.js
// ============================================================

const path = require('path');
const fs = require('fs');
require('dotenv').config();

const VK_TOKEN = process.env.VK_TOKEN;
const VK_API_VERSION = '5.199';
const GROUP_ID = parseInt(process.env.VK_GROUP_ID || '0', 10);

// ===================== ОТПРАВКА СООБЩЕНИЯ В VK =====================
async function sendVkMessage(userId, message, keyboard = null) {
    if (!VK_TOKEN) {
        console.error('❌ VK_TOKEN не настроен');
        return { error: 'no_token' };
    }
    try {
        const params = new URLSearchParams({
            user_id: userId,
            random_id: Math.floor(Math.random() * 2147483647),
            message: message.substring(0, 4096),
            access_token: VK_TOKEN,
            v: VK_API_VERSION
        });
        if (keyboard) params.append('keyboard', JSON.stringify(keyboard));
        
        const res = await fetch(`https://api.vk.com/method/messages.send?${params.toString()}`);
        const data = await res.json();
        
        if (data.error) {
            if (data.error.error_code === 7) {
                console.log(`⚠️ Нет доступа писать пользователю ${userId} — пусть напишет боту первым: https://vk.me/club${GROUP_ID}`);
            } else if (data.error.error_code === 902) {
                console.error(`❌ VK_TOKEN невалидный! Перевыпустите ключ доступа.`);
            } else if (data.error.error_code === 900) {
                console.log(`⛔ Пользователь ${userId} запретил сообщения (в чёрном списке).`);
            } else {
                console.error(`❌ VK API error (${data.error.error_code}): ${data.error.error_msg}`);
            }
            return data;
        }
        console.log(`📨 VK: сообщение отправлено пользователю ${userId} (message_id: ${data.response})`);
        return data;
    } catch (e) {
        console.error(`❌ VK send error:`, e.message);
        return { error: e.message };
    }
}

// ===================== УВЕДОМЛЕНИЕ О НОВОЙ ЗАМЕТКЕ =====================
async function notifyVKUser(userVkId, note, action = 'created') {
    try {
        const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
        const importance = note.importance || note.priority || 'medium';
        let msg = action === 'completed'
            ? `✅ *Задача выполнена!*\n\n🎉 ${note.title || note.description || 'Без названия'}`
            : action === 'created'
                ? `━━━━━━━━━━━━━━━━\n✅ *Новая заметка!*\n\n${emoji[importance] || '📝'} ${note.title || note.description || 'Без названия'}`
                : `🔄 *Заметка обновлена:* ${note.title || note.description || 'Без названия'}`;
        
        if (note.deadline) msg += `\n⏰ Дедлайн: ${note.deadline}`;
        if (note.description) msg += `\n📄 ${note.description.substring(0, 100)}`;
        msg += `\n━━━━━━━━━━━━━━━━`;
        msg += `\n🌐 Сайт: http://localhost:3000`;
        
        const result = await sendVkMessage(userVkId, msg);
        if (result.response) {
            console.log(`📨 Уведомление отправлено ${userVkId} (${note.title || note.description})`);
            return true;
        }
        return false;
    } catch (e) {
        console.error(`Ошибка уведомления ВК ${userVkId}:`, e.message);
        return false;
    }
}

// ===================== НАПОМИНАНИЯ О ДЕДЛАЙНАХ (из SQLite БД) =====================
async function checkDeadlinesAndNotify(db) {
    if (!VK_TOKEN || !db) {
        console.log('⏰ Пропуск проверки дедлайнов (нет токена или БД).');
        return { sent: 0, total: 0 };
    }
    try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        
        const notesDue = await new Promise((resolve, reject) => {
            db.all(
                `SELECT n.*, u.vk_id FROM notes n 
                 JOIN users u ON u.email = n.user_email 
                 WHERE (n.deadline = ? OR n.deadline = ?) AND u.vk_id IS NOT NULL`,
                [today, tomorrow],
                (err, rows) => { if (err) reject(err); else resolve(rows); }
            );
        });
        
        let sent = 0;
        for (const note of notesDue) {
            const isToday = note.deadline === today;
            const msg = isToday
                ? `⚠️ *ДЕДЛАЙН СЕГОДНЯ!*\n\n📌 "${note.title}"\n⏰ Дедлайн: ${note.deadline}\n\n🔥 Не забудьте завершить задачу!`
                : `⏰ *Напоминание!*\n\n📌 "${note.title}"\n📅 Дедлайн ЗАВТРА: ${note.deadline}\n\n⏳ Остался 1 день!`;
            
            try {
                const result = await sendVkMessage(note.vk_id, msg);
                if (result.response) sent++;
            } catch (e) {
                console.error(`Cron VK error для ${note.vk_id}:`, e.message);
            }
        }
        
        if (notesDue.length > 0) {
            console.log(`⏰ Проверка дедлайнов: ${sent}/${notesDue.length} уведомлений отправлено`);
        }
        return { sent, total: notesDue.length };
    } catch (e) {
        console.error('❌ Ошибка проверки дедлайнов:', e.message);
        return { sent: 0, total: 0, error: e.message };
    }
}

// ===================== ОБРАБОТКА СООБЩЕНИЯ ИЗ VK =====================
async function handleVkMessage(userId, text, db) {
    if (!text || text.length < 2) return;
    
    const lower = text.toLowerCase().trim();
    
    // Помощь
    if (lower === '/help' || lower === 'помощь' || lower === 'help' || lower === '/start' || lower === 'начать') {
        return sendVkMessage(userId,
            `👋 *Привет! Я Vein's Notes Bot!*\n\n` +
            `📝 *Создать заметку:* просто напишите текст\n` +
            `  — 🔴 /важно, 🔥 /крит, 🟢 /низк\n` +
            `  — "дедлайн 25.12.2026"\n` +
            `  — #теги для категорий\n\n` +
            `📋 */notes* — мои заметки\n` +
            `⏰ */deadlines* — дедлайны\n` +
            `❌ */del <id>* — удалить\n` +
            `🤖 */ai <вопрос>* — спросить ИИ\n` +
            `🌐 http://localhost:3000 — сайт\n\n` +
            `💡 *Важно:* Привяжите VK ID в личном кабинете на сайте для уведомлений!`
        );
    }
    
    // Команды
    const args = text.split(/\s+/);
    const command = args[0].toLowerCase();
    
    switch (command) {
        case '/notes':
        case '/заметки':
        case '/list': {
            if (!db) return sendVkMessage(userId, '⚠️ База данных недоступна.');
            try {
                const email = `vk_${userId}@vk.user`;
                const notes = await new Promise((resolve, reject) => {
                    db.all('SELECT * FROM notes WHERE user_email = ? ORDER BY created_at DESC LIMIT 10', [email], (err, rows) => {
                        if (err) reject(err); else resolve(rows);
                    });
                });
                if (!notes.length) return sendVkMessage(userId, '📭 У вас нет заметок.\n\n📝 Напишите любой текст, чтобы создать заметку!');
                let msg = `📋 *Ваши заметки (${notes.length}):*\n\n`;
                notes.forEach((n, i) => {
                    const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
                    msg += `${i + 1}. ${emoji[n.priority] || '📝'} ${n.title.substring(0, 35)}`;
                    if (n.deadline) msg += ` (⏰ ${n.deadline})`;
                    msg += `\n   ID: ${n.id}\n`;
                });
                return sendVkMessage(userId, msg);
            } catch (e) { return sendVkMessage(userId, '❌ Ошибка получения заметок.'); }
        }
        
        case '/deadlines':
        case '/дедлайны': {
            if (!db) return sendVkMessage(userId, '⚠️ База данных недоступна.');
            try {
                const email = `vk_${userId}@vk.user`;
                const notes = await new Promise((resolve, reject) => {
                    db.all("SELECT * FROM notes WHERE user_email = ? AND deadline != '' ORDER BY deadline ASC", [email], (err, rows) => {
                        if (err) reject(err); else resolve(rows);
                    });
                });
                if (!notes.length) return sendVkMessage(userId, '✅ Нет задач с дедлайнами.');
                const today = new Date().toISOString().split('T')[0];
                let msg = `⏰ *Дедлайны:*\n\n`;
                notes.forEach((n, i) => {
                    const icon = n.deadline < today ? '⚠️' : n.deadline === today ? '🔴' : '📅';
                    msg += `${i + 1}. ${icon} ${n.title.substring(0, 30)} — ${n.deadline}\n`;
                });
                return sendVkMessage(userId, msg);
            } catch (e) { return sendVkMessage(userId, '❌ Ошибка получения дедлайнов.'); }
        }
        
        case '/del':
        case '/delete':
        case '/удалить': {
            const noteId = args[1];
            if (!noteId) return sendVkMessage(userId, '❌ Укажите ID: /del <id>');
            if (!db) return sendVkMessage(userId, '⚠️ База данных недоступна.');
            try {
                const email = `vk_${userId}@vk.user`;
                await new Promise((resolve, reject) => {
                    db.run('DELETE FROM notes WHERE id = ? AND user_email = ?', [noteId, email], function(err) {
                        if (err) reject(err); else resolve();
                    });
                });
                return sendVkMessage(userId, '✅ Заметка удалена.');
            } catch (e) { return sendVkMessage(userId, '❌ Ошибка удаления.'); }
        }
        
        case '/ai':
        case '/ask':
        case '/спросить': {
            const question = text.substring(command.length).trim();
            if (!question) return sendVkMessage(userId, '❓ Напишите вопрос: /ai Как дела?');
            try {
                sendVkMessage(userId, '🤖 Думаю...');
                const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
                const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';
                const res = await fetch(`${ollamaUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: ollamaModel,
                        prompt: `Ты — ассистент Vein's Notes. Ответь кратко и дружелюбно. Вопрос: ${question}`,
                        stream: false,
                        options: { temperature: 0.7, num_predict: 200 }
                    })
                });
                const data = await res.json();
                if (data.response) {
                    const answer = data.response.trim().substring(0, 4000);
                    return sendVkMessage(userId, answer);
                }
                return sendVkMessage(userId, '🤖 Не удалось получить ответ от ИИ.');
            } catch (e) {
                return sendVkMessage(userId, '🤖 ИИ недоступен. Проверьте, запущена ли Ollama (`ollama serve`).');
            }
        }
        
        default:
            // Создаём заметку из текста
            if (text.length > 2 && db) {
                try {
                    const email = `vk_${userId}@vk.user`;
                    // Простой парсинг
                    let priority = 'medium';
                    if (lower.includes('/крит') || lower.includes('🔥')) priority = 'critical';
                    else if (lower.includes('/важно') || lower.includes('🔴')) priority = 'high';
                    else if (lower.includes('/низк') || lower.includes('🟢')) priority = 'low';
                    
                    let title = text.replace(/\/[критважнонизк]+/g, '').replace(/[🔥🔴🟡🟢]/g, '').trim().substring(0, 100);
                    if (!title) title = 'Заметка из ВК';
                    
                    const deadMatch = text.match(/дедлайн[:\s]*(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?/i);
                    let deadline = '';
                    if (deadMatch) {
                        const d = deadMatch[1].padStart(2, '0');
                        const m = deadMatch[2].padStart(2, '0');
                        const y = deadMatch[3] || new Date().getFullYear();
                        deadline = `${y}-${m}-${d}`;
                    }
                    
                    const tags = (text.match(/#\w+/g) || []).map(t => t.toLowerCase());
                    const noteId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
                    const today = new Date().toISOString().split('T')[0];
                    
                    // Сохраняем пользователя если нет
                    await new Promise((resolve, reject) => {
                        db.run('INSERT OR IGNORE INTO users (email, name, password_hash, vk_id) VALUES (?, ?, ?, ?)',
                            [email, `VK User ${userId}`, 'vk_auto', String(userId)],
                            (err) => { if (err) reject(err); else resolve(); }
                        );
                    }).catch(() => {});
                    
                    await new Promise((resolve, reject) => {
                        db.run(
                            'INSERT INTO notes (id, user_email, title, content, date, deadline, priority, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            [noteId, email, title, title, today, deadline, priority, JSON.stringify(tags)],
                            (err) => { if (err) reject(err); else resolve(); }
                        );
                    });
                    
                    let msg = `✅ *Заметка создана!*\n\n`;
                    const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
                    msg += `${emoji[priority]} ${title}\n`;
                    if (deadline) msg += `⏰ Дедлайн: ${deadline}\n`;
                    if (tags.length) msg += `🏷️ ${tags.join(' ')}\n`;
                    msg += `\n❌ Удалить: /del ${noteId}`;
                    
                    return sendVkMessage(userId, msg);
                } catch (e) {
                    console.error('VK create note error:', e.message);
                    return sendVkMessage(userId, '❌ Ошибка создания заметки.');
                }
            } else if (text.length > 2 && !db) {
                return sendVkMessage(userId, '⚠️ База данных недоступна. Запустите сервер (`npm start`).');
            }
    }
}

// ===================== ПРОВЕРКА ТОКЕНА =====================
async function checkToken() {
    if (!VK_TOKEN) {
        console.error('❌ VK_TOKEN не найден в .env!');
        return false;
    }
    try {
        const res = await fetch(`https://api.vk.com/method/groups.getById?group_id=${GROUP_ID}&access_token=${VK_TOKEN}&v=${VK_API_VERSION}`);
        const data = await res.json();
        if (data.error) {
            if (data.error.error_code === 5) {
                console.error('❌ VK_TOKEN недействителен (ошибка авторизации)! Перевыпустите ключ.');
            } else {
                console.error(`❌ VK API error при проверке: ${data.error.error_msg} (код ${data.error.error_code})`);
            }
            return false;
        }
        if (data.response && data.response[0]) {
            console.log(`✅ VK: группа "${data.response[0].name}" подключена. Токен валиден.`);
            return true;
        }
        return true;
    } catch (e) {
        console.error('❌ Не удалось проверить VK токен:', e.message);
        return false;
    }
}

// ===================== ЭКСПОРТ =====================
module.exports = { sendVkMessage, notifyVKUser, checkDeadlinesAndNotify, handleVkMessage, checkToken };

// ===================== ЗАПУСК КАК ОТДЕЛЬНЫЙ ПРОЦЕСС =====================
if (require.main === module) {
    (async () => {
        console.log('🤖 VK Bot — проверка токена...');
        const ok = await checkToken();
        if (!ok) process.exit(1);
        console.log('✅ VK Bot готов к отправке уведомлений.');
        console.log('ℹ️  Получение сообщений — через Callback API в server.js (/vk-callback)');
        console.log('ℹ️  Запустите сервер: npm start');
    })();
}
