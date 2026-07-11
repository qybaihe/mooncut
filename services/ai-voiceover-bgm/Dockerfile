FROM node:22-alpine

RUN apk add --no-cache ffmpeg
WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/data \
    FFMPEG_PATH=ffmpeg

RUN mkdir -p /app/data/audio
EXPOSE 8787

CMD ["node", "src/index.js"]
