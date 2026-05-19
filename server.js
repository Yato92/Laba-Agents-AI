// ============================================================
//  Vein's Notes — Сервер регистрации пользователей
//  Стек: Node.js + Express + SQLite + bcrypt
// ============================================================

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

// ===================== ПОДКЛЮЧЕНИЕ К БД =====================
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключено к SQLite БД.');
    }
});

// ===================== МИГРАЦИЯ =====================
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL
    )
`, (err) => {
    if (err) {
        console.error('Ошибка создания таблицы:', err.message);
    } else {
        console.log('Таблица users готова.');
    }
});

// ===================== MIDDLEWARE =====================
app.use(express.json());

// Раздача статических файлов (фронтенд)
app.use(express.static(path.join(__dirname)));

// ===================== ВАЛИДАЦИЯ EMAIL =====================
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ===================== РЕГИСТРАЦИЯ =====================
app.post('/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;

        // Проверка наличия всех полей
        if (!email || !name || !password) {
            return res.status(400).json({
                success: false,
                error: 'Все поля обязательны: email, name, password'
            });
        }

        // Валидация email
        const normalizedEmail = email.trim().toLowerCase();
        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                error: 'Невалидный email'
            });
        }

        // Проверка длины пароля
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен быть минимум 6 символов'
            });
        }

        // Проверка, существует ли пользователь с таким email
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }

        // Хэширование пароля
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        // Сохранение в БД
        const result = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
                [normalizedEmail, name.trim(), password_hash],
                function (err) {
                    if (err) reject(err);
                    else resolve(this);
                }
            );
        });

        // Возвращаем успешный ответ (без пароля)
        res.status(201).json({
            success: true,
            user: {
                id: result.lastID,
                email: normalizedEmail,
                name: name.trim()
            }
        });

    } catch (err) {
        console.error('Ошибка регистрации:', err);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// ===================== СПИСОК ПОЛЬЗОВАТЕЛЕЙ =====================
app.get('/users', (req, res) => {
    db.all('SELECT id, email, name, password_hash FROM users', [], (err, rows) => {
        if (err) {
            console.error('Ошибка получения пользователей:', err);
            return res.status(500).json({
                success: false,
                error: 'Внутренняя ошибка сервера'
            });
        }
        res.json(rows);
    });
});

// ===================== ЗАПУСК СЕРВЕРА =====================
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Регистрация: POST http://localhost:${PORT}/register`);
    console.log(`Список пользователей: GET http://localhost:${PORT}/users`);
});