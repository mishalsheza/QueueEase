# QueueEase API. Built and run by docker-compose.yml at the repo root.
FROM node:22-alpine

WORKDIR /app

# Dependencies first, so editing source doesn't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

# Where the generated JWT_SECRET lives (see docker-entrypoint.sh). Owned by the
# unprivileged user so a named volume mounted here inherits that ownership.
RUN mkdir -p /app/secrets && chown node:node /app/secrets

ENV NODE_ENV=production \
    PORT=5001
USER node
EXPOSE 5001

# 200 only while MongoDB is connected (GET /api/health).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
