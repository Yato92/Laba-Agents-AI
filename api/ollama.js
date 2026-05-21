// ============================================================
//  Vein's Notes — Vercel Serverless Function
//  AI работает ТОЛЬКО локально через Ollama (не на Vercel)
//  На Vercel возвращает сообщение с инструкцией
// ============================================================

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Только POST запросы' });

    return res.json({
        success: false,
        error: 'AI доступен только локально через Ollama',
        response: '🤖 *ИИ-ассистент работает только при локальном запуске!*\n\n' +
            '📌 *Чтобы включить AI, выполните:*\n\n' +
            '```\n' +
            '# Шаг 1: Установить Ollama\n' +
            'https://ollama.ai/download\n\n' +
            '# Шаг 2: Запустить сервер Ollama\n' +
            'ollama serve\n\n' +
            '# Шаг 3: Загрузить модель\n' +
            'ollama pull llama3.1:8b\n\n' +
            '# Шаг 4: Запустить сайт\n' +
            'node server.js\n' +
            '```\n\n' +
            '🌐 Откройте **http://localhost:3000**\n\n' +
            '💡 *Без AI доступны команды:*\n' +
            '• "создай заметку [текст]" — новая заметка\n' +
            '• "мои заметки" — список заметок\n' +
            '• "дедлайны" — все задачи со сроками',
        note_created: false,
        note: null
    });
};