FROM node:22-alpine
WORKDIR /app

# Copy everything
COPY . .

# Install backend dependencies
RUN npm ci --only=production && npm cache clean --force

# Build frontend
RUN cd frontend && npm install && npm run build && cd /app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3   CMD node -e "require('http').get({host:'localhost',port:3000,path:'/api/health',timeout:5000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
