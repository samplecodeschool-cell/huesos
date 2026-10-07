# Развёртывание на хостинге

Проект — это один процесс Node.js (≥ 20) **без внешних зависимостей**. Он раздаёт приложение и обслуживает синхронизацию.

> **HTTPS обязателен.** Без него браузер на телефоне отключает работу офлайн (Service Worker) и шифрование. На `localhost` это не нужно, на домене — нужно.

## Быстрый запуск по HTTP (для демонстрации)

На сервере с Docker:
```bash
git clone -b claude/mvp-tech-spec-9jarz9 https://github.com/samplecodeschool-cell/huesos.git && cd huesos
docker build -t toro-assistant .
docker run -d --name toro --restart unless-stopped -p 80:8080 -v toro-data:/data -e RULES_SIGNING_KEY=$(openssl rand -hex 32) toro-assistant
```
Без Docker (Node.js ≥ 20): `sudo PORT=80 node server/server.js` или `PORT=8080 node server/server.js` с открытием порта 8080 в файрволе.

Откройте `http://IP-сервера/` (или `:8080`).

**Что работает по http:** все экраны, анализ, нейросеть, справочник, обучение, решения и синхронизация с сервером. **Что не работает:** браузер отключает Service Worker и WebCrypto вне https. Поэтому приложение не откроется без сети, а записи на устройстве хранятся без шифрования. На главной в строке состояния показывается «Защита: Без HTTPS». Для показа офлайн-режима нужен https (ниже) или localhost.

## Вариант А. VPS / облачный сервер (Linux, есть SSH) — рекомендуется

### A1. Через Docker (проще всего)

```bash
git clone -b claude/mvp-tech-spec-9jarz9 https://github.com/samplecodeschool-cell/huesos.git
cd huesos
RULES_SIGNING_KEY=$(openssl rand -hex 32) docker compose up -d --build
curl http://127.0.0.1:8080/api/health        # {"ok":true,...}
```

Контейнер слушает только `127.0.0.1:8080`. Наружу его публикует веб-сервер с HTTPS (шаг A3). Данные (журнал, принятые решения) хранятся в томе `toro-data` и переживают перезапуск.

Обновление:
```bash
git pull && docker compose up -d --build
```

### A2. Без Docker (systemd)

```bash
sudo apt install -y nodejs        # нужна версия ≥ 20: node -v
git clone -b claude/mvp-tech-spec-9jarz9 https://github.com/samplecodeschool-cell/huesos.git /opt/toro
sudo useradd -r -s /usr/sbin/nologin toro && sudo mkdir -p /var/lib/toro && sudo chown toro /var/lib/toro
```

`/etc/systemd/system/toro.service`:
```ini
[Unit]
Description=TORO-Assistant
After=network.target

[Service]
User=toro
WorkingDirectory=/opt/toro
Environment=PORT=8080 DATA_DIR=/var/lib/toro RULES_SIGNING_KEY=замените-на-случайную-строку
ExecStart=/usr/bin/node server/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now toro
```

### A3. Домен и HTTPS

Направьте A-запись домена на IP сервера. Дальше — один из вариантов.

**Caddy** (сертификат Let's Encrypt получит сам). Файл `/etc/caddy/Caddyfile`:
```
toro.example.ru {
    reverse_proxy 127.0.0.1:8080
}
```

**nginx + certbot:**
```nginx
server {
    server_name toro.example.ru;
    location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
```
```bash
sudo certbot --nginx -d toro.example.ru
```

Готово: `https://toro.example.ru`. На телефоне откройте адрес → меню браузера → «Добавить на главный экран». После первого открытия приложение работает и без сети.

## Вариант Б. Хостинг с панелью и поддержкой Node.js

Подходит, если в панели есть раздел «Node.js-приложения» (на многих российских хостингах он есть).

| Настройка | Значение |
|---|---|
| Версия Node.js | 20 или 22 |
| Корень приложения | папка проекта |
| Файл запуска | `server/server.js` |
| Переменные окружения | `RULES_SIGNING_KEY`, при необходимости `DATA_DIR` (папка, доступная на запись) |
| `npm install` | не требуется (нет зависимостей) |

Порт хостинг обычно передаёт сам через переменную `PORT` — сервер её читает. HTTPS включается в панели (бесплатный сертификат).

## Вариант В. Обычный (PHP/статический) хостинг без Node.js

Запустить сервер синхронизации не получится, но **само приложение работает**: анализ, нейросеть, справочник, обучение и локальное хранение на телефоне. Индикатор связи будет показывать «Офлайн», решения останутся в очереди на устройстве. Для демонстрации интерфейса этого достаточно.

Залейте в корень сайта такую структуру:
```
/index.html, /app.js, /ui.js, /db.js, /sync.js, /sw.js, /styles.css, /manifest.webmanifest, /icon.svg   ← содержимое папки app/
/core/...                                                                                             ← папка core/ целиком
```

Сайт должен открываться **с корня домена** (или поддомена) и по HTTPS.

## Безопасность публичной демо-версии

- **Данные синтетические.** Материалы кейса в репозитории и в приложении отсутствуют — их и не нужно туда добавлять.
- **Токен устройства в демо общий** (`demo-device-token`, прописан в `app/sync.js`). Любой, кто знает адрес, может отправить запись на `/api/sync`. Для демо это допустимо: размер пакета ограничен 2 МБ, записи идемпотентны. Для постоянного стенда закройте сайт паролем на уровне nginx/Caddy (basic auth) или ограничьте доступ по IP.
- **`RULES_SIGNING_KEY` задавайте всегда.** Ключ по умолчанию — демонстрационный.
- В промышленной версии сервер ставится в сеть карьера без выхода в интернет. Устройства авторизуются сертификатами MDM (`docs/architecture.md`, §5).
