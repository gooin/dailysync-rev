FROM node:lts-alpine3.19
WORKDIR /app
RUN corepack enable && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/locatime
COPY . .
RUN yarn

CMD ["bash"]
