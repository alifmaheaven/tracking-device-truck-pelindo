FROM node:22-alpine
WORKDIR /app

# Install build dependencies for bcrypt
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm install --production

# Copy semua source code (server.js + routes + middleware + utils + db.js + seed.js)
COPY . .

EXPOSE 9090
CMD ["node", "server.js"]