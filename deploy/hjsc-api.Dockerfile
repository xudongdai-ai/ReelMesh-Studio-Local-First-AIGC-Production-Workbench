FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HJSC_API_HOST=0.0.0.0
ENV HJSC_API_PORT=8787

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com

COPY server ./server

EXPOSE 8787

CMD ["node", "--experimental-sqlite", "server/index.mjs"]
