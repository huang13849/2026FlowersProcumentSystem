FROM node:18-alpine

WORKDIR /app

COPY ./backend/package.json .
RUN npm install

COPY ./backend .
COPY ./frontend /app/frontend

EXPOSE 3005

CMD ["node", "src/index.js"]
