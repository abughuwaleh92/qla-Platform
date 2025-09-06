# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package.json only (not package-lock.json if it doesn't exist)
COPY package.json ./

# Install all dependencies (including dev for build)
RUN npm install

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p uploads public/lessons/grade7 public/lessons/grade8

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package.json
COPY package.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy application from builder
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/uploads ./uploads
COPY --from=builder --chown=nodejs:nodejs /app/*.js ./
COPY --from=builder --chown=nodejs:nodejs /app/*.html ./
COPY --from=builder --chown=nodejs:nodejs /app/*.json ./

# Create required directories if they don't exist
RUN mkdir -p uploads public/lessons/grade7 public/lessons/grade8 && \
    chown -R nodejs:nodejs uploads public

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]
