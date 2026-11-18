FROM oven/bun:1
WORKDIR /app
COPY package.json tsconfig.json ./
RUN bun install
COPY . .
EXPOSE 3000
CMD ["bun","src/main.ts"]
