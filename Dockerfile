FROM node:22-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /home/app

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && node -e "import('impit').then(() => console.log('impit ready'))"

COPY --chown=node:node . ./

ENV NODE_ENV=production
ENV APIFY_LOG_LEVEL=INFO

USER node

CMD ["npm", "start", "--silent"]
