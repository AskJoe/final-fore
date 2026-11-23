FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-calc fonts-crosextra-carlito fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

ARG FINAL_FORE_ORDERS_INSTALL_CHROMIUM=0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ffm-playwright
USER root
RUN if [ "$FINAL_FORE_ORDERS_INSTALL_CHROMIUM" = "1" ]; then \
      ./node_modules/.bin/playwright install --with-deps chromium --only-shell \
      && rm -rf /var/lib/apt/lists/*; \
    fi
USER node
COPY --chown=node:node . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN FINAL_FORE_ORDERS_INSTALL_CHROMIUM=0 npm run build

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["node", "scripts/start-hosted-test.mjs"]
