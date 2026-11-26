FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY shared ./shared
COPY public ./public
ENV PORT=3000 DATA_DIR=/data
RUN mkdir -p /data/replays && chown -R node:node /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
