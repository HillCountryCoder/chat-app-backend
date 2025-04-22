FROM node:22-alpine AS builder

# Install necessary build tools
RUN apk add --no-cache libc6-compat python3 make g++ openssl openssl-dev

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies including dev dependencies needed for build
RUN npm ci

# Copy application source code
COPY tsconfig.json ./
COPY src/ ./src/
COPY .env* ./

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

# Create app directory and ensure proper permissions
WORKDIR /app

# Install runtime dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --production && \
	# Clean npm cache
	npm cache clean --force

# Copy built app from builder stage
COPY --from=builder /app/dist/ ./dist/
# Copy environment files
COPY --from=builder /app/.env* ./
# Copy necessary static files
COPY public/ ./public/


# Add health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD wget -qO- http://localhost:5000/health || exit 1

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "dist/server.js"]