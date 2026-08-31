# 微信云托管 Node.js 服务
FROM node:18-alpine

WORKDIR /app

# sharp 在 alpine 需要兼容层
RUN apk add --no-cache libc6-compat

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY sql ./sql
COPY scripts ./scripts
COPY public ./public

ENV NODE_ENV=production
ENV PORT=80
ENV COS_MODE=cloud

EXPOSE 80

CMD ["npm", "start"]
