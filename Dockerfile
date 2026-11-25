FROM node:24-bookworm-slim

RUN sed -i 's|http://deb.debian.org|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-wqy-microhei ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --home-dir /home/app --create-home app

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=app:app . .
RUN mkdir -p data workspace .claude-agent-config \
    && chown -R app:app data workspace .claude-agent-config

USER app
ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 4870 4871
CMD ["node", "src/main.mjs"]
