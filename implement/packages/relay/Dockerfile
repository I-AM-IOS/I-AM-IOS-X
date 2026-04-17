FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 8091
ENV PORT=8091
CMD ["node", "src/index.js"]
