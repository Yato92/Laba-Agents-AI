// Тест Ollama через сервер
async function test() {
    console.log('1. Тест прямого вызова Ollama...');
    try {
        const res = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3.1:8b', prompt: 'Скажи привет одним словом', stream: false })
        });
        const data = await res.json();
        console.log('✅ Ollama напрямую:', data.response?.substring(0, 100));
    } catch (e) {
        console.log('❌ Ollama напрямую не работает:', e.message);
    }

    console.log('\n2. Тест через сервер localhost:3000...');
    try {
        const res = await fetch('http://localhost:3000/api/ollama', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'Скажи привет одним словом', context: 'Тестовый контекст' })
        });
        const data = await res.json();
        console.log('✅ Сервер отвечает:', JSON.stringify(data).substring(0, 200));
    } catch (e) {
        console.log('❌ Сервер не отвечает:', e.message);
    }

    console.log('\n3. Тест VK уведомления...');
    try {
        const res = await fetch('http://localhost:3000/api/notify-vk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vk_id: '485233456',
                note: { title: 'Тестовая заметка', deadline: '', date: '2026-05-20', priority: 'medium' },
                action: 'created'
            })
        });
        const data = await res.json();
        console.log('✅ VK уведомление:', JSON.stringify(data));
    } catch (e) {
        console.log('❌ VK ошибка:', e.message);
    }

    console.log('\nГотово!');
}

test();