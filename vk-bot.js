// ============================================================
//  Vein's Notes — VK Long Poll Bot
//  Функции: напоминания о дедлайнах, уведомления о заметках
//  ============================================================

const { VK } = require('vk-io');
const { toASCII } = require('punycode');
const path = require('path');
const fs = require('fs');

// Загрузка .env
require('dotenv').config();

const VK_TOKEN = process.env.VK_TOKEN;
const GROUP_ID = parseInt(process.env.VK_GROUP_ID || '0', 10);

if (!VK_TOKEN) {
    console.error('❌ VK_TOKEN не найден в .env!');
    process.exit(1);
}

const vk = new VK({ token: VK_TOKEN });

// ===================== ХРАНИЛИЩЕ ЗАМЕТОК (локальный JSON) =====================
const NOTES_FILE = path.join(__dirname, 'vk_notes.json');

function loadNotes() {
    try {
        if (fs.existsSync(NOTES_FILE)) {
            return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('Ошибка загрузки заметок:', e.message);
    }
    return {};
}

function saveNotes(notes) {
    try {
        fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) {
        console.error('Ошибка сохранения заметок:', e.message);
    }
}

// IDs пользователей ВК, которым разрешено пользоваться ботом
// Пока разрешаем всем (можно ограничить позже)
let allowedUsers = [];

// Текущий контекст разговора для каждого пользователя
const userContext = {};

// ===================== ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЕЙ =====================
function getUserVkId(userId) {
    return parseInt(userId, 10);
}

// ===================== ПАРСИНГ ЗАМЕТКИ =====================
function parseNote(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const firstLine = lines[0] || '';

    // Определяем приоритет
    let priority = 'medium';
    if (firstLine.toLowerCase().includes('крит') || firstLine.includes('🔥')) priority = 'critical';
    else if (firstLine.toLowerCase().includes('важн') || firstLine.includes('🔴')) priority = 'high';
    else if (firstLine.toLowerCase().includes('низк') || firstLine.includes('🟢')) priority = 'low';

    // Убираем метку приоритета из заголовка
    let title = firstLine.replace(/\[(крит|важн|сред|низк)\]/i, '').replace(/[🔥🔴🟡🟢]/g, '').trim();
    if (!title) title = 'Заметка из ВК';

    // Ищем дату дедлайна
    const dateMatch = text.match(/дедлайн[:\s]*(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?/i);
    let deadline = '';
    if (dateMatch) {
        const d = dateMatch[1].padStart(2, '0');
        const m = dateMatch[2].padStart(2, '0');
        const y = dateMatch[3] || new Date().getFullYear();
        deadline = `${y}-${m}-${d}`;
    }

    // Извлекаем теги
    const tags = (text.match(/#\w+/g) || []).map(t => t.toLowerCase());

    // Контент —всё кроме первой строки
    const content = lines.slice(1).join('\n');

    return {
        title,
        content: content || title,
        deadline,
        priority,
        tags,
        date: new Date().toISOString().split('T')[0]
    };
}

// ===================== ФОРМАТИРОВАНИЕ ЗАМЕТКИ ДЛЯ ВК =====================
function formatNoteForVK(note) {
    const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
    let msg = `${emoji[note.priority] || '📝'} *${note.title}*\n`;
    if (note.deadline) msg += `⏰ Дедлайн: ${note.deadline}\n`;
    if (note.tags && note.tags.length) msg += `🏷️ Теги: ${note.tags.join(' ')}\n`;
    if (note.content && note.content !== note.title) msg += `📄 ${note.content.substring(0, 100)}\n`;
    msg += `\n📅 Создана: ${note.date}`;
    return msg;
}

// ===================== ОБРАБОТКА СООБЩЕНИЙ =====================
async function handleMessage(context) {
    const userId = context.senderId;
    const text = context.text?.trim() || '';

    if (!text) return;

    // Проверяем, разрешён ли пользователь
    if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        return context.send('⛔ У вас нет доступа к этому боту.');
    }

    // Разбиваем команды
    const args = text.split(/\s+/);
    const command = args[0].toLowerCase();

    switch (command) {
        case '/start':
        case 'начать':
        case 'помощь':
        case 'help':
            await context.send(
                `🤖 *Vein's Notes Bot*\n\n` +
                `📝 *Создать заметку:* просто напишите текст\n` +
                `  — для приоритета: 🔴 /важно, 🔥 /крит, 🟢 /низк\n` +
                `  — дедлайн: укажите "дедлайн 25.12.2026"\n` +
                `  — теги: #работа #личное\n\n` +
                `📋 *Мои заметки:* /notes, /заметки\n` +
                `❌ *Удалить:* /del <id>\n` +
                `⏰ *Дедлайны:* /deadlines\n` +
                `🗑️ *Очистить:* /clear\n\n` +
                `🤖 *Спросить ИИ:* /ai <вопрос> (когда Ollama подключена)\n` +
                `❓ /help — эта помощь`
            );
            break;

        case '/notes':
        case '/заметки':
        case '/list':
        case '/список': {
            const notes = loadNotes();
            const userNotes = (notes[userId] || []).slice().reverse();
            if (userNotes.length === 0) {
                return context.send('📭 У вас нет заметок.');
            }
            let msg = `📋 *Ваши заметки (${userNotes.length}):*\n\n`;
            userNotes.forEach((n, i) => {
                const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
                msg += `${i + 1}. ${emoji[n.priority]} ${n.title.substring(0, 40)}`;
                if (n.deadline) msg += ` (⏰ ${n.deadline})`;
                msg += `\n   ID: ${n.id}\n`;
            });
            // Отправляем частями, если много
            if (msg.length > 4000) {
                const parts = msg.match(/[\s\S]{1,4000}/g) || [msg];
                for (const part of parts) {
                    await context.send(part);
                }
            } else {
                await context.send(msg);
            }
            break;
        }

        case '/deadlines':
        case '/дедлайны': {
            const notes = loadNotes();
            const userNotes = (notes[userId] || []).filter(n => n.deadline);
            if (userNotes.length === 0) {
                return context.send('✅ Нет задач с дедлайнами.');
            }
            // Сортируем по ближайшему дедлайну
            userNotes.sort((a, b) => a.deadline.localeCompare(b.deadline));
            let msg = `⏰ *Ближайшие дедлайны:*\n\n`;
            const today = new Date().toISOString().split('T')[0];
            userNotes.forEach((n, i) => {
                const isOverdue = n.deadline < today;
                const isToday = n.deadline === today;
                const icon = isOverdue ? '⚠️' : isToday ? '🔴' : '📅';
                const daysLeft = Math.ceil((new Date(n.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                msg += `${i + 1}. ${icon} ${n.title.substring(0, 30)} — ${n.deadline}`;
                if (!isOverdue && daysLeft > 0) msg += ` (осталось ${daysLeft} дн.)`;
                if (isToday) msg += ` (СЕГОДНЯ!)`;
                if (isOverdue) msg += ` (ПРОСРОЧЕН!)`;
                msg += `\n   ID: ${n.id}\n`;
            });
            await context.send(msg);
            break;
        }

        case '/del':
        case '/delete':
        case '/удалить':
        case '/remove': {
            const noteId = args[1];
            if (!noteId) return context.send('❌ Укажите ID заметки: /del <id>');
            const notes = loadNotes();
            const userNotes = notes[userId] || [];
            const idx = userNotes.findIndex(n => n.id === noteId);
            if (idx === -1) return context.send('❌ Заметка с таким ID не найдена.');
            userNotes.splice(idx, 1);
            notes[userId] = userNotes;
            saveNotes(notes);
            await context.send('✅ Заметка удалена.');
            break;
        }

        case '/clear':
        case '/очистить': {
            const notes = loadNotes();
            notes[userId] = [];
            saveNotes(notes);
            await context.send('🗑️ Все заметки очищены.');
            break;
        }

        case '/ai':
        case '/ask':
        case '/спросить': {
            const question = text.substring(command.length).trim();
            if (!question) return context.send('❓ Напишите вопрос после команды /ai');
            
            // Пробуем обратиться к Ollama
            try {
                const response = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: process.env.OLLAMA_MODEL || 'llama3.2',
                        prompt: question,
                        stream: false
                    })
                });
                const data = await response.json();
                if (data.response) {
                    // Отправляем ответ частями
                    const answer = data.response.trim();
                    if (answer.length > 4000) {
                        const parts = answer.match(/[\s\S]{1,4000}/g) || [answer];
                        for (const part of parts) {
                            await context.send(part);
                        }
                    } else {
                        await context.send(answer);
                    }
                } else {
                    await context.send('🤖 Не удалось получить ответ от ИИ. Проверьте, запущена ли Ollama.');
                }
            } catch (e) {
                console.error('Ollama error:', e.message);
                await context.send('🤖 Ollama не отвечает. Убедитесь, что она запущена (ollama serve).');
            }
            break;
        }

        default:
            // Если не команда — создаём заметку
            if (text.length > 2) {
                const note = parseNote(text);
                note.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);

                const notes = loadNotes();
                if (!notes[userId]) notes[userId] = [];
                notes[userId].push(note);
                saveNotes(notes);

                let reply = `✅ *Заметка создана!*\n\n${formatNoteForVK(note)}`;
                reply += `\n\n❌ Удалить: /del ${note.id}`;
                await context.send(reply);

                // Оповещаем если есть дедлайн
                if (note.deadline) {
                    const daysLeft = Math.ceil((new Date(note.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                    if (daysLeft <= 1) {
                        await context.send(`⚠️ *ВНИМАНИЕ!* Дедлайн "${note.title}" уже ${daysLeft <= 0 ? 'СЕГОДНЯ!' : 'ЗАВТРА!'}`);
                    }
                }
            }
    }
}

// ===================== НАПОМИНАНИЯ О ДЕДЛАЙНАХ =====================
async function checkDeadlinesAndNotify() {
    const notes = loadNotes();
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    for (const [userId, userNotes] of Object.entries(notes)) {
        for (const note of userNotes) {
            if (!note.deadline) continue;

            const isDeadlineTomorrow = note.deadline === tomorrow;
            const isDeadlineToday = note.deadline === today;
            const notifiedKey = `notified_${note.id}`;

            if (isDeadlineToday && !note._notifiedToday) {
                try {
                    await vk.api.messages.send({
                        peer_id: parseInt(userId),
                        random_id: Math.floor(Math.random() * 1000000),
                        message: `⚠️ *ДЕДЛАЙН СЕГОДНЯ!*\n\n📌 "${note.title}"\n📅 Дедлайн: ${note.deadline}\n\n🔥 Не забудьте завершить задачу!`
                    });
                    note._notifiedToday = true;
                    console.log(`🔔 Уведомление отправлено пользователю ${userId} (дедлайн сегодня: ${note.title})`);
                } catch (e) {
                    console.error(`Ошибка отправки уведомления ${userId}:`, e.message);
                }
            }

            if (isDeadlineTomorrow && !note._notifiedTomorrow) {
                try {
                    await vk.api.messages.send({
                        peer_id: parseInt(userId),
                        random_id: Math.floor(Math.random() * 1000000),
                        message: `⏰ *Напоминание!*\n\n📌 "${note.title}"\n📅 Дедлайн ЗАВТРА: ${tomorrow}\n\n⏳ Остался 1 день!`
                    });
                    note._notifiedTomorrow = true;
                    console.log(`🔔 Уведомление отправлено пользователю ${userId} (дедлайн завтра: ${note.title})`);
                } catch (e) {
                    console.error(`Ошибка отправки уведомления ${userId}:`, e.message);
                }
            }
        }
    }
    saveNotes(notes);
}

// ===================== СИНХРОНИЗАЦИЯ С ВЕБ-ПРИЛОЖЕНИЕМ =====================
// Функция для отправки уведомления о заметке, созданной на сайте
async function notifyVKUser(userVkId, note, action) {
    try {
        const emoji = { low: '🟢', medium: '🟡', high: '🔴', critical: '🔥' };
        let msg = action === 'created'
            ? `✅ *Новая заметка на сайте!*\n\n${emoji[note.priority] || '📝'} ${note.title}`
            : `🔄 *Заметка обновлена на сайте:* ${note.title}`;

        if (note.deadline) msg += `\n⏰ Дедлайн: ${note.deadline}`;
        msg += `\n📅 ${note.date}`;

        await vk.api.messages.send({
            peer_id: userVkId,
            random_id: Math.floor(Math.random() * 1000000),
            message: msg
        });
        console.log(`📨 Уведомление отправлено пользователю ВК ${userVkId}`);
    } catch (e) {
        console.error(`Ошибка отправки уведомления ВК ${userVkId}:`, e.message);
    }
}

// ===================== ЗАПУСК БОТА =====================
async function startBot() {
    try {
        console.log('🤖 Запуск VK Long Poll бота...');

        // Проверяем токен
        try {
            const groupInfo = await vk.api.groups.getById({
                group_id: GROUP_ID
            });
            console.log(`✅ Группа: ${groupInfo.name || 'ID ' + GROUP_ID}`);
        } catch (e) {
            console.warn(`⚠️ Не удалось получить информацию о группе: ${e.message}`);
        }

        // Запускаем Long Poll с обработкой ошибки включения
        try {
            vk.updates.on('message', handleMessage);
            await vk.updates.start();
            console.log('✅ VK бот запущен и слушает сообщения!');
        } catch (e) {
            if (e.message.includes('longpoll') || e.code === 100) {
                console.warn('⚠️ Long Poll API не включён в настройках сообщества!');
                console.warn('   Чтобы включить:');
                console.warn('   1. Зайдите в https://vk.com/club238851353');
                console.warn('   2. Управление → Работа с API → Long Poll API');
                console.warn('   3. Включите "Long Poll API" и сохраните');
                console.warn('   4. Перезапустите бота командой: npm run vk-bot');
                console.warn('ℹ️ Бот продолжит работать в режиме без VK (напоминания через сайт активны)');
            } else {
                console.error('❌ Ошибка запуска VK бота:', e.message);
                if (e.message.includes('access_token')) {
                    console.error('   Проверьте правильность VK_TOKEN в .env');
                }
            }
            return; // Не завершаем процесс, даём серверу работать дальше
        }

        // Запускаем проверку дедлайнов каждые 30 минут
        console.log('⏰ Запуск планировщика напоминаний (каждые 30 мин)...');
        try {
            await checkDeadlinesAndNotify(); // немедленная проверка
        } catch (e) {
            console.error('⚠️ Ошибка проверки дедлайнов:', e.message);
        }
        setInterval(async () => {
            console.log('🔄 Плановая проверка дедлайнов...');
            try {
                await checkDeadlinesAndNotify();
            } catch (e) {
                console.error('⚠️ Ошибка проверки дедлайнов:', e.message);
            }
        }, 30 * 60 * 1000); // каждые 30 минут

    } catch (e) {
        console.error('❌ Критическая ошибка VK бота:', e.message);
        // Не завершаем процесс — сервер продолжает работу
    }
}

// ===================== ЭКСПОРТ =====================
module.exports = { startBot, notifyVKUser, loadNotes, saveNotes };

// Запуск при прямом вызове
if (require.main === module) {
    startBot();
}