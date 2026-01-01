FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Expose port
EXPOSE 4322

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4322/api/health || exit 1

# Start server
CMD ["node", "server.js"]
