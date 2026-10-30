FROM node:24-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npx next build

# Load generators and tests run from here, inside the compose network.
FROM deps AS tools
COPY . .

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY next.config.ts tsconfig.json ./
COPY lib ./lib
COPY worker ./worker
COPY scripts ./scripts
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]

# make e2e: Playwright with its browsers, against the running stack
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS e2e
WORKDIR /e2e
RUN npm init -y >/dev/null && npm i --no-save --ignore-scripts @playwright/test@1.64.1
COPY playwright.config.ts ./
COPY e2e ./e2e
CMD ["npx", "playwright", "test"]
