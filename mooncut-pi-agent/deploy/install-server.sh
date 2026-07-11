#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/mooncut"
APP_USER="ubuntu"
ENV_DIR="/etc/mooncut"
SOURCE_ENV="/tmp/mooncut-source.env"
PUBLIC_IP="42.194.219.172"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi
if [[ ! -f "${SOURCE_ENV}" ]]; then
  echo "Missing ${SOURCE_ENV}" >&2
  exit 1
fi

gateway_key="$(sed -n 's/^MOONCUT_GATEWAY_API_KEY=//p' "${SOURCE_ENV}" | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
if [[ -z "${gateway_key}" ]]; then
  echo "Source environment does not contain MOONCUT_GATEWAY_API_KEY" >&2
  exit 1
fi

install -d -m 0750 -o "${APP_USER}" -g "${APP_USER}" "${ROOT}" "${ROOT}/cache" "${ROOT}/secrets"
install -d -m 0755 -o "${APP_USER}" -g "${APP_USER}" \
  "${ROOT}/mooncut-pi-agent/data/assets" \
  "${ROOT}/mooncut-pi-agent/data/jobs" \
  "${ROOT}/remotion-studio/public/agent-jobs"
install -d -m 0750 "${ENV_DIR}" "${ENV_DIR}/tls"

client_key=""
if [[ -f "${ENV_DIR}/mooncut.env" ]]; then
  client_key="$(sed -n 's/^MOONCUT_API_KEY=//p' "${ENV_DIR}/mooncut.env" | tail -n 1)"
fi
if [[ -z "${client_key}" ]]; then
  client_key="mooncut_$(openssl rand -hex 32)"
fi

whisper_model="small"
if [[ -f "${ROOT}/models/faster-whisper-small/model.bin" ]]; then
  whisper_model="${ROOT}/models/faster-whisper-small"
fi

cat > "${ENV_DIR}/mooncut.env" <<EOF
MOONCUT_GATEWAY_BASE_URL=http://127.0.0.1:8792/v1
MOONCUT_GATEWAY_API_KEY=${gateway_key}
MOONCUT_PLANNER_MODEL=glm-5.2
MOONCUT_SCRIPT_MODEL=glm-5.2
MOONCUT_COACH_MODEL=deepseek-v4-flash
MOONCUT_VISION_MODELS=minimax-m3,mimo-v2.5
MOONCUT_VISION_TIMEOUT_MS=120000
MOONCUT_AGENT_HOST=127.0.0.1
MOONCUT_AGENT_PORT=4317
MOONCUT_PUBLIC_BASE_URL=https://${PUBLIC_IP}
MOONCUT_API_KEY=${client_key}
MOONCUT_ALLOW_INPUT_PATH=false
MOONCUT_MAX_QUEUED_JOBS=6
MOONCUT_RENDER_CONCURRENCY=1
MOONCUT_BROWSER_EXECUTABLE=${ROOT}/tools/chrome
MOONCUT_MAX_UPLOAD_MB=1024
MOONCUT_CORS_ORIGINS=https://${PUBLIC_IP}
MOONCUT_MAIL_TRANSPORT=agently-cli
MOONCUT_MAIL_CLI=/usr/local/bin/agently-cli
MOONCUT_MAIL_SENDER_NAME=MoonCut 小月
MOONCUT_SUBTITLE_API_URL=http://127.0.0.1:8765
MOONCUT_SUBTITLE_API_KEY=integration-test
MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES=false
MOONCUT_REQUIRE_SUBTITLE_SERVICE=true
MOONCUT_SUBTITLE_JOB_TIMEOUT_MS=2700000
MOONCUT_SUBTITLE_POLL_INTERVAL_MS=2000
MOONCUT_RENDER_TIMEOUT_MS=7200000
MOONCUT_RENDER_WIDTH=1280
MOONCUT_RENDER_HEIGHT=720
MOONCUT_RENDER_FPS=24
MOONCUT_AGENT_EXECUTION_MODE=reliable
MOONCUT_TRANSCRIBE_PYTHON=${ROOT}/mooncut-pi-agent/.venv-transcribe/bin/python
MOONCUT_WHISPER_MODEL=${whisper_model}
MOONCUT_WHISPER_LANGUAGE=auto
MOONCUT_WHISPER_THREADS=4
MOONCUT_WHISPER_CACHE=${ROOT}/cache/whisper
MOONCUT_X_POST_CAPTURE_SCRIPT=${ROOT}/tools/x-post-screenshot/x_post_capture.py
MOONCUT_PLAYWRIGHT_CLI=${ROOT}/tools/playwright_cli.sh
PLAYWRIGHT_CLI=${ROOT}/tools/playwright_cli.sh
# Browser/X evidence uses the host-only Singbox SOCKS endpoint. Do not expose it publicly.
MOONCUT_BROWSER_PROXY_SERVER=socks5://127.0.0.1:7897
TWSCRAPE_BIN=${ROOT}/tools/x-venv/bin/twscrape
TWS_DB=${ROOT}/secrets/twscrape-accounts.db
DISPLAY=:99
HOME=/home/${APP_USER}
EOF
chmod 0600 "${ENV_DIR}/mooncut.env"

cat > "${ENV_DIR}/client.env" <<EOF
MOONCUT_API_BASE=https://${PUBLIC_IP}
MOONCUT_API_KEY=${client_key}
MOONCUT_CA_CERT=\${HOME}/.config/mooncut/mooncut-ca.crt
EOF
chmod 0600 "${ENV_DIR}/client.env"
rm -f "${SOURCE_ENV}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl ffmpeg fonts-noto-cjk fonts-noto-color-emoji \
  openssl python3-pip python3-venv rsync xvfb

sudo -u "${APP_USER}" npm --prefix "${ROOT}/mooncut-pi-agent" ci --ignore-scripts
sudo -u "${APP_USER}" npm --prefix "${ROOT}/remotion-studio" ci
required_motion_component="${ROOT}/remotion-studio/extensions/remotion-community/remocn/registry/remocn/animated-bar-chart/index.tsx"
if [[ ! -f "${required_motion_component}" ]]; then
  echo "Missing Remotion community extension source: ${required_motion_component}" >&2
  echo "Run deploy/sync-remotion-extensions.sh before enabling the service." >&2
  exit 1
fi

python3 -m venv "${ROOT}/mooncut-pi-agent/.venv-transcribe"
"${ROOT}/mooncut-pi-agent/.venv-transcribe/bin/pip" install --upgrade pip wheel
"${ROOT}/mooncut-pi-agent/.venv-transcribe/bin/pip" install -r "${ROOT}/mooncut-pi-agent/scripts/requirements-transcribe.txt"

python3 -m venv "${ROOT}/face-tracker/.venv"
"${ROOT}/face-tracker/.venv/bin/pip" install --upgrade pip wheel
if compgen -G "${ROOT}/cache/torch-wheels/torch-*.whl" > /dev/null && compgen -G "${ROOT}/cache/torch-wheels/torchvision-*.whl" > /dev/null; then
  "${ROOT}/face-tracker/.venv/bin/pip" install --no-deps \
    "${ROOT}"/cache/torch-wheels/torch-*.whl \
    "${ROOT}"/cache/torch-wheels/torchvision-*.whl
else
  "${ROOT}/face-tracker/.venv/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cpu
fi
"${ROOT}/face-tracker/.venv/bin/pip" install -e "${ROOT}/face-tracker"

python3 -m venv "${ROOT}/tools/x-venv"
"${ROOT}/tools/x-venv/bin/pip" install --upgrade pip wheel twscrape

npx --yes playwright install-deps chromium
sudo -u "${APP_USER}" env HOME="/home/${APP_USER}" npx --yes playwright install --no-shell chromium
chrome_path="$(find "/home/${APP_USER}/.cache/ms-playwright" -type f -path '*/chrome-linux*/chrome' | sort | tail -n 1)"
if [[ -z "${chrome_path}" ]]; then
  echo "Playwright Chrome executable was not installed" >&2
  exit 1
fi
ln -sfn "${chrome_path}" "${ROOT}/tools/chrome"
install -d -m 0755 /opt/google/chrome
ln -sfn "${chrome_path}" /opt/google/chrome/chrome

chmod 0700 "${ROOT}/tools/playwright_cli.sh" "${ROOT}/tools/x-post-screenshot/x_post_capture.py"
chmod 0644 "${ROOT}/tools/playwright-cli.config.json"
chmod 0700 "${ROOT}/mooncut-pi-agent/deploy/install-subtitle-service.sh"
chmod 0600 "${ROOT}/secrets/twscrape-accounts.db"
chown -R "${APP_USER}:${APP_USER}" "${ROOT}"

if [[ ! -f "${ENV_DIR}/tls/ca.key" ]]; then
  openssl genrsa -out "${ENV_DIR}/tls/ca.key" 4096
  openssl req -x509 -new -sha256 -days 3650 \
    -key "${ENV_DIR}/tls/ca.key" \
    -out "${ENV_DIR}/tls/ca.crt" \
    -subj "/CN=MoonCut Private CA"
fi
if [[ ! -f "${ENV_DIR}/tls/server.key" ]]; then
  openssl genrsa -out "${ENV_DIR}/tls/server.key" 2048
  openssl req -new -key "${ENV_DIR}/tls/server.key" \
    -out "${ENV_DIR}/tls/server.csr" \
    -subj "/CN=${PUBLIC_IP}"
  cat > "${ENV_DIR}/tls/server.ext" <<EOF
subjectAltName=IP:${PUBLIC_IP}
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
  openssl x509 -req -sha256 -days 397 \
    -in "${ENV_DIR}/tls/server.csr" \
    -CA "${ENV_DIR}/tls/ca.crt" \
    -CAkey "${ENV_DIR}/tls/ca.key" \
    -CAcreateserial \
    -out "${ENV_DIR}/tls/server.crt" \
    -extfile "${ENV_DIR}/tls/server.ext"
fi
chmod 0600 "${ENV_DIR}/tls/ca.key" "${ENV_DIR}/tls/server.key"
chmod 0644 "${ENV_DIR}/tls/ca.crt" "${ENV_DIR}/tls/server.crt"

cat > /etc/systemd/system/mooncut-xvfb.service <<'EOF'
[Unit]
Description=MoonCut virtual display for native X screenshots
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -noreset
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/mooncut-agent.service <<EOF
[Unit]
Description=MoonCut Pi Video Editing Agent
After=network-online.target mooncut-xvfb.service
Wants=network-online.target mooncut-xvfb.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${ROOT}/mooncut-pi-agent
EnvironmentFile=${ENV_DIR}/mooncut.env
Environment=PATH=${ROOT}/tools/x-venv/bin:${ROOT}/face-tracker/.venv/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_OPTIONS=--max-old-space-size=1024
ExecStart=/usr/local/bin/node src/cli.ts serve
Restart=always
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ReadWritePaths=${ROOT}
Nice=5
IOSchedulingClass=best-effort
IOSchedulingPriority=6
TasksMax=512

[Install]
WantedBy=multi-user.target
EOF

cat > /usr/local/sbin/mooncut-cleanup <<EOF
#!/usr/bin/env bash
set -euo pipefail
find ${ROOT}/mooncut-pi-agent/data/jobs -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf -- {} +
find ${ROOT}/mooncut-pi-agent/data/assets -mindepth 1 -maxdepth 1 -type f -mtime +7 -delete
find ${ROOT}/remotion-studio/public/agent-jobs -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf -- {} +
EOF
chmod 0755 /usr/local/sbin/mooncut-cleanup

cat > /etc/systemd/system/mooncut-cleanup.service <<'EOF'
[Unit]
Description=Remove expired MoonCut job data

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/mooncut-cleanup
EOF

cat > /etc/systemd/system/mooncut-cleanup.timer <<'EOF'
[Unit]
Description=Daily MoonCut job cleanup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
EOF

cat > /etc/nginx/conf.d/mooncut-rate.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=mooncut_api:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=mooncut_submit:10m rate=6r/m;
limit_conn_zone $binary_remote_addr zone=mooncut_conn:10m;
EOF

cat > /etc/nginx/sites-available/mooncut-agent <<EOF
server {
    listen 443 ssl default_server;
    server_name ${PUBLIC_IP};
    server_tokens off;

    ssl_certificate ${ENV_DIR}/tls/server.crt;
    ssl_certificate_key ${ENV_DIR}/tls/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:mooncut_tls:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    client_max_body_size 1024m;
    client_body_timeout 1800s;
    send_timeout 1800s;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;

    location = /v1/edits {
        limit_req zone=mooncut_submit burst=2 nodelay;
        limit_conn mooncut_conn 2;
        proxy_pass http://127.0.0.1:4317;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 1800s;
        proxy_send_timeout 1800s;
    }

    location / {
        limit_req zone=mooncut_api burst=20 nodelay;
        proxy_pass http://127.0.0.1:4317;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 1800s;
        proxy_send_timeout 1800s;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/mooncut-agent /etc/nginx/sites-enabled/mooncut-agent

systemctl daemon-reload
systemctl enable --now mooncut-xvfb.service mooncut-agent.service mooncut-cleanup.timer
nginx -t
systemctl reload nginx

install -m 0600 "${ENV_DIR}/client.env" "/home/${APP_USER}/mooncut-agent-client.env"
chown "${APP_USER}:${APP_USER}" "/home/${APP_USER}/mooncut-agent-client.env"
echo "MoonCut deployment installed."
