# 微信云托管 Node.js
# 使用官方 slim（debian/amd64），避免 alpine 多架构清单在 CCR 出现 blob unknown
FROM --platform=linux/amd64 node:18-slim

WORKDIR /usr/src/app

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY sql ./sql
COPY scripts ./scripts
COPY public ./public

ENV NODE_ENV=production
ENV PORT=80
ENV COS_MODE=cloud
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

EXPOSE 80

CMD ["npm", "start"]
