# Development image — bind-mounted source with bun --hot.
FROM oven/bun:1.3-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Source is bind-mounted in docker-compose; this COPY is for the rare case
# of running the image standalone.
COPY . .

EXPOSE 3001

CMD ["bun", "run", "dev"]
