#!/bin/sh
# If JWT_SECRET isn't set, generate a random one on first start and keep it in
# /app/secrets (a volume in docker-compose.yml), so `docker compose up` works
# with no setup, logins survive restarts, and no secret is ever committed.
# A JWT_SECRET passed in the environment always wins.
set -e

if [ -z "$JWT_SECRET" ]; then
  secret_file=/app/secrets/jwt_secret
  if [ ! -s "$secret_file" ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "$secret_file"
    chmod 600 "$secret_file"
    echo "Generated a JWT_SECRET for this volume (set JWT_SECRET to use your own)."
  fi
  JWT_SECRET=$(cat "$secret_file")
  export JWT_SECRET
fi

exec "$@"
