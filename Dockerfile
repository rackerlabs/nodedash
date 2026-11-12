# Copyright 2026 Rackspace Technology.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# One image: the BFF serves the built SPA itself (STATIC_DIR), so the page and
# /api share an origin, which the session cookie and the WebSSO callback rely on.
#
# Build from this directory: docker build -t nodedash .

# Build stages have npm and the dev toolchain; the runtime stage is distroless:
# Node and its libraries only, with no shell or package manager.
ARG NODE_IMAGE=node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs26-debian13:nonroot@sha256:767ffb7e2ffa9f4280f1af7b99f7f0a1cafb79d0dcc0e0d3aba43843748008a5

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY apps/bff/package.json apps/bff/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/mock/package.json packages/mock/
RUN npm ci
COPY . .
# A real build only: no mock backend and no service worker.
RUN npm run build

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/bff/package.json apps/bff/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/mock/package.json packages/mock/
# Production dependencies of the BFF and the shared package it imports, nothing else.
RUN npm ci --omit=dev --workspace @nodedash/bff --include-workspace-root=false

FROM ${RUNTIME_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/apps/web/dist
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY apps/bff/package.json apps/bff/
COPY apps/bff/src apps/bff/src
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY --from=build /src/apps/web/dist apps/web/dist
# Distroless's nonroot user, by uid so runAsNonRoot can verify it.
USER 65532:65532
EXPOSE 8080
# The image's entrypoint is node itself.
CMD ["apps/bff/src/server.ts"]
