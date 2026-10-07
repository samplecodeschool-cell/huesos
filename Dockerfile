# ТОРО-Ассистент: узел карьера + PWA-клиент. Внешних зависимостей нет.
FROM node:22-alpine
WORKDIR /srv/toro
COPY package.json ./
COPY core ./core
COPY app ./app
COPY server ./server
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/server.js"]
