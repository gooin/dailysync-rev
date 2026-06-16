FROM node:18-alpine3.19
WORKDIR /app
RUN corepack enable && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
COPY package.json yarn.lock* tsconfig.json ./
RUN yarn --frozen-lockfile
COPY src ./src
VOLUME /app/db
CMD ["yarn", "sync_global"]
