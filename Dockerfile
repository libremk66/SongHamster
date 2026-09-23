# ============================================================
# SongHamster — LX 歌单同步入库媒体库（Emby / 未来更多）
# 多阶段构建：Node 22 编译 → 精简运行镜像
#
# 构建:  docker build -t songhamster .
# 运行:  参照 docker-compose.example.yml（挂载音乐目录 + data 卷）
# ============================================================
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 原生模块编译工具链（apt 源换阿里云加速；仅在构建层需要）
RUN printf 'Types: deb\nURIs: http://mirrors.aliyun.com/debian\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: http://mirrors.aliyun.com/debian-security\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# 1) 先装依赖（利用层缓存；better-sqlite3 原生模块在此编译）
COPY package.json package-lock.json ./
RUN npm ci

# 2) 编译 TS → dist
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 3) 构建前端（React SPA）—— 界面已经全在这个包里，不构建镜像就没有界面
#    先只 COPY 依赖清单再 npm ci，这样改前端源码不会让这层缓存失效
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# ---- 运行镜像 ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# 运行时依赖（含编译好的 better-sqlite3 原生模块）
COPY --from=build /app/node_modules ./node_modules
# 编译产物 + 版本信息
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
# 前端产物：Express 从 web/dist 提供 SPA（旧 Eta 模板已删，不再需要 src/views）
COPY --from=build /app/web/dist ./web/dist
# 静态资源（图标等）
COPY static ./static

# 运行数据（config.yaml + songhamster.db）挂载点
VOLUME /app/data

EXPOSE 8935
CMD ["node", "dist/server.js"]
