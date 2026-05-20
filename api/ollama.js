// ============================================================
//  Vein's Notes — AI Serverless Function (Vercel)
//  Использует Groq Cloud API (Llama 3.1)
//  НЕ требует SQLite или других native-зависимостей
// ============================================================

module.exports = async (req, res) => {
    // CORS заголовки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Только POST запросы' });
    }

    // Парсинг JSON тела запроса (на Vercel может быть не распаршено)
    let body = req.body;
    if (!body || typeof body === 'string') {
        try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            body = JSON.parse(Buffer.concat(chunks).toString());
        } catch (e) {
            console.error('❌ JSON parse error:', e.message);
            return res.status(400).json({ success: false, error: 'Невалидный JSON в теле запроса' });
        }
    }

    try {
        const { prompt, context } = body;
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'prompt обязателен' });
        }

        const groqApiKey = process.env.GROQ_API_KEY;
        const groqModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

        // System prompt
        const systemPrompt = `Ты — ИИ-ассистент Vein's Notes. 
Если просят создать заметку: ответь "#CREATE_NOTE {title, description, deadline, importance}".
Если просят перейти: "#NAVIGATE workspace/profile/contacts".
Отвечай кратко, дружелюбно, с эмодзи.`;

        // Обрезаем контекст
        let trimmedContext = (context || '').trim();
        if (trimmedContext.length > 800) {
            trimmedContext = trimmedContext.substring(0, 800) + '...';
        }

        // Формируем запрос
        const fullPrompt = trimmedContext
            ? `${systemPrompt}\n\nКонтекст:\n${trimmedContext}\n\nВопрос: ${prompt}`
            : `${systemPrompt}\n\nВопрос: ${prompt}`;

        const finalPrompt = fullPrompt.length > 2000 ? fullPrompt.substring(0, 2000) : fullPrompt;

        let aiResponse = '';

        if (groqApiKey && groqApiKey !== 'your_groq_api_key_here') {
            // === Groq Cloud API ===
            console.log('🤖 Используем Groq Cloud API...');
            
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqApiKey}`
                },
                body: JSON.stringify({
                    model: groqModel,
                    messages: [
                        { role: 'user', content: finalPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 300,
                    stream: false
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('❌ Groq API error:', response.status, errText);
                throw new Error(`Groq HTTP ${response.status}: ${errText}`);
            }

            const data = await response.json();
            aiResponse = data.choices?.[0]?.message?.content || '';
            console.log('✅ Groq ответ получен');

        } else {
            // === Fallback: локальная Ollama ===
            console.log('⚠️ Groq API ключ не настроен. Пробуем локальную Ollama...');
            
            const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
            const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';
            
            const response = await fetch(`${ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: ollamaModel,
                    prompt: finalPrompt,
                    stream: false,
                    options: {
                        temperature: 0.7,
                        num_predict: 150,
                        num_ctx: 4096
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama HTTP error: ${response.status}. Проверьте, запущена ли Ollama локально.`);
            }

            const data = await response.json();
            aiResponse = data.response || '';
            console.log('✅ Локальная Ollama ответ получен');
        }

        // Парсим #CREATE_NOTE
        let noteCreated = false;
        let note = null;
        const createNoteMatch = aiResponse.match(/#CREATE_NOTE\s*(\{.*?\})/s);
        if (createNoteMatch) {
            try {
                const noteData = JSON.parse(createNoteMatch[1]);
                note = {
                    title: noteData.title || 'Заметка от AI',
                    description: noteData.description || '',
                    deadline: noteData.deadline || '',
                    importance: noteData.importance || 'medium'
                };
                noteCreated = true;
                console.log('📝 AI хочет создать заметку:', note.title);
            } catch (e) {
                console.error('❌ Ошибка парсинга #CREATE_NOTE:', e.message);
            }
        }

        // Очищаем ответ от технических тегов
        const cleanResponse = aiResponse.replace(/#CREATE_NOTE\s*\{.*?\}/s, '').replace(/#NAVIGATE\s*\S*/g, '').trim();

        return res.json({
            success: true,
            response: cleanResponse || '🤖 Привет! Я готов помочь. Задайте вопрос или попросите создать заметку.',
            note_created: noteCreated,
            note: note
        });

    } catch (err) {
        console.error('❌ AI Serverless Error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'AI временно недоступен: ' + err.message,
            response: '😔 Извините, ИИ-ассистент сейчас недоступен. Проверьте настройки API ключа или попробуйте позже.',
            note_created: false,
            note: null
        });
    }
};