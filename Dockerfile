FROM node:24-bookworm-slim

RUN sed -i 's|http://deb.debian.org|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-wqy-microhei ca-certificates git poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --home-dir /home/app --create-home app \
    && git config --system --add safe.directory /app \
    && git config --system --add safe.directory /app/.admin-work

# 依赖装在 /deps，链到根目录的 /node_modules：compose 把服务器上的 git 工作区挂到 /app 时，依赖不会被盖住
# （Node 从 /app/src/… 往上找依赖，/app 里没有就找到 /node_modules；管家工作副本 /app/.admin-work 里跑测试也一样）
# npm 源和上面的 apt 源一样默认用国内镜像（服务器到官方源实测每个请求 7 秒多）；在国外可以 --build-arg NPM_REGISTRY=https://registry.npmjs.org/
ARG NPM_REGISTRY=https://registry.npmmirror.com/
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=$NPM_REGISTRY && ln -s /deps/node_modules /node_modules

WORKDIR /app
COPY --chown=app:app . .
RUN mkdir -p data workspace .claude-agent-config \
    && chown -R app:app data workspace .claude-agent-config

USER app
ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 4870 4871
# 管理服务带着团队服务跑，团队服务的输出同时写进 data/service.log
CMD ["node", "src/admin/main.mjs"]
