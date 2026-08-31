# 微信云托管 Node.js 服务
FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY sql ./sql
COPY scripts ./scripts
COPY public ./public

# 不向镜像写入 .env，数据库地址必须由云托管「服务环境变量」注入
ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

CMD ["npm", "start"]
