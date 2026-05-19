# Vein's Notes — Сервер регистрации пользователей

Серверная часть для регистрации пользователей с хранением данных в SQLite.

## Стек

- **Node.js** + **Express**
- **SQLite** (лёгкая встраиваемая БД, не требует отдельного сервера)
- **bcrypt** (хэширование паролей)

## Установка

```bash
npm install
```

## Запуск

```bash
npm start
```

Сервер запустится на `http://localhost:3000`.

База данных (`database.db`) создаётся автоматически при первом запуске.

## API

### Регистрация пользователя

**POST** `/register`

Пример запроса через `curl`:

```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Иван Иванов", "password": "mypassword123"}'
```

**Успешный ответ (201):**

```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "Иван Иванов"
  }
}
```

**Возможные ошибки:**

- `400` — невалидный email, отсутствуют поля, пароль короче 6 символов
- `409` — пользователь с таким email уже существует
- `500` — внутренняя ошибка сервера

### Список пользователей

**GET** `/users`

Пример запроса:

```bash
curl http://localhost:3000/users
```

**Ответ (200):**

```json
[
  {
    "id": 1,
    "email": "user@example.com",
    "name": "Иван Иванов",
    "password_hash": "$2b$10$..."
  }
]
```

Пароль возвращается только в хэшированном виде.

## Пример работы с Postman

1. **Метод:** POST
2. **URL:** `http://localhost:3000/register`
3. **Headers:** `Content-Type: application/json`
4. **Body (raw JSON):**

```json
{
  "email": "test@mail.com",
  "name": "Тестовый Пользователь",
  "password": "qwerty123"
}
```

## Безопасность

Пароли **не хранятся в открытом виде**. Используется bcrypt с 10 соляными раундами.