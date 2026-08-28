# syntax=docker/dockerfile:1

# Node 24 because the app stores its index in `node:sqlite`, which is built into
# the runtime rather than compiled from source. That is what keeps this image
# free of a native build toolchain.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are frozen into the browser bundle here, so .env has to
# be present at build time and not only at run time.
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone emits the server and the traced dependencies. The three copies
# after it are the things import tracing cannot see: static assets, the public
# folder, and the master table that is read from disk at runtime.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/config ./config
COPY --from=builder /app/.env ./.env

# Anything Railway sets in its dashboard already exists in the environment, and
# Node leaves those alone, so a value can be rotated there without a commit.
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "server.js"]
