FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY app.js ./

EXPOSE 3030

CMD ["node", "app.js"]
